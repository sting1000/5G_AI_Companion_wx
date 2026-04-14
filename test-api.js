/**
 * 测试火山引擎端到端语音 API 连通性
 * 运行: node test-api.js
 */

const WebSocket = require('ws')

const APP_ID = '9606461235'
const ACCESS_KEY = 'puU5nJ6DO0bGo7-BAVLNQ3xsfy5Mwsr7'
const WS_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue'

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function buildFrame(msgType, eventId, sessionId, payload) {
  const isAudio = msgType === 0b0010
  const flags = 0b0100
  const serialization = isAudio ? 0b0000 : 0b0001

  const header = Buffer.alloc(4)
  header[0] = (0b0001 << 4) | 0b0001
  header[1] = (msgType << 4) | flags
  header[2] = (serialization << 4) | 0b0000
  header[3] = 0

  const eventBuf = Buffer.alloc(4)
  eventBuf.writeUInt32BE(eventId)

  let sessionBuf = Buffer.alloc(0)
  if (sessionId) {
    const sidBytes = Buffer.from(sessionId, 'utf8')
    const sidLen = Buffer.alloc(4)
    sidLen.writeUInt32BE(sidBytes.length)
    sessionBuf = Buffer.concat([sidLen, sidBytes])
  }

  const payloadBytes = isAudio
    ? (payload || Buffer.alloc(0))
    : Buffer.from(JSON.stringify(payload || {}), 'utf8')

  const payloadSizeBuf = Buffer.alloc(4)
  payloadSizeBuf.writeUInt32BE(payloadBytes.length)

  return Buffer.concat([header, eventBuf, sessionBuf, payloadSizeBuf, payloadBytes])
}

function parseFrame(data) {
  const buf = Buffer.from(data)
  if (buf.length < 4) return null

  const msgType = (buf[1] >> 4) & 0x0f
  const flags = buf[1] & 0x0f
  let offset = 4
  let eventId = 0
  let sessionId = ''

  if (flags & 0b0100) {
    eventId = buf.readUInt32BE(offset)
    offset += 4

    if (eventId >= 100) {
      const sidLen = buf.readUInt32BE(offset)
      offset += 4
      sessionId = buf.slice(offset, offset + sidLen).toString('utf8')
      offset += sidLen
    }
  }

  if (msgType === 0b1111) {
    const errorCode = buf.readUInt32BE(offset)
    offset += 4
    const payloadSize = buf.readUInt32BE(offset)
    offset += 4
    const payload = buf.slice(offset, offset + payloadSize).toString('utf8')
    return { msgType, eventId, sessionId, errorCode, payload }
  }

  if (msgType === 0b1011) {
    const payloadSize = buf.readUInt32BE(offset)
    offset += 4
    return { msgType, eventId, sessionId, audioSize: payloadSize }
  }

  const payloadSize = buf.readUInt32BE(offset)
  offset += 4
  const payload = payloadSize > 0 ? buf.slice(offset, offset + payloadSize).toString('utf8') : '{}'
  let parsed
  try { parsed = JSON.parse(payload) } catch { parsed = payload }
  return { msgType, eventId, sessionId, payload: parsed }
}

// --- 主流程 ---
console.log('🔌 连接火山引擎语音 API...')

const connectId = generateUUID()
const sessionId = generateUUID()

const ws = new WebSocket(WS_URL, {
  headers: {
    'X-Api-App-ID': APP_ID,
    'X-Api-Access-Key': ACCESS_KEY,
    'X-Api-Resource-Id': 'volc.speech.dialog',
    'X-Api-App-Key': 'PlgvMymc7f3tQnJ6',
    'X-Api-Connect-Id': connectId,
  },
})

let step = 0
const timeout = setTimeout(() => {
  console.log('❌ 超时（10秒无响应）')
  ws.close()
  process.exit(1)
}, 10000)

ws.on('open', () => {
  console.log('✅ WebSocket 已连接')
  step = 1
  // Step 1: StartConnection
  ws.send(buildFrame(0b0001, 1, null, {}))
})

ws.on('message', (data) => {
  const parsed = parseFrame(data)
  if (!parsed) return

  console.log(`📨 事件 ${parsed.eventId}:`, parsed.payload || `(audio ${parsed.audioSize}B)` || '')

  if (parsed.msgType === 0b1111) {
    console.log('❌ 错误:', parsed.errorCode, parsed.payload)
    clearTimeout(timeout)
    ws.close()
    process.exit(1)
  }

  // ConnectionStarted (50) → 发 StartSession
  if (parsed.eventId === 50 && step === 1) {
    console.log('✅ 连接建立成功')
    step = 2
    const sessionPayload = {
      tts: {
        speaker: 'saturn_zh_female_tiexinnvyou_tob',
      },
      asr: { extra: {} },
      dialog: {
        bot_name: '小林',
        system_role: '你是小林，一个温柔体贴的女孩。简短回复。',
        speaking_style: '温柔自然',
        dialog_id: '',
        extra: {
          model: '2.2.0.0',
          strict_audit: false,
        },
      },
    }
    ws.send(buildFrame(0b0001, 100, sessionId, sessionPayload))
  }

  // SessionStarted (150) → 发 SayHello
  if (parsed.eventId === 150 && step === 2) {
    console.log('✅ 会话启动成功, dialog_id:', parsed.payload?.dialog_id || '(empty)')
    step = 3
    ws.send(buildFrame(0b0001, 300, sessionId, { content: '你好呀！' }))
    console.log('📤 已发送 SayHello: "你好呀！"')
    console.log('⏳ 等待 AI 回复...')
  }

  // TTSSentenceStart (350) — AI 开始说话
  if (parsed.eventId === 350) {
    console.log('🗣️  AI 说:', parsed.payload?.text || '')
  }

  // ChatResponse (550) — AI 文本回复
  if (parsed.eventId === 550) {
    console.log('💬 AI 回复文本:', parsed.payload?.content || '')
  }

  // TTSResponse (352) — 音频数据
  if (parsed.eventId === 352) {
    console.log('🔊 收到音频数据:', parsed.audioSize, 'bytes')
  }

  // TTSEnded (359) — AI 说完
  if (parsed.eventId === 359 && step === 3) {
    console.log('\n✅✅✅ API 全链路测试通过！')
    console.log('  - WebSocket 连接 ✓')
    console.log('  - 会话启动 ✓')
    console.log('  - AI 对话响应 ✓')
    console.log('  - TTS 音频生成 ✓')

    // 结束会话
    ws.send(buildFrame(0b0001, 102, sessionId, {}))
    setTimeout(() => {
      ws.send(buildFrame(0b0001, 2, null, {}))
      clearTimeout(timeout)
      setTimeout(() => { ws.close(); process.exit(0) }, 500)
    }, 500)
  }
})

ws.on('error', (err) => {
  console.log('❌ WebSocket 错误:', err.message)
  clearTimeout(timeout)
  process.exit(1)
})

ws.on('close', () => {
  console.log('🔌 连接已关闭')
})
