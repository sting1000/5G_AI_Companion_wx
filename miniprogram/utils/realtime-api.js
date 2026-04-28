/**
 * 豆包端到端实时语音大模型 WebSocket 协议封装
 * 协议文档: https://www.volcengine.com/docs/6561/1594356
 *
 * 二进制协议结构: header(4B) + optional fields + payload_size(4B) + payload
 */

const config = require('../config.local')
const { createLogger, shouldPrintInfo } = require('./logger')

const WS_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue'
const RESOURCE_ID = 'volc.speech.dialog'
const DEFAULT_APP_KEY = 'PlgvMymc7f3tQnJ6'
const logger = createLogger('RealtimeAPI')
function resolveAppKey() {
  const speechConfig = config && config.speech ? config.speech : {}
  const appId = String(speechConfig.appId || '').trim()
  const rawKey = String(speechConfig.appKey || '').trim()

  // 常见误配置：把 appId（纯数字）填到了 appKey，或直接留空
  const looksLikeAppId = rawKey && (/^\d+$/.test(rawKey) || (appId && rawKey === appId))
  if (!rawKey || looksLikeAppId) {
    if (rawKey) {
      logger.warn('检测到 appKey 配置疑似错误，已回退默认 X-Api-App-Key')
    }
    return DEFAULT_APP_KEY
  }
  return rawKey
}
const APP_KEY = resolveAppKey()
const DEBUG_LOG = false

// 客户端事件 ID
const EVENT = {
  START_CONNECTION: 1,
  FINISH_CONNECTION: 2,
  START_SESSION: 100,
  FINISH_SESSION: 102,
  TASK_REQUEST: 200,
  SAY_HELLO: 300,
  END_ASR: 400,
  CHAT_TEXT_QUERY: 501,
}

// 服务端事件 ID
const SERVER_EVENT = {
  CONNECTION_STARTED: 50,
  CONNECTION_FAILED: 51,
  SESSION_STARTED: 150,
  SESSION_FAILED: 153,
  TTS_SENTENCE_START: 350,
  TTS_SENTENCE_END: 351,
  TTS_RESPONSE: 352,
  TTS_ENDED: 359,
  ASR_INFO: 450,
  ASR_RESPONSE: 451,
  ASR_ENDED: 459,
  CHAT_RESPONSE: 550,
  CHAT_ENDED: 559,
}

// 消息类型
const MSG_TYPE = {
  FULL_CLIENT: 0b0001,
  FULL_SERVER: 0b1001,
  AUDIO_CLIENT: 0b0010,
  AUDIO_SERVER: 0b1011,
  ERROR: 0b1111,
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * 构建二进制帧
 * @param {number} msgType - 消息类型
 * @param {number} eventId - 事件 ID
 * @param {string|null} sessionId - 会话 ID
 * @param {ArrayBuffer|string|null} payload - 载荷（JSON 字符串或音频二进制）
 */
function buildFrame(msgType, eventId, sessionId, payload) {
  const isAudio = msgType === MSG_TYPE.AUDIO_CLIENT
  const serialization = isAudio ? 0b0000 : 0b0001 // 音频无序列化，文本用 JSON
  const flags = 0b0100 // 包含 event 字段

  // header 4 bytes
  const header = new Uint8Array(4)
  header[0] = (0b0001 << 4) | 0b0001 // version=1, header_size=1
  header[1] = (msgType << 4) | flags
  header[2] = (serialization << 4) | 0b0000 // compression=none
  header[3] = 0 // reserved

  // optional: event ID (4 bytes, big-endian)
  const eventBytes = new Uint8Array(4)
  new DataView(eventBytes.buffer).setUint32(0, eventId)

  // optional: session ID
  let sessionBytes = new Uint8Array(0)
  if (sessionId) {
    const sidEncoded = encodeString(sessionId)
    const sidLen = new Uint8Array(4)
    new DataView(sidLen.buffer).setUint32(0, sidEncoded.byteLength)
    sessionBytes = concatBuffers(sidLen, sidEncoded)
  }

  // payload
  let payloadBytes
  if (isAudio) {
    payloadBytes = payload instanceof ArrayBuffer ? new Uint8Array(payload) : new Uint8Array(0)
  } else {
    const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload || {})
    payloadBytes = encodeString(jsonStr)
  }

  // payload size (4 bytes)
  const payloadSize = new Uint8Array(4)
  new DataView(payloadSize.buffer).setUint32(0, payloadBytes.byteLength)

  return concatBuffers(header, eventBytes, sessionBytes, payloadSize, payloadBytes)
}

/**
 * 解析服务端二进制帧
 */
function parseFrame(buffer) {
  const data = new Uint8Array(buffer)
  const view = new DataView(buffer)

  if (data.length < 4) return null

  const msgType = (data[1] >> 4) & 0x0f
  const flags = data[1] & 0x0f
  const serialization = (data[2] >> 4) & 0x0f

  let offset = 4
  let eventId = 0
  let sessionId = ''

  // 解析 event ID
  if (flags & 0b0100) {
    eventId = view.getUint32(offset)
    offset += 4

    // session 级事件带 session ID
    if (isSessionEvent(eventId)) {
      const sidLen = view.getUint32(offset)
      offset += 4
      sessionId = decodeString(data.slice(offset, offset + sidLen))
      offset += sidLen
    }
  }

  // 错误帧有 error code
  if (msgType === MSG_TYPE.ERROR) {
    const errorCode = view.getUint32(offset)
    offset += 4
    const payloadSize = view.getUint32(offset)
    offset += 4
    const payload = payloadSize > 0 ? decodeString(data.slice(offset, offset + payloadSize)) : ''
    return { msgType, eventId, sessionId, errorCode, payload: tryParseJSON(payload) }
  }

  // 音频帧：event ID 之后直接是音频数据
  if (msgType === MSG_TYPE.AUDIO_SERVER) {
    // payload size
    const payloadSize = view.getUint32(offset)
    offset += 4
    const audioData = buffer.slice(offset, offset + payloadSize)
    return { msgType, eventId, sessionId, audioData }
  }

  // 文本帧
  const payloadSize = view.getUint32(offset)
  offset += 4
  const payloadStr = payloadSize > 0 ? decodeString(data.slice(offset, offset + payloadSize)) : '{}'
  return { msgType, eventId, sessionId, payload: tryParseJSON(payloadStr) }
}

function isSessionEvent(eventId) {
  return eventId >= 100
}

function encodeString(str) {
  // TextEncoder 在基础库 2.25.0+ 可用，低版本手动 UTF-8 编码
  if (typeof TextEncoder !== 'undefined') {
    return new Uint8Array(new TextEncoder().encode(str))
  }
  const utf8 = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    if (code < 0x80) {
      utf8.push(code)
    } else if (code < 0x800) {
      utf8.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const hi = code
      const lo = str.charCodeAt(++i)
      code = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00)
      utf8.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      utf8.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return new Uint8Array(utf8)
}

function decodeString(bytes) {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes)
  }
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let str = ''
  for (let i = 0; i < arr.length;) {
    const b = arr[i]
    if (b < 0x80) { str += String.fromCharCode(b); i++ }
    else if (b < 0xe0) { str += String.fromCharCode(((b & 0x1f) << 6) | (arr[i + 1] & 0x3f)); i += 2 }
    else if (b < 0xf0) { str += String.fromCharCode(((b & 0x0f) << 12) | ((arr[i + 1] & 0x3f) << 6) | (arr[i + 2] & 0x3f)); i += 3 }
    else { const cp = ((b & 0x07) << 18) | ((arr[i + 1] & 0x3f) << 12) | ((arr[i + 2] & 0x3f) << 6) | (arr[i + 3] & 0x3f); str += String.fromCodePoint(cp); i += 4 }
  }
  return str
}

function concatBuffers(...arrays) {
  const totalLen = arrays.reduce((sum, a) => sum + a.byteLength, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const arr of arrays) {
    result.set(new Uint8Array(arr.buffer || arr), offset)
    offset += arr.byteLength
  }
  return result.buffer
}

function tryParseJSON(str) {
  try {
    return JSON.parse(str)
  } catch {
    return str
  }
}

function logDebug(...args) {
  if (!DEBUG_LOG || !shouldPrintInfo()) return
  console.log(...args)
}

function clampNumber(value, min, max) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  if (num < min) return min
  if (num > max) return max
  return Math.round(num)
}

function normalizeHotwords(list) {
  if (!Array.isArray(list)) return []
  return list
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20)
    .map(word => ({ word }))
}

function normalizeCorrectWords(mapLike) {
  if (!mapLike || typeof mapLike !== 'object') return {}
  const result = {}
  Object.keys(mapLike).forEach((key) => {
    const source = String(key || '').trim()
    const target = String(mapLike[key] || '').trim()
    if (!source || !target) return
    result[source] = target
  })
  return result
}

/**
 * RealtimeAPI 客户端
 */
class RealtimeAPIClient {
  constructor() {
    this.socket = null
    this.sessionId = ''
    this.connectId = ''
    this.dialogId = ''
    this.connected = false
    this.sessionActive = false

    // 事件回调
    this.onASRText = null        // (text, isFinal) => {}
    this.onASREnd = null         // () => {} 用户停止说话
    this.onChatText = null       // (text) => {}
    this.onAudioData = null      // (audioBuffer) => {}
    this.onTTSStart = null       // (text) => {}
    this.onTTSEnd = null         // () => {}
    this.onSessionStarted = null // (dialogId) => {}
    this.onError = null          // (error) => {}
    this.onDisconnect = null     // () => {} WebSocket 断开
    this.onFirstChatPacket = null // (timestampMs) => {}
    this.onFirstTTSAudioPacket = null // (timestampMs) => {}
    this._firstChatPacketSeen = false
    this._firstTTSPacketSeen = false
  }

  /**
   * 建立 WebSocket 连接
   */
  connect() {
    return new Promise((resolve, reject) => {
      this.connectId = generateUUID()

      logDebug('[RealtimeAPI] 正在连接:', WS_URL)
      logDebug('[RealtimeAPI] AppID:', config.speech.appId)

      const headers = {
        'X-Api-App-ID': config.speech.appId,
        'X-Api-Access-Key': config.speech.accessKey,
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-Connect-Id': this.connectId,
      }
      if (APP_KEY) {
        headers['X-Api-App-Key'] = APP_KEY
      }
      const socketTask = wx.connectSocket({
        url: WS_URL,
        header: headers,
        fail: (err) => {
          logger.error('connectSocket fail:', JSON.stringify(err))
          reject(err)
        },
      })

      this.socket = socketTask

      socketTask.onOpen((res) => {
        logDebug('[RealtimeAPI] WebSocket onOpen', JSON.stringify(res))
        logger.info('WebSocket onOpen')
        this._sendStartConnection()
      })

      socketTask.onMessage((res) => {
        this._handleMessage(res.data)
      })

      socketTask.onError((err) => {
        logger.error('WebSocket onError:', JSON.stringify(err))
        if (this.onError) this.onError(err)
        reject(err)
      })

      socketTask.onClose((res) => {
        logDebug('[RealtimeAPI] WebSocket onClose:', JSON.stringify(res))
        logger.warn('WebSocket onClose')
        this.socket = null
        this.connected = false
        this.sessionActive = false
        if (this.onDisconnect) this.onDisconnect()
      })

      // 等待 ConnectionStarted 事件
      this._onceConnected = resolve
      this._onConnectFailed = reject
    })
  }

  /**
   * 开始会话
   * @param {object} options - 会话配置
   * @param {string} options.botName - 角色名称
   * @param {string} options.systemRole - 系统人设
   * @param {string} options.speakingStyle - 说话风格
   * @param {string} options.characterManifest - 角色描述（SC/SC2.0可用）
   * @param {string} options.dialogId - 对话 ID（用于跨通话记忆）
   * @param {string} options.speaker - TTS 音色
   * @param {object} options.ttsAudioConfig - TTS 声学配置
   * @param {number} options.ttsAudioConfig.speechRate - 语速 [-50,100]
   * @param {number} options.ttsAudioConfig.loudnessRate - 音量 [-50,100]
   * @param {boolean} options.ttsAudioConfig.enableLoudnessNorm - 开启响度均衡
   * @param {object} options.asrConfig - ASR 识别配置
   * @param {boolean} options.asrConfig.enableCustomVad - 开启自定义停顿判定
   * @param {number} options.asrConfig.endSmoothWindowMs - 停顿窗口 [500,50000]
   * @param {boolean} options.asrConfig.enableAsrTwopass - 开启二遍识别
   * @param {string[]} options.asrConfig.hotwords - 热词数组
   * @param {Object.<string,string>} options.asrConfig.correctWords - 替换词映射
   * @param {string} options.inputMode - 输入模式 keep_alive/push_to_talk/text/audio_file
   */
  startSession(options = {}) {
    return new Promise((resolve, reject) => {
      this.sessionId = generateUUID()
      this._firstChatPacketSeen = false
      this._firstTTSPacketSeen = false
      const ttsAudioConfig = options.ttsAudioConfig || {}
      const asrConfig = options.asrConfig || {}
      const speechRate = clampNumber(ttsAudioConfig.speechRate, -50, 100)
      const loudnessRate = clampNumber(ttsAudioConfig.loudnessRate, -50, 100)
      const endSmoothWindowMs = clampNumber(asrConfig.endSmoothWindowMs, 500, 50000)
      const hotwords = normalizeHotwords(asrConfig.hotwords)
      const correctWords = normalizeCorrectWords(asrConfig.correctWords)
      const enableLoudnessNorm = typeof ttsAudioConfig.enableLoudnessNorm === 'boolean'
        ? ttsAudioConfig.enableLoudnessNorm
        : false
      const enableCustomVad = typeof asrConfig.enableCustomVad === 'boolean'
        ? asrConfig.enableCustomVad
        : false
      const enableAsrTwopass = typeof asrConfig.enableAsrTwopass === 'boolean'
        ? asrConfig.enableAsrTwopass
        : false
      const dialogExtra = {
        model: '2.2.0.0',
        strict_audit: false,
        enable_loudness_norm: enableLoudnessNorm,
        input_mod: options.inputMode || 'keep_alive',
      }
      const ttsExtra = {}
      const ttsPayloadAudioConfig = {
        format: 'pcm_s16le',
        sample_rate: 16000,
        channel: 1,
      }
      if (speechRate !== null) {
        ttsPayloadAudioConfig.speech_rate = speechRate
      }
      if (loudnessRate !== null) {
        ttsPayloadAudioConfig.loudness_rate = loudnessRate
      }
      const asrExtra = {
        enable_custom_vad: enableCustomVad,
        enable_asr_twopass: enableAsrTwopass,
      }
      if (endSmoothWindowMs !== null) {
        asrExtra.end_smooth_window_ms = endSmoothWindowMs
      }
      if (hotwords.length > 0 || Object.keys(correctWords).length > 0) {
        asrExtra.context = {}
        if (hotwords.length > 0) {
          asrExtra.context.hotwords = hotwords
        }
        if (Object.keys(correctWords).length > 0) {
          asrExtra.context.correct_words = correctWords
        }
      }

      const payload = {
        tts: {
          speaker: options.speaker || 'saturn_zh_female_wenrouwenya_tob',
          voice_type: options.speaker || 'saturn_zh_female_wenrouwenya_tob',
          audio_config: ttsPayloadAudioConfig,
          extra: ttsExtra,
        },
        asr: {
          extra: asrExtra,
        },
        dialog: {
          bot_name: options.botName || '小林',
          system_role: options.systemRole || '',
          speaking_style: options.speakingStyle || '',
          character_manifest: options.characterManifest || '',
          dialog_id: options.dialogId || '',
          extra: dialogExtra,
        },
      }

      logDebug('[RealtimeAPI] startSession payload:', JSON.stringify(payload))

      const frame = buildFrame(
        MSG_TYPE.FULL_CLIENT,
        EVENT.START_SESSION,
        this.sessionId,
        payload
      )
      this.socket.send({ data: frame })

      this._onceSessionStarted = resolve
      this._onSessionFailed = reject
    })
  }

  /**
   * 发送打招呼文本（让 AI 先说话）
   */
  sayHello(content) {
    const frame = buildFrame(
      MSG_TYPE.FULL_CLIENT,
      EVENT.SAY_HELLO,
      this.sessionId,
      { content }
    )
    logger.info('发送 SAY_HELLO')
    this.socket.send({ data: frame })
  }

  /**
   * 发送音频数据（20ms PCM 一包）
   */
  sendAudio(pcmBuffer) {
    if (!this.sessionActive) {
      logger.warn('sendAudio: session not active, skipping')
      return
    }
    if (!this.socket) {
      logger.warn('sendAudio: socket is null, skipping')
      return
    }
    const frame = buildFrame(
      MSG_TYPE.AUDIO_CLIENT,
      EVENT.TASK_REQUEST,
      this.sessionId,
      pcmBuffer
    )
    this.socket.send({ data: frame })
  }

  /**
   * 通知服务端音频输入结束（按键松开时调用）
   */
  endASR() {
    const frame = buildFrame(
      MSG_TYPE.FULL_CLIENT,
      EVENT.END_ASR,
      this.sessionId,
      {}
    )
    this.socket.send({ data: frame })
  }

  /**
   * 发送文本 query（调试用，文本代替语音）
   */
  sendTextQuery(text) {
    const frame = buildFrame(
      MSG_TYPE.FULL_CLIENT,
      EVENT.CHAT_TEXT_QUERY,
      this.sessionId,
      { content: text }
    )
    this.socket.send({ data: frame })
  }

  /**
   * 结束会话
   */
  finishSession() {
    if (!this.sessionActive) return
    this.sessionActive = false
    const frame = buildFrame(
      MSG_TYPE.FULL_CLIENT,
      EVENT.FINISH_SESSION,
      this.sessionId,
      {}
    )
    this.socket.send({ data: frame })
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (!this.socket) return
    const socket = this.socket
    const wasConnected = this.connected
    this.socket = null
    this.connected = false
    try {
      if (wasConnected) {
        const frame = buildFrame(
          MSG_TYPE.FULL_CLIENT,
          EVENT.FINISH_CONNECTION,
          null,
          {}
        )
        socket.send({ data: frame })
      }
      setTimeout(() => {
        try { socket.close() } catch (e) {}
      }, 500)
    } catch (e) {
      logger.warn('disconnect error:', e)
    }
  }

  /**
   * 处理服务端消息
   */
  _handleMessage(data) {
    // 小程序 ArrayBuffer 的 instanceof 可能失效，改用 byteLength 检测
    let buffer = data
    if (typeof data === 'string') {
      logger.warn('收到字符串消息，忽略')
      return
    }
    if (!buffer || buffer.byteLength === undefined) {
      logger.warn('收到非二进制消息:', typeof data)
      return
    }
    // 如果是 typed array 而非 ArrayBuffer，取底层 buffer
    if (!(buffer instanceof ArrayBuffer) && buffer.buffer) {
      buffer = buffer.buffer
    }

    const parsed = parseFrame(buffer)
    if (!parsed) {
      logger.warn('帧解析失败, 数据长度:', buffer.byteLength)
      return
    }

    const { msgType, eventId, payload, audioData } = parsed
    if (DEBUG_LOG) {
      if (msgType === MSG_TYPE.AUDIO_SERVER) {
        logDebug('[RealtimeAPI] 收到音频事件:', eventId, `size=${audioData ? audioData.byteLength : 0}`)
      } else {
        logDebug('[RealtimeAPI] 收到事件:', eventId, JSON.stringify(payload || {}))
      }
    }

    // 错误处理
    if (msgType === MSG_TYPE.ERROR) {
      logger.error('Server error:', parsed.errorCode, payload)
      if (this.onError) this.onError({ code: parsed.errorCode, detail: payload })
      return
    }

    switch (eventId) {
      case SERVER_EVENT.CONNECTION_STARTED:
        this.connected = true
        logger.info('收到 CONNECTION_STARTED')
        if (this._onceConnected) {
          this._onceConnected()
          this._onceConnected = null
        }
        break

      case SERVER_EVENT.CONNECTION_FAILED:
        logger.error('收到 CONNECTION_FAILED', payload || {})
        if (this._onConnectFailed) {
          this._onConnectFailed(payload)
          this._onConnectFailed = null
        }
        break

      case SERVER_EVENT.SESSION_STARTED:
        this.sessionActive = true
        this.dialogId = payload?.dialog_id || ''
        logger.info('收到 SESSION_STARTED', {
          dialogId: this.dialogId,
        })
        if (this.onSessionStarted) this.onSessionStarted(this.dialogId)
        if (this._onceSessionStarted) {
          this._onceSessionStarted(this.dialogId)
          this._onceSessionStarted = null
        }
        break

      case SERVER_EVENT.SESSION_FAILED:
        logger.error('收到 SESSION_FAILED', payload || {})
        if (this._onSessionFailed) {
          this._onSessionFailed(payload)
          this._onSessionFailed = null
        }
        break

      case SERVER_EVENT.ASR_INFO:
        // 用户开始说话，可用于打断 TTS 播放
        break

      case SERVER_EVENT.ASR_RESPONSE:
        if (payload?.results && this.onASRText) {
          for (const result of payload.results) {
            this.onASRText(result.text, !result.is_interim)
          }
        }
        break

      case SERVER_EVENT.ASR_ENDED:
        logger.info('收到 ASR_ENDED')
        if (this.onASREnd) this.onASREnd()
        break

      case SERVER_EVENT.CHAT_RESPONSE:
        if (payload?.content && this.onChatText) {
          if (!this._firstChatPacketSeen) {
            this._firstChatPacketSeen = true
            if (this.onFirstChatPacket) this.onFirstChatPacket(Date.now())
          }
          this.onChatText(payload.content)
        }
        break

      case SERVER_EVENT.CHAT_ENDED:
        logger.info('收到 CHAT_ENDED')
        break

      case SERVER_EVENT.TTS_SENTENCE_START:
        logger.info('收到 TTS_SENTENCE_START')
        if (this.onTTSStart) this.onTTSStart(payload?.text || '')
        break

      case SERVER_EVENT.TTS_RESPONSE:
        if (audioData) {
          if (!this._firstTTSPacketSeen) {
            this._firstTTSPacketSeen = true
            if (this.onFirstTTSAudioPacket) this.onFirstTTSAudioPacket(Date.now())
          }
          // 首包音频格式检测
          if (!this._ttsFormatLogged && DEBUG_LOG) {
            this._ttsFormatLogged = true
            const firstBytes = new Uint8Array(audioData.slice(0, 8))
            const header = Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')
            const isOgg = firstBytes[0] === 0x4F && firstBytes[1] === 0x67 && firstBytes[2] === 0x67 && firstBytes[3] === 0x53
            logger.info('TTS 首包音频头字节:', header, isOgg ? '(OGG格式!)' : '(非 OGG, 可能是 PCM)')
            logger.info('TTS 音频包大小:', audioData.byteLength, 'bytes')
          }
          if (this.onAudioData) this.onAudioData(audioData)
        }
        break

      case SERVER_EVENT.TTS_ENDED:
        logger.info('收到 TTS_ENDED')
        if (this.onTTSEnd) this.onTTSEnd()
        break
    }
  }

  _sendStartConnection() {
    const frame = buildFrame(
      MSG_TYPE.FULL_CLIENT,
      EVENT.START_CONNECTION,
      null,
      {}
    )
    this.socket.send({ data: frame })
  }
}

module.exports = {
  RealtimeAPIClient,
  EVENT,
  SERVER_EVENT,
}
