const { EVENT, SERVER_EVENT } = require('../../miniprogram/utils/realtime-api')

function encodeUTF8(text) {
  return new Uint8Array(new TextEncoder().encode(text))
}

function concatUint8(...parts) {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  parts.forEach((p) => {
    out.set(p, offset)
    offset += p.byteLength
  })
  return out
}

function u32(num) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, num)
  return out
}

function buildServerFrame({ msgType, eventId, payload, sessionId = '', errorCode = 0, audioData }) {
  const flags = 0b0100
  const header = new Uint8Array(4)
  header[0] = (0b0001 << 4) | 0b0001
  header[1] = (msgType << 4) | flags
  header[2] = ((msgType === 0b1011 ? 0b0000 : 0b0001) << 4) | 0b0000

  const event = u32(eventId)
  const sidPart = eventId >= 100
    ? concatUint8(u32(encodeUTF8(sessionId).byteLength), encodeUTF8(sessionId))
    : new Uint8Array(0)

  if (msgType === 0b1111) {
    const payloadBytes = encodeUTF8(JSON.stringify(payload || {}))
    return concatUint8(header, event, sidPart, u32(errorCode), u32(payloadBytes.byteLength), payloadBytes).buffer
  }
  if (msgType === 0b1011) {
    const bytes = audioData ? new Uint8Array(audioData) : new Uint8Array(0)
    return concatUint8(header, event, sidPart, u32(bytes.byteLength), bytes).buffer
  }
  const payloadBytes = encodeUTF8(JSON.stringify(payload || {}))
  return concatUint8(header, event, sidPart, u32(payloadBytes.byteLength), payloadBytes).buffer
}

function getFrameEventId(frameBuffer) {
  const view = new DataView(frameBuffer)
  return view.getUint32(4)
}

function getClientFramePayload(frameBuffer) {
  const data = new Uint8Array(frameBuffer)
  const view = new DataView(frameBuffer)
  let offset = 8 // header(4) + event(4)
  const eventId = view.getUint32(4)
  if (eventId >= 100) {
    const sidLen = view.getUint32(offset)
    offset += 4 + sidLen
  }
  const payloadSize = view.getUint32(offset)
  offset += 4
  const payloadBytes = data.slice(offset, offset + payloadSize)
  const payloadText = new TextDecoder().decode(payloadBytes)
  return JSON.parse(payloadText)
}

describe('realtime-api 离线协议与生命周期', () => {
  function loadClient() {
    jest.resetModules()
    const { RealtimeAPIClient } = require('../../miniprogram/utils/realtime-api')
    return new RealtimeAPIClient()
  }

  test('connect 成功后会先发送 START_CONNECTION 帧', async () => {
    const client = loadClient()
    const connectPromise = client.connect()
    const socket = wx.__socketTask
    socket.__emitOpen()

    expect(socket.send).toHaveBeenCalledTimes(1)
    const firstFrame = socket.send.mock.calls[0][0].data
    expect(getFrameEventId(firstFrame)).toBe(EVENT.START_CONNECTION)

    socket.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.CONNECTION_STARTED,
      payload: {},
    }))
    await expect(connectPromise).resolves.toBeUndefined()
  })

  test('连接失败事件会 reject connect Promise', async () => {
    const client = loadClient()
    const connectPromise = client.connect()
    wx.__socketTask.__emitOpen()
    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.CONNECTION_FAILED,
      payload: { reason: 'auth failed' },
    }))
    await expect(connectPromise).rejects.toEqual({ reason: 'auth failed' })
  })

  test('startSession 收到 SESSION_STARTED 后返回 dialogId', async () => {
    const client = loadClient()
    const connectPromise = client.connect()
    wx.__socketTask.__emitOpen()
    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.CONNECTION_STARTED,
      payload: {},
    }))
    await connectPromise

    const startPromise = client.startSession({
      botName: '小林',
      systemRole: 'test-role',
      speakingStyle: 'safe',
      dialogId: 'dialog-old',
      speaker: 'voice_a',
    })

    const sessionFrame = wx.__socketTask.send.mock.calls[1][0].data
    expect(getFrameEventId(sessionFrame)).toBe(EVENT.START_SESSION)
    const payload = getClientFramePayload(sessionFrame)
    expect(payload.tts.speaker).toBe('voice_a')
    expect(payload.tts.voice_type).toBe('voice_a')
    expect(payload.dialog.extra.model).toBe('2.2.0.0')
    expect(payload.dialog.extra.input_mod).toBe('keep_alive')
    expect(payload.dialog.system_role).toBe('test-role')
    expect(payload.dialog.character_manifest).toBe('')

    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.SESSION_STARTED,
      sessionId: client.sessionId,
      payload: { dialog_id: 'dialog-new' },
    }))
    await expect(startPromise).resolves.toBe('dialog-new')
  })

  test('startSession 会透传 asrConfig 和热词配置', async () => {
    const client = loadClient()
    const connectPromise = client.connect()
    wx.__socketTask.__emitOpen()
    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.CONNECTION_STARTED,
      payload: {},
    }))
    await connectPromise

    client.startSession({
      asrConfig: {
        enableCustomVad: true,
        endSmoothWindowMs: 900,
        enableAsrTwopass: true,
        hotwords: ['小林', '太极拳'],
        correctWords: { 小玲: '小林' },
      },
    })
    const sessionFrame = wx.__socketTask.send.mock.calls[1][0].data
    const payload = getClientFramePayload(sessionFrame)
    expect(payload.tts.speaker).toBe('saturn_zh_female_wenrouwenya_tob')
    expect(payload.asr.extra.enable_custom_vad).toBe(true)
    expect(payload.asr.extra.end_smooth_window_ms).toBe(900)
    expect(payload.asr.extra.enable_asr_twopass).toBe(true)
    expect(payload.asr.extra.context.hotwords).toEqual([{ word: '小林' }, { word: '太极拳' }])
    expect(payload.asr.extra.context.correct_words).toEqual({ 小玲: '小林' })
  })

  test('错误帧会触发 onError 回调', () => {
    const client = loadClient()
    const onError = jest.fn()
    client.onError = onError

    // connect() registers the onMessage handler on the socket task;
    // without it, __emitMessage has no handler to call.
    client.connect()

    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1111,
      eventId: SERVER_EVENT.SESSION_FAILED,
      sessionId: 'sid-test',
      errorCode: 401,
      payload: { detail: 'invalid token' },
    }))
    expect(onError).toHaveBeenCalledWith({
      code: 401,
      detail: { detail: 'invalid token' },
    })
  })

  test('disconnect 在已连接时会发送 FINISH_CONNECTION 并关闭 socket', () => {
    jest.useFakeTimers()
    const client = loadClient()
    client.connected = true
    client.socket = wx.__socketTask

    client.disconnect()

    const sent = wx.__socketTask.send.mock.calls[0][0].data
    expect(getFrameEventId(sent)).toBe(EVENT.FINISH_CONNECTION)

    jest.advanceTimersByTime(500)
    expect(wx.__socketTask.close).toHaveBeenCalled()
  })

  test('disconnect 会吞掉已不存在 socket task 的关闭失败', async () => {
    jest.useFakeTimers()
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const client = loadClient()
    client.connected = true
    client.socket = wx.__socketTask
    wx.__socketTask.close.mockImplementation(() => Promise.reject(
      new Error('closeSocket:fail wcwss taskID not exist')
    ))

    client.disconnect()
    jest.advanceTimersByTime(500)
    await Promise.resolve()

    expect(wx.__socketTask.close).toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('socket close fail:'),
      expect.anything()
    )
    warnSpy.mockRestore()
  })

  test('完整 ASR/Chat/TTS 事件会透传逐轮元数据和真实事件顺序', () => {
    const client = loadClient()
    const observed = []
    client.onASRStart = meta => observed.push(['asr_start', meta])
    client.onASRText = (text, isFinal, meta) => observed.push(['asr_text', meta, text, isFinal])
    client.onASREnd = meta => observed.push(['asr_end', meta])
    client.onChatText = (text, meta) => observed.push(['chat', meta, text])
    client.onChatEnd = meta => observed.push(['chat_end', meta])
    client.onTTSStart = (text, meta) => observed.push(['tts_start', meta, text])
    client.onAudioData = (audio, meta) => observed.push(['tts_audio', meta, audio.byteLength])
    client.onTTSSentenceEnd = meta => observed.push(['tts_sentence_end', meta])
    client.onTTSEnd = meta => observed.push(['tts_end', meta])
    client.connect()

    const emit = (eventId, payload = {}) => {
      wx.__socketTask.__emitMessage(buildServerFrame({
        msgType: 0b1001,
        eventId,
        sessionId: 'sid-turn',
        payload,
      }))
    }
    emit(SERVER_EVENT.ASR_INFO, { question_id: 'q1' })
    emit(SERVER_EVENT.ASR_RESPONSE, {
      results: [{ text: '提醒我明天吃药', is_interim: false }],
    })
    emit(SERVER_EVENT.ASR_ENDED)
    emit(SERVER_EVENT.CHAT_RESPONSE, {
      content: '好，',
      question_id: 'q1',
      reply_id: 'r1',
    })
    emit(SERVER_EVENT.CHAT_ENDED, { question_id: 'q1', reply_id: 'r1' })
    emit(SERVER_EVENT.TTS_SENTENCE_START, {
      text: '好，明天提醒您。',
      question_id: 'q1',
      reply_id: 'r1',
      tts_type: 'default',
    })
    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1011,
      eventId: SERVER_EVENT.TTS_RESPONSE,
      sessionId: 'sid-turn',
      audioData: new Uint8Array(640).buffer,
    }))
    emit(SERVER_EVENT.TTS_SENTENCE_END, { question_id: 'q1', reply_id: 'r1' })
    emit(SERVER_EVENT.TTS_ENDED, {
      question_id: 'q1',
      reply_id: 'r1',
      status_code: '0',
    })

    expect(observed.map(item => item[0])).toEqual([
      'asr_start',
      'asr_text',
      'asr_end',
      'chat',
      'chat_end',
      'tts_start',
      'tts_audio',
      'tts_sentence_end',
      'tts_end',
    ])
    const sequences = observed.map(item => item[1].eventSeq)
    expect(sequences).toEqual(sequences.slice().sort((a, b) => a - b))
    observed.forEach(item => {
      expect(item[1].questionId).toBe('q1')
    })
    expect(observed[5][1]).toEqual(expect.objectContaining({
      replyId: 'r1',
      ttsType: 'default',
    }))
    expect(observed[8][1].statusCode).toBe('0')
  })

  test('首 Chat/TTS 包标记会按 ASR 轮次重置而不是按 session 重置', () => {
    const client = loadClient()
    const firstChat = jest.fn()
    const firstTTS = jest.fn()
    client.onFirstChatPacket = firstChat
    client.onFirstTTSAudioPacket = firstTTS
    client.onChatText = jest.fn()
    client.onAudioData = jest.fn()
    client.connect()

    const emitText = (eventId, payload) => {
      wx.__socketTask.__emitMessage(buildServerFrame({
        msgType: 0b1001,
        eventId,
        sessionId: 'sid-reset',
        payload,
      }))
    }
    const emitAudio = () => {
      wx.__socketTask.__emitMessage(buildServerFrame({
        msgType: 0b1011,
        eventId: SERVER_EVENT.TTS_RESPONSE,
        sessionId: 'sid-reset',
        audioData: new Uint8Array(640).buffer,
      }))
    }

    emitText(SERVER_EVENT.ASR_INFO, { question_id: 'q1' })
    emitText(SERVER_EVENT.CHAT_RESPONSE, { content: '一', question_id: 'q1', reply_id: 'r1' })
    emitAudio()
    emitText(SERVER_EVENT.TTS_ENDED, { question_id: 'q1', reply_id: 'r1' })
    emitText(SERVER_EVENT.ASR_INFO, { question_id: 'q2' })
    emitText(SERVER_EVENT.CHAT_RESPONSE, { content: '二', question_id: 'q2', reply_id: 'r2' })
    emitAudio()

    expect(firstChat).toHaveBeenCalledTimes(2)
    expect(firstTTS).toHaveBeenCalledTimes(2)
    expect(firstChat.mock.calls[1][1].questionId).toBe('q2')
    expect(firstTTS.mock.calls[1][1]).toEqual(expect.objectContaining({
      questionId: 'q2',
      replyId: 'r2',
    }))
  })

  test('旧 session 的迟到结束事件不能关闭当前新会话', () => {
    const client = loadClient()
    client.connect()
    client.sessionId = 'sid-new'
    client.sessionActive = true

    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.SESSION_FINISHED,
      sessionId: 'sid-old',
      payload: {},
    }))
    expect(client.sessionActive).toBe(true)

    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.SESSION_FINISHED,
      sessionId: 'sid-new',
      payload: {},
    }))
    expect(client.sessionActive).toBe(false)
  })

  test('缺失 ASR_INFO 时的回退开始事件会明确标记 synthetic', () => {
    const client = loadClient()
    const onASRStart = jest.fn()
    client.onASRStart = onASRStart
    client.onASRText = jest.fn()
    client.connect()

    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.ASR_RESPONSE,
      sessionId: 'sid-synthetic',
      payload: {
        question_id: 'q-synthetic',
        results: [{ text: '测试', is_interim: false }],
      },
    }))

    expect(onASRStart).toHaveBeenCalledWith(expect.objectContaining({
      eventId: SERVER_EVENT.ASR_RESPONSE,
      questionId: 'q-synthetic',
      synthetic: true,
      synthesizedEvent: 'asr_start_fallback',
    }))
  })

  test('旧 question 的迟到 Chat 不会消耗当前轮首包标记', () => {
    const client = loadClient()
    const onChatText = jest.fn()
    const onFirstChatPacket = jest.fn()
    client.onChatText = onChatText
    client.onFirstChatPacket = onFirstChatPacket
    client.connect()

    const emit = (eventId, payload) => {
      wx.__socketTask.__emitMessage(buildServerFrame({
        msgType: 0b1001,
        eventId,
        sessionId: 'sid-question-order',
        payload,
      }))
    }
    emit(SERVER_EVENT.ASR_INFO, { question_id: 'q-new' })
    emit(SERVER_EVENT.CHAT_RESPONSE, {
      question_id: 'q-old',
      reply_id: 'r-old',
      content: '旧回复',
    })
    emit(SERVER_EVENT.CHAT_RESPONSE, {
      question_id: 'q-new',
      reply_id: 'r-new',
      content: '新回复',
    })

    expect(onChatText).toHaveBeenCalledTimes(1)
    expect(onChatText).toHaveBeenCalledWith(
      '新回复',
      expect.objectContaining({ questionId: 'q-new', replyId: 'r-new' })
    )
    expect(onFirstChatPacket).toHaveBeenCalledTimes(1)
    expect(onFirstChatPacket.mock.calls[0][1].questionId).toBe('q-new')
  })

  test('sendTextQuery 允许一次有明确标记的 question 转换', () => {
    const client = loadClient()
    const onChatText = jest.fn()
    client.onChatText = onChatText
    client.connect()
    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.ASR_INFO,
      sessionId: 'sid-text-query',
      payload: { question_id: 'q-audio' },
    }))

    client.sendTextQuery('请安全重说')
    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.CHAT_RESPONSE,
      sessionId: 'sid-text-query',
      payload: {
        question_id: 'q-text',
        reply_id: 'r-text',
        content: '我不能线下行动，但可以帮您联系家人。',
      },
    }))

    expect(onChatText).toHaveBeenCalledWith(
      '我不能线下行动，但可以帮您联系家人。',
      expect.objectContaining({
        questionId: 'q-text',
        clientTextQueryTransition: true,
        previousQuestionId: 'q-audio',
      })
    )
  })

  test('CHAT_RAG_TEXT 事件常量是 502', () => {
    expect(EVENT.CHAT_RAG_TEXT).toBe(502)
  })

  test('sendRAGText 在 sessionActive 时发送合法 JSON 数组字符串', async () => {
    const client = loadClient()
    const connectPromise = client.connect()
    wx.__socketTask.__emitOpen()
    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.CONNECTION_STARTED,
      payload: {},
    }))
    await connectPromise

    const startPromise = client.startSession({
      characterManifest: 'manifest-core',
      systemRole: 'compat-role',
    })
    const sessionFrame = wx.__socketTask.send.mock.calls[1][0].data
    const sessionPayload = getClientFramePayload(sessionFrame)
    expect(sessionPayload.dialog.extra.model).toBe('2.2.0.0')
    expect(sessionPayload.dialog.character_manifest).toBe('manifest-core')
    expect(sessionPayload.dialog.system_role).toBe('compat-role')

    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.SESSION_STARTED,
      sessionId: client.sessionId,
      payload: { dialog_id: 'dialog-rag' },
    }))
    await startPromise

    wx.__socketTask.send.mockImplementation((opts) => { if (opts && opts.success) opts.success({}) })
    const pendingBefore = client._pendingTextQueryCount
    const sent = await client.sendRAGText([
      { title: '长期记忆', content: '喜欢太极拳' },
    ])
    expect(sent).toBe(true)
    expect(client._pendingTextQueryCount).toBe(pendingBefore)

    const ragFrame = wx.__socketTask.send.mock.calls[2][0].data
    expect(getFrameEventId(ragFrame)).toBe(EVENT.CHAT_RAG_TEXT)
    const payload = getClientFramePayload(ragFrame)
    expect(typeof payload.external_rag).toBe('string')
    const parsed = JSON.parse(payload.external_rag)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toEqual([{ title: '长期记忆', content: '喜欢太极拳' }])
    expect(payload.external_rag.length).toBeLessThanOrEqual(4000)
  })

  test('sendRAGText 空结果或会话未激活时不发送', async () => {
    const client = loadClient()
    const connectPromise = client.connect()
    wx.__socketTask.__emitOpen()
    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.CONNECTION_STARTED,
      payload: {},
    }))
    await connectPromise
    wx.__socketTask.send.mockClear()

    expect(await client.sendRAGText([{ title: '长期记忆', content: '喜欢太极拳' }])).toBe(false)
    expect(wx.__socketTask.send).not.toHaveBeenCalled()

    client.sessionActive = true
    expect(await client.sendRAGText([])).toBe(false)
    expect(await client.sendRAGText([{ title: '长期记忆', content: '   ' }])).toBe(false)
    expect(wx.__socketTask.send).not.toHaveBeenCalled()

    client.socket = null
    expect(await client.sendRAGText([{ title: '长期记忆', content: '喜欢太极拳' }])).toBe(false)
  })

  test('sendRAGText 超长内容会截断到 4000 字符以内', async () => {
    const client = loadClient()
    client.sessionActive = true
    client.sessionId = 'sid-rag'
    client.socket = { send: jest.fn((opts) => { if (opts && opts.success) opts.success({}) }) }
    const sent = await client.sendRAGText([{
      title: '长期记忆',
      content: '血压'.repeat(2500),
    }])
    expect(sent).toBe(true)
    const payload = getClientFramePayload(client.socket.send.mock.calls[0][0].data)
    expect(typeof payload.external_rag).toBe('string')
    expect(payload.external_rag.length).toBeLessThanOrEqual(4000)
    expect(() => JSON.parse(payload.external_rag)).not.toThrow()
    expect(Array.isArray(JSON.parse(payload.external_rag))).toBe(true)
  })

  test('sendRAGText 日志不打印记忆正文', async () => {
    const client = loadClient()
    client.sessionActive = true
    client.sessionId = 'sid-rag'
    client.socket = { send: jest.fn((opts) => { if (opts && opts.success) opts.success({}) }) }
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const secret = '高血压秘密记忆正文'
    await client.sendRAGText([{ title: '长期记忆', content: secret }])
    const dump = `${JSON.stringify(logSpy.mock.calls)}${JSON.stringify(warnSpy.mock.calls)}`
    expect(dump).not.toContain(secret)
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  test('sendRAGText success 异步回调后才 resolve(true)', async () => {
    const client = loadClient()
    client.sessionActive = true
    client.sessionId = 'sid-rag'
    let successCb = null
    client.socket = { send: jest.fn((opts) => { successCb = opts.success }) }
    const promise = client.sendRAGText([{ title: '长期记忆', content: '喜欢太极拳' }])
    expect(successCb).toBeTruthy()
    successCb({})
    const result = await promise
    expect(result).toBe(true)
  })

  test('sendRAGText fail 回调 resolve(false)', async () => {
    const client = loadClient()
    client.sessionActive = true
    client.sessionId = 'sid-rag'
    client.socket = { send: jest.fn((opts) => { if (opts && opts.fail) opts.fail({}) }) }
    const result = await client.sendRAGText([{ title: '长期记忆', content: '喜欢太极拳' }])
    expect(result).toBe(false)
  })

  test('sendRAGText socket.send 同步抛异常 resolve(false)', async () => {
    const client = loadClient()
    client.sessionActive = true
    client.sessionId = 'sid-rag'
    client.socket = { send: jest.fn(() => { throw new Error('send exploded') }) }
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await client.sendRAGText([{ title: '长期记忆', content: '喜欢太极拳' }])
    expect(result).toBe(false)
    warnSpy.mockRestore()
  })
})
