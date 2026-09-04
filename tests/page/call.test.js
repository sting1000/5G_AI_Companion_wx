const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('call 页面离线关键分支', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/call/call.js')

  function loadPage() {
    jest.resetModules()
    return loadPageModule(pagePath)
  }

  function setupAssistantReplyPage(page) {
    page._markCallConnectedIfNeeded = jest.fn()
    page._requestCompanionVisual = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
    }
    page.messages = []
    page.chatBuffer = ''
    page.pendingAssistantDraft = ''
    page.currentAssistantReplyId = ''
    page.ttsSentenceBuffer = ''
    page.ttsSentenceReplyId = ''
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 1
    page.isBoundaryRepairing = false
    page.latencySamples = []
    page.setData({ transcriptItems: [], currentAssistantDraft: '' })
    page._setupCallbacks()
  }

  test('onAccept 首次点击会设置接听态并触发 _startCall', () => {
    const page = loadPage()
    page._startCall = jest.fn()

    page.onAccept()

    expect(page.data.isIncomingAnswering).toBe(true)
    expect(page.data.connectionPhase).toBe('dialing')
    expect(page._startCall).toHaveBeenCalledTimes(1)
  })

  test('onAccept 在重复点击时会直接返回', () => {
    const page = loadPage()
    page._startCall = jest.fn()
    page.setData({ isIncomingAnswering: true })

    page.onAccept()
    expect(page._startCall).not.toHaveBeenCalled()
  })

  test('onDecline 在可拒接状态会返回上一页', () => {
    const page = loadPage()
    page.setData({ isIncomingAnswering: false })
    page.onDecline()
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('_setConnectionPhase 会根据呼叫模式写入提示语', () => {
    const page = loadPage()

    page.setData({ callMode: 'outgoing' })
    page._setConnectionPhase('dialing')
    expect(page.data.connectionHint).toBe('正在呼叫小林...')

    page.setData({ callMode: 'incoming' })
    page._setConnectionPhase('dialing')
    expect(page.data.connectionHint).toBe('正在接听，马上就好...')
  })

  test('_authorize 失败且用户取消时会 reject', async () => {
    const page = loadPage()
    wx.authorize.mockImplementation(({ fail }) => fail())
    wx.showModal.mockImplementation(({ success }) => success({ confirm: false }))

    await expect(page._authorize()).rejects.toThrow('用户拒绝麦克风权限')
  })

  test('首句仅走 SAY_HELLO/TTS 时也会落字幕和消息', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
    }
    page.messages = []
    page.chatBuffer = ''
    page.pendingAssistantDraft = '您好呀，我是小林。'
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 0
    page.isBoundaryRepairing = false
    page.currentLatencyTurn = null
    page.setData({
      currentAssistantDraft: '您好呀，我是小林。',
      transcriptItems: [],
    })

    page._setupCallbacks()
    page.client.onTTSStart('')
    page.client.onTTSEnd()

    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].role).toBe('assistant')
    expect(page.messages[0].content).toBe('您好呀，我是小林。')
    expect(page.data.transcriptItems).toHaveLength(1)
    expect(page.data.transcriptItems[0].role).toBe('assistant')
    expect(page.data.transcriptItems[0].content).toBe('您好呀，我是小林。')
  })

  test('同一回复的多次 TTS_SENTENCE_START 不会清空整轮文本', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
    }
    page.messages = []
    page.chatBuffer = '第一句完整内容。第二句也要保留。'
    page.pendingAssistantDraft = page.chatBuffer
    page.currentAssistantReplyId = ''
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 1
    page.isBoundaryRepairing = false
    page.currentLatencyTurn = null
    page.setData({
      currentAssistantDraft: page.chatBuffer,
      transcriptItems: [],
    })

    page._setupCallbacks()
    const meta = { questionId: 'q-multi', replyId: 'r-multi', receivedAt: 1000 }
    page.client.onTTSStart('第一句完整内容。', meta)
    page.client.onTTSStart('第二句也要保留。', Object.assign({}, meta, { receivedAt: 1100 }))

    expect(page.chatBuffer).toBe('第一句完整内容。第二句也要保留。')
    page.client.onTTSEnd(Object.assign({}, meta, { receivedAt: 1200 }))
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].content).toBe('第一句完整内容。第二句也要保留。')
  })

  test('没有 Chat 分片时会累积同一回复的多句 TTS 文本', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
    }
    page.messages = []
    page.chatBuffer = ''
    page.pendingAssistantDraft = ''
    page.currentAssistantReplyId = ''
    page.ttsSentenceBuffer = ''
    page.ttsSentenceReplyId = ''
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 1
    page.isBoundaryRepairing = false
    page.currentLatencyTurn = null
    page.setData({ currentAssistantDraft: '', transcriptItems: [] })

    page._setupCallbacks()
    const meta = { questionId: 'q-tts-only', replyId: 'r-tts-only' }
    page.client.onTTSStart('第一句。', meta)
    page.client.onTTSStart('第二句。', meta)
    page.client.onTTSEnd(meta)

    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].content).toBe('第一句。第二句。')
  })

  test('_sendAudioIn20msFrames 会按 640 字节分片并缓存余量', () => {
    const page = loadPage()
    const sendAudio = jest.fn()
    page.client = { sendAudio }
    page.uplinkRemainder = new Uint8Array(0)

    page._sendAudioIn20msFrames(new Uint8Array(1000).buffer)
    expect(sendAudio).toHaveBeenCalledTimes(1)
    expect(sendAudio.mock.calls[0][0].byteLength).toBe(640)
    expect(page.uplinkRemainder.byteLength).toBe(360)

    page._sendAudioIn20msFrames(new Uint8Array(300).buffer)
    expect(sendAudio).toHaveBeenCalledTimes(2)
    expect(sendAudio.mock.calls[1][0].byteLength).toBe(640)
    expect(page.uplinkRemainder.byteLength).toBe(20)
  })

  test('半双工在 AI 生成或播放期间阻断上行且不触发打断', () => {
    const page = loadPage()
    const sendAudio = jest.fn()
    page.client = {
      sessionActive: true,
      sendAudio,
    }
    page.recorder = {}
    page.player = {
      playing: false,
      preparingSegment: false,
      webPreparing: false,
    }
    page.initialEchoGuardActive = false
    page.assistantTurnInProgress = true
    page.playbackEchoGuardUntil = 0
    page.lastUplinkBlockReason = ''
    page.uplinkRemainder = new Uint8Array(0)

    page._setupCallbacks()
    page.recorder.onFrameData(new Uint8Array(640).buffer)

    expect(sendAudio).not.toHaveBeenCalled()
    expect(page.player.stop).toBeUndefined()
  })

  test('时延样本必须等真实 onPlay，TTS_ENDED 不能提前封口', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
      getEstimatedRemainingMs: jest.fn(() => 1000),
    }
    page.messages = []
    page.chatBuffer = ''
    page.pendingAssistantDraft = ''
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 1
    page.isBoundaryRepairing = false
    page.latencySamples = []
    page.localVadState = {
      noiseFloor: 180,
      threshold: 540,
      speechActive: false,
      voicedFrames: 0,
      silenceFrames: 5,
      lastVoiceAt: 1000,
      confidence: 0.9,
    }
    page.incomingFollowupState = {
      reminderCompleted: false,
      waitingNoMoreChatConfirm: false,
      shouldAutoEndAfterAssistant: false,
      pendingAutoEndAfterPlayback: false,
    }
    page.callEndingState = {
      shouldAutoEndAfterAssistant: false,
      pendingAutoEndAfterPlayback: false,
      source: '',
    }
    page.setData({ transcriptItems: [] })

    page._setupCallbacks()
    page.client.onASRStart({ questionId: 'q-latency', receivedAt: 1050, eventSeq: 1 })
    page.client.onASRText('我说完了', true, {
      questionId: 'q-latency',
      receivedAt: 2000,
      eventSeq: 2,
    })
    page.client.onASREnd({ questionId: 'q-latency', receivedAt: 2300, eventSeq: 3 })
    page.client.onChatText('我听见了，您慢慢说。', {
      questionId: 'q-latency',
      replyId: 'r-latency',
      receivedAt: 2500,
      eventSeq: 4,
    })
    page.client.onAudioData(new Uint8Array(640).buffer, {
      questionId: 'q-latency',
      replyId: 'r-latency',
      receivedAt: 2700,
      eventSeq: 5,
    })
    page.client.onTTSEnd({
      questionId: 'q-latency',
      replyId: 'r-latency',
      receivedAt: 3000,
      eventSeq: 6,
    })

    expect(page.currentLatencyTurn).toBeTruthy()
    expect(page.latencySamples).toHaveLength(0)

    page.player.onPlaybackEvent({ name: 'wav_write_start', at: 3100, generation: 2 })
    page.player.onPlaybackEvent({ name: 'wav_write_end', at: 3200, generation: 2, success: true })
    page.player.onPlaybackEvent({ name: 'play_requested', at: 3300, requestedAt: 3300, generation: 2 })
    page.player.onPlayStart({
      at: 3500,
      source: 'inner_audio_on_play',
      authoritative: true,
      generation: 2,
    })

    expect(page.currentLatencyTurn).toBe(null)
    expect(page.latencySamples).toHaveLength(1)
    expect(page.latencySamples[0]).toEqual(expect.objectContaining({
      valid: true,
      vadWaitMs: 1300,
      firstPlayMs: 2500,
      playStartSource: 'inner_audio_on_play',
    }))
    expect(page.localVadState).toEqual(expect.objectContaining({
      speechActive: false,
      voicedFrames: 0,
      silenceFrames: 0,
      candidateVoiceAt: 0,
      lastVoiceAt: 0,
    }))
    expect(wx.getStorageSync('realtimeLatencySamplesV2')).toHaveLength(1)
    expect(page._getLatencyInvalidReason(Object.assign({}, page.latencySamples[0], {
      firstChatAt: 0,
    }))).toBe('missing_first_chat')
    expect(page._getLatencyInvalidReason(Object.assign({}, page.latencySamples[0], {
      asrStartSynthetic: true,
    }))).toBe('synthetic_asr_start')
  })

  test('旧 question/reply 的迟到 Chat/TTS 不会污染当前轮', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
    }
    page.chatBuffer = ''
    page.pendingAssistantDraft = ''
    page.latencySamples = []
    const turn = page._ensureLatencyTurn({
      questionId: 'q-new',
      replyId: 'r-new',
      receivedAt: 1000,
    })

    page._setupCallbacks()
    const staleMeta = {
      questionId: 'q-old',
      replyId: 'r-old',
      receivedAt: 1100,
    }
    page.client.onChatText('旧回复', staleMeta)
    page.client.onAudioData(new Uint8Array(640).buffer, staleMeta)
    page.client.onTTSEnd(staleMeta)

    expect(page.chatBuffer).toBe('')
    expect(page.player.appendChunk).not.toHaveBeenCalled()
    expect(page.player.playBuffered).not.toHaveBeenCalled()
    expect(turn.droppedStaleEventCount).toBe(3)
  })

  test('同一 question 的 external_rag 回复会接管默认回复并播放 RAG 音频', () => {
    const page = loadPage()
    setupAssistantReplyPage(page)
    page.client.onASRStart({ questionId: 'q-square-dance', receivedAt: 1000, eventSeq: 1 })
    page.client.onChatText('您跳得这么好，真不错。', {
      eventId: 550,
      questionId: 'q-square-dance',
      replyId: 'r-default',
      receivedAt: 1100,
      eventSeq: 2,
    })
    page.client.onTTSStart('您跳得这么好，真不错。', {
      eventId: 350,
      questionId: 'q-square-dance',
      replyId: 'r-default',
      ttsType: 'default',
      receivedAt: 1200,
      eventSeq: 3,
    })
    const defaultAudio = new Uint8Array([1, 2]).buffer
    page.client.onAudioData(defaultAudio, {
      eventId: 352,
      questionId: 'q-square-dance',
      replyId: 'r-default',
      receivedAt: 1300,
      eventSeq: 4,
    })

    page.client.onTTSStart('您今天状态真好，广场舞一定跳得特别带劲。', {
      eventId: 350,
      questionId: 'q-square-dance',
      replyId: 'r-rag',
      ttsType: 'external_rag',
      receivedAt: 1400,
      eventSeq: 5,
    })
    page.client.onChatText('您今天状态真好，广场舞一定跳得特别带劲。', {
      eventId: 550,
      questionId: 'q-square-dance',
      replyId: 'r-rag',
      receivedAt: 1500,
      eventSeq: 6,
    })
    const ragAudio = new Uint8Array([3, 4]).buffer
    page.client.onAudioData(ragAudio, {
      eventId: 352,
      questionId: 'q-square-dance',
      replyId: 'r-rag',
      receivedAt: 1600,
      eventSeq: 7,
    })
    page.client.onTTSEnd({
      eventId: 359,
      questionId: 'q-square-dance',
      replyId: 'r-rag',
      receivedAt: 1700,
      eventSeq: 8,
    })

    expect(page.player.stop).toHaveBeenCalledTimes(1)
    expect(page.player.appendChunk).toHaveBeenLastCalledWith(ragAudio)
    expect(page.player.playBuffered).toHaveBeenCalledTimes(1)
    expect(page.messages).toEqual([
      { role: 'assistant', content: '您今天状态真好，广场舞一定跳得特别带劲。' },
    ])
    expect(page.data.transcriptItems.map(item => item.content)).toEqual([
      '您今天状态真好，广场舞一定跳得特别带劲。',
    ])

    const appendCount = page.player.appendChunk.mock.calls.length
    page.client.onChatText('默认回复迟到文本。', {
      eventId: 550,
      questionId: 'q-square-dance',
      replyId: 'r-default',
      receivedAt: 1800,
      eventSeq: 9,
    })
    page.client.onAudioData(new Uint8Array([5, 6]).buffer, {
      eventId: 352,
      questionId: 'q-square-dance',
      replyId: 'r-default',
      receivedAt: 1900,
      eventSeq: 10,
    })
    page.client.onTTSEnd({
      eventId: 359,
      questionId: 'q-square-dance',
      replyId: 'r-default',
      receivedAt: 2000,
      eventSeq: 11,
    })
    expect(page.player.appendChunk).toHaveBeenCalledTimes(appendCount)
    expect(page.messages).toEqual([
      { role: 'assistant', content: '您今天状态真好，广场舞一定跳得特别带劲。' },
    ])
  })

  test('默认回复已经开始播放后 external_rag 仍会立即接管并撤回默认内容', () => {
    const page = loadPage()
    setupAssistantReplyPage(page)
    page.client.onASRStart({ questionId: 'q-playing-rag', receivedAt: 1000, eventSeq: 1 })
    page.client.onChatText('默认回复。', {
      eventId: 550,
      questionId: 'q-playing-rag',
      replyId: 'r-default-playing',
      receivedAt: 1100,
      eventSeq: 2,
    })
    page.client.onTTSStart('默认回复。', {
      eventId: 350,
      questionId: 'q-playing-rag',
      replyId: 'r-default-playing',
      ttsType: 'default',
      receivedAt: 1200,
      eventSeq: 3,
    })
    page.client.onAudioData(new Uint8Array([1, 2]).buffer, {
      eventId: 352,
      questionId: 'q-playing-rag',
      replyId: 'r-default-playing',
      receivedAt: 1300,
      eventSeq: 4,
    })
    page.client.onTTSEnd({
      eventId: 359,
      questionId: 'q-playing-rag',
      replyId: 'r-default-playing',
      receivedAt: 1400,
      eventSeq: 5,
    })
    page.player.playing = true
    page.player.onPlayStart({ at: 1450, source: 'inner_audio_on_play', authoritative: true, generation: 2 })

    expect(page.messages.map(item => item.content)).toEqual(['默认回复。'])
    expect(page.data.transcriptItems.map(item => item.content)).toEqual(['默认回复。'])

    page.client.onTTSStart('结合广场舞记忆后的回复。', {
      eventId: 350,
      questionId: 'q-playing-rag',
      replyId: 'r-rag-playing',
      ttsType: 'external_rag',
      receivedAt: 1500,
      eventSeq: 6,
    })
    page.client.onChatText('结合广场舞记忆后的回复。', {
      eventId: 550,
      questionId: 'q-playing-rag',
      replyId: 'r-rag-playing',
      receivedAt: 1600,
      eventSeq: 7,
    })
    page.client.onAudioData(new Uint8Array([3, 4]).buffer, {
      eventId: 352,
      questionId: 'q-playing-rag',
      replyId: 'r-rag-playing',
      receivedAt: 1700,
      eventSeq: 8,
    })
    page.client.onTTSEnd({
      eventId: 359,
      questionId: 'q-playing-rag',
      replyId: 'r-rag-playing',
      receivedAt: 1800,
      eventSeq: 9,
    })

    expect(page.player.stop).toHaveBeenCalledTimes(1)
    expect(page.messages).toEqual([
      { role: 'assistant', content: '结合广场舞记忆后的回复。' },
    ])
    expect(page.data.transcriptItems.map(item => item.content)).toEqual([
      '结合广场舞记忆后的回复。',
    ])
    expect(page.assistantTurnCount).toBe(2)
  })

  test('客户端文本查询的新 question 会转换当前逻辑轮而不是被丢弃', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
    }
    page.chatBuffer = ''
    page.pendingAssistantDraft = ''
    page.latencySamples = []
    const turn = page._ensureLatencyTurn({
      questionId: 'q-audio',
      receivedAt: 1000,
    })

    page._setupCallbacks()
    page.client.onChatText('安全重说内容', {
      questionId: 'q-text',
      replyId: 'r-text',
      previousQuestionId: 'q-audio',
      clientTextQueryTransition: true,
      receivedAt: 1200,
      eventSeq: 2,
    })

    expect(turn.originalQuestionId).toBe('q-audio')
    expect(turn.questionId).toBe('q-text')
    expect(turn.replyId).toBe('r-text')
    expect(page.chatBuffer).toBe('安全重说内容')
    page._clearAssistantTurnProgress('test_cleanup')
  })

  test('同一 question 的非 external_rag 新 reply 仍会被拒绝', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
    }
    page.chatBuffer = ''
    page.pendingAssistantDraft = ''
    page.latencySamples = []
    page._ensureLatencyTurn({ questionId: 'q-same', replyId: 'r-current', receivedAt: 1000 })

    page._setupCallbacks()
    page.client.onTTSStart('异常的新默认回复', {
      eventId: 350,
      questionId: 'q-same',
      replyId: 'r-unexpected',
      ttsType: 'default',
      receivedAt: 1100,
    })
    page.client.onAudioData(new Uint8Array([1, 2]).buffer, {
      eventId: 352,
      questionId: 'q-same',
      replyId: 'r-unexpected',
      receivedAt: 1200,
    })

    expect(page.player.stop).not.toHaveBeenCalled()
    expect(page.player.appendChunk).not.toHaveBeenCalled()
  })

  test('本地能量 VAD 不会把单帧突发噪声当成用户语音结束', () => {
    const page = loadPage()
    page.localVadState = {
      noiseFloor: 180,
      threshold: 540,
      speechActive: false,
      voicedFrames: 0,
      silenceFrames: 0,
      candidateVoiceAt: 0,
      candidateConfidence: 0,
      lastVoiceAt: 0,
      confidence: 0,
    }
    const loudFrame = new ArrayBuffer(640)
    const samples = new Int16Array(loudFrame)
    samples.fill(2000)
    const silentFrame = new ArrayBuffer(640)

    page._trackLocalVoiceFrame(loudFrame, 1000)
    expect(page.localVadState.lastVoiceAt).toBe(0)
    page._trackLocalVoiceFrame(silentFrame, 1020)
    expect(page.localVadState.lastVoiceAt).toBe(0)

    page._trackLocalVoiceFrame(loudFrame, 2000)
    page._trackLocalVoiceFrame(loudFrame, 2020)
    expect(page.localVadState.lastVoiceAt).toBe(2020)
    expect(page.localVadState.speechActive).toBe(true)
  })

  test('_isLowInfoSentence 能识别泛化短答与否定短答', () => {
    const page = loadPage()
    expect(page._isLowInfoSentence('过得还行吧')).toBe(true)
    expect(page._isLowInfoSentence('没有呢，没有出去玩')).toBe(true)
    expect(page._isLowInfoSentence('明天去医院复查膝盖')).toBe(false)
  })

  test('_pickFirstNotCooling 会跳过低信息记忆', () => {
    const page = loadPage()
    page.currentElderKey = 'elder:test:0005'
    const picked = page._pickFirstNotCooling([
      '过得还行吧',
      '没有呢，没有出去玩',
      '明天去医院复查膝盖',
    ])
    expect(picked).toBe('明天去医院复查膝盖')
  })

  test('_extractTopicMemoryCandidates 会按主题片段选高信息句', () => {
    const page = loadPage()
    const picked = page._extractTopicMemoryCandidates([
      '过得还行吧',
      '最近睡眠不太好，晚上总醒',
      '明天要去医院复查膝盖',
      '没有呢，没有出去玩',
      '这周想去公园散步活动一下',
    ], {
      maxItems: 3,
      maxSegments: 5,
      preferFuture: false,
      requireAction: false,
    })
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.some(item => item.includes('复查') || item.includes('散步'))).toBe(true)
    expect(picked).not.toContain('过得还行吧')
    expect(picked).not.toContain('没有呢，没有出去玩')
  })

  test('_extractInterestTags 会归一动作前缀避免“打太极拳/太极拳”重复', () => {
    const page = loadPage()
    const tags = page._extractInterestTags([
      '我喜欢打太极拳',
      '我平时也喜欢太极拳',
    ])
    expect(tags).toContain('太极拳')
    expect(tags.filter(item => item === '太极拳')).toHaveLength(1)
    expect(tags).not.toContain('打太极拳')
  })

  test('_buildMemoryAwareGreeting 在有待确认记忆时优先发起确认', () => {
    const page = loadPage()
    page.setData({ callMode: 'incoming' })
    const payload = page._buildMemoryAwareGreeting('王阿姨', {
      elderMemory: { recentEvents: [] },
      xiaolinMemory: { followUps: [] },
    }, null, { id: 'mem_1', text: '最近睡眠不太好' })

    expect(payload.text).toContain('确认')
    expect(payload.text).toContain('最近睡眠不太好')
  })

  test('_buildMemoryAwareGreeting 会避免直接引用提醒指令句', () => {
    const page = loadPage()
    page.setData({ callMode: 'outgoing' })
    const payload = page._buildMemoryAwareGreeting('张叔叔', {
      elderMemory: { recentEvents: [] },
      xiaolinMemory: { followUps: ['提醒张叔叔吃药'] },
    }, null, null)
    expect(payload.text).toBe('喂，张叔叔，我是小林。您找我呀？')
    expect(payload.text).not.toContain('想聊聊天或者设置提醒都可以')
    expect(payload.text).not.toContain('提醒张叔叔吃药')
  })

  test('_buildMemoryAwareGreeting 在立即通话时使用用户主导开场，不说“特地聊近况”', () => {
    const page = loadPage()
    page.setData({ callMode: 'outgoing' })
    const payload = page._buildMemoryAwareGreeting('龚阿姨', {
      elderMemory: { recentEvents: [] },
      xiaolinMemory: { followUps: ['最近睡眠不太好'] },
    }, null, null)
    expect(payload.text).toContain('您找我呀')
    expect(payload.text).not.toContain('特地来和您聊聊近况')
    expect(payload.text).not.toContain('最近睡眠不太好')
  })

  test('_buildMemoryAwareGreeting 在第一次语音时使用温暖首见开场', () => {
    const page = loadPage()
    page.setData({ callMode: 'outgoing' })
    const payload = page._buildMemoryAwareGreeting('方阿姨', {
      elderMemory: { recentEvents: ['最近睡眠不太好'] },
      xiaolinMemory: { followUps: ['最近睡眠不太好'] },
    }, null, null, { isFirstVoiceCall: true })

    expect(payload.text).toContain('方阿姨您好')
    expect(payload.text).toContain('第一次和您通话')
    expect(payload.text).toContain('慢慢聊')
    expect(payload.text).not.toContain('喂')
    expect(payload.text).not.toContain('最近睡眠不太好')
    expect(payload.usedMemoryText).toBe('')
  })

  test('_isFirstVoiceCall 只在无历史会话和无通话记录时成立', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    page.setData({ callMode: 'outgoing' })

    expect(page._isFirstVoiceCall('')).toBe(true)
    expect(page._isFirstVoiceCall('dialog_1')).toBe(false)

    store.addCallRecord({ id: 'call_existing' })
    expect(page._isFirstVoiceCall('')).toBe(false)

    page.setData({ callMode: 'incoming' })
    expect(page._isFirstVoiceCall('')).toBe(false)
  })

  test('_buildMemoryAwareGreeting 在吃药提醒来电时使用吃药语境提问', () => {
    const page = loadPage()
    page.setData({ callMode: 'incoming' })
    const payload = page._buildMemoryAwareGreeting('王阿姨', {
      elderMemory: { recentEvents: [] },
      xiaolinMemory: { followUps: [] },
    }, { id: 'rem_1', title: '吃降压药' }, null)

    expect(payload.text).toContain('到时间啦')
    expect(payload.text).toContain('提醒您吃降压药')
    expect(payload.text).toContain('方便吃吗')
    expect(payload.text).not.toContain('方便看一下')
    expect(payload.text).not.toContain('不急')
    expect(payload.text).not.toContain('完成了吗')
  })

  test('_buildCharacterManifest 明确提醒能力，避免引导手机闹钟', () => {
    const page = loadPage()
    const manifest = page._buildCharacterManifest({
      title: '王阿姨',
      voicePreset: { characterManifest: '温柔亲切', careStrategies: [] },
      memoryBundle: { elderMemory: {}, xiaolinMemory: {} },
    })

    expect(manifest).toContain('设置小程序内提醒')
    expect(manifest).toContain('不转去指导手机闹钟')
  })

  test('2.2.0.0 character_manifest 包含核心角色、安全及表达规则', () => {
    const page = loadPage()
    page.setData({ callMode: 'outgoing' })
    const manifest = page._buildCharacterManifest({
      title: '王阿姨',
      voicePreset: { characterManifest: '更有情感层次，但不过度夸张。', careStrategies: ['先共情再建议'] },
      memoryBundle: { elderMemory: {}, xiaolinMemory: {} },
      callMode: 'outgoing',
      isFirstVoiceCall: false,
    })

    expect(manifest).toContain('小林')
    expect(manifest).toContain('称呼原则')
    expect(manifest).toContain('一次只问一个问题')
    expect(manifest).toContain('不能承诺或描述线下执行任何动作')
    expect(manifest).toContain('设置小程序内提醒')
    expect(manifest).toContain('当前通话模式：立即通话')
    expect(manifest).toContain('更有情感层次，但不过度夸张')
    expect(manifest).not.toContain('动态记忆（健康背景')
  })

  test('核心规则写在 character_manifest，而不是只存在于 system_role', () => {
    const page = loadPage()
    const manifest = page._buildCharacterManifest({
      title: '王阿姨',
      voicePreset: { characterManifest: '温柔亲切', careStrategies: [] },
      memoryBundle: { elderMemory: {}, xiaolinMemory: {} },
      callMode: 'incoming',
    })
    expect(manifest).toContain('线下行动安全边界')
    expect(manifest).toContain('提醒能力边界')
    expect(manifest).toContain('电话式短句')
    expect(manifest).toContain('表达风格')
  })

  test('pending 健康记忆不会进入 character_manifest 或普通问候', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:pending-manifest'
    page.currentElderKey = elderKey
    page.setData({ callMode: 'incoming' })
    store.mergeMemoryBundle(elderKey, {
      elderMemory: {
        healthNotes: ['最近血压有点波动'],
      },
      memoryItems: [
        { type: 'healthNote', text: '最近血压有点波动', status: 'pending', needsConfirmation: true, confidence: 0.9 },
        { type: 'interest', text: '未确认书法', status: 'pending', needsConfirmation: true, confidence: 0.5 },
      ],
    }, 'call_pending_1')
    const bundle = store.getMemoryBundle(elderKey)
    const manifest = page._buildCharacterManifest({
      title: '王阿姨',
      voicePreset: { characterManifest: '温柔亲切', careStrategies: [] },
      memoryBundle: bundle,
    })
    expect(manifest).not.toContain('最近血压有点波动')
    expect(manifest).not.toContain('未确认书法')

    const greeting = page._buildMemoryAwareGreeting('王阿姨', bundle, null, null)
    expect(greeting.text).not.toContain('最近血压有点波动')
    expect(greeting.text).not.toContain('未确认书法')
    expect(greeting.usedMemoryText).toBe('')
  })

  test('preferredAddress 用于下次通话第一句和 character_manifest', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:preferred-greeting'
    page.currentElderKey = elderKey
    page.setData({ callMode: 'incoming' })
    store.mergeMemoryBundle(elderKey, {
      xiaolinMemory: { preferredAddress: '老李' },
    }, 'call_pref_1')
    const bundle = store.getMemoryBundle(elderKey)
    const greeting = page._buildMemoryAwareGreeting('王阿姨', bundle, null, null)
    expect(greeting.text).toContain('老李')
    expect(greeting.text).not.toContain('王阿姨')

    const manifest = page._buildCharacterManifest({
      title: '王阿姨',
      voicePreset: { characterManifest: '温柔亲切', careStrategies: [] },
      memoryBundle: bundle,
    })
    expect(manifest).toContain('老李')
  })

  test('_isReminderCommandLike 能识别“提醒某人起床”这类提醒句', () => {
    const page = loadPage()
    expect(page._isReminderCommandLike('小林提醒龚阿姨起床')).toBe(true)
    expect(page._isReminderCommandLike('上次聊到起床后去公园散步')).toBe(false)
  })

  test('_extractFollowUps 会过滤提醒指令句', () => {
    const page = loadPage()
    const followUps = page._extractFollowUps({
      highlights: ['提醒张叔叔下午2点出门跳广场舞', '明天去医院复查膝盖']
    }, [])
    expect(followUps).toContain('明天去医院复查膝盖')
    expect(followUps.some(text => text.includes('提醒张叔叔'))).toBe(false)
  })

  test('_extractMemoryDelta 不把明确提醒指令写入健康记忆', () => {
    const page = loadPage()
    const delta = page._extractMemoryDelta({
      id: 'call_health_reminder_1',
      messages: [
        { role: 'user', content: '哦，你提醒我明天九点吃药' },
      ],
    }, {
      topics: ['健康关注'],
      highlights: ['哦，你提醒我明天九点吃药'],
    })

    expect(delta.elderMemory.healthNotes).toEqual([])
  })

  test('_tryResolvePendingMemoryConfirmation 会按用户确认结果更新记忆状态', () => {
    const page = loadPage()
    page.currentElderKey = 'elder:test:0007'
    page.pendingMemoryConfirmation = { id: 'mem_pending_1', text: '最近睡眠不太好' }

    page._tryResolvePendingMemoryConfirmation('是的，这个情况一直有')
    expect(page.pendingMemoryConfirmation).toBe(null)

    page.pendingMemoryConfirmation = { id: 'mem_pending_2', text: '最近睡眠不太好' }
    page._tryResolvePendingMemoryConfirmation('不是，我没有这个问题')
    expect(page.pendingMemoryConfirmation).toBe(null)
  })

  test('ASR 最终识别在说出“提醒+时间”时会立刻入库提醒（P0/B）', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')

    const elderKey = 'elder:test:asr-reminder-1'
    page.currentElderKey = elderKey
    page._markCallConnectedIfNeeded = jest.fn()
    page._tryResolvePendingMemoryConfirmation = jest.fn()
    page.pendingMemoryConfirmation = null
    page.messages = []
    page.client = {}
    page.recorder = {}
    page.player = { appendChunk: jest.fn(), playBuffered: jest.fn(), stop: jest.fn(), playing: false }

    page._setupCallbacks()
    page.client.onASRText('提醒我明天早上九点钟吃药', true)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('吃药')
    expect(list[0].scheduleType).toBe('once')
    expect(list[0].timeOfDay).toBe('09:00')
    expect(list[0].status).toBe('pending')
  })

  test('ASR 最终识别支持“明早9点提醒我吃药”并直接入库', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')

    const elderKey = 'elder:test:asr-reminder-tomorrow-morning'
    page.currentElderKey = elderKey
    page._markCallConnectedIfNeeded = jest.fn()
    page._tryResolvePendingMemoryConfirmation = jest.fn()
    page.pendingMemoryConfirmation = null
    page.messages = []
    page.client = {}
    page.recorder = {}
    page.player = { appendChunk: jest.fn(), playBuffered: jest.fn(), stop: jest.fn(), playing: false }

    page._setupCallbacks()
    page.client.onASRText('明早9点提醒我吃药', true)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('吃药')
    expect(list[0].remindDate).toBe('2026-04-16')
    expect(list[0].timeOfDay).toBe('09:00')
    expect(list[0].status).toBe('pending')
  })

  test('ASR 最终识别支持中文数字时间“八点”并正确入库（P0/B）', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')

    const elderKey = 'elder:test:asr-reminder-cn-hour'
    page.currentElderKey = elderKey
    page._markCallConnectedIfNeeded = jest.fn()
    page._tryResolvePendingMemoryConfirmation = jest.fn()
    page.pendingMemoryConfirmation = null
    page.messages = []
    page.client = {}
    page.recorder = {}
    page.player = { appendChunk: jest.fn(), playBuffered: jest.fn(), stop: jest.fn(), playing: false }

    page._setupCallbacks()
    page.client.onASRText('每天早上八点提醒我关煤气', true)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('关煤气')
    expect(list[0].scheduleType).toBe('daily')
    expect(list[0].timeOfDay).toBe('08:00')
    expect(list[0].status).toBe('pending')
  })

  test('ASR 最终识别不会给“无时间的提醒”直接入库（P0/B）', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')

    const elderKey = 'elder:test:asr-reminder-2'
    page.currentElderKey = elderKey
    page._markCallConnectedIfNeeded = jest.fn()
    page._tryResolvePendingMemoryConfirmation = jest.fn()
    page.pendingMemoryConfirmation = null
    page.messages = []
    page.client = {}
    page.recorder = {}
    page.player = { appendChunk: jest.fn(), playBuffered: jest.fn(), stop: jest.fn(), playing: false }

    page._setupCallbacks()
    page.client.onASRText('提醒我怎么吃药', true)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(0)
  })

  test('ASR 最终识别会把未来计划写成待确认候选，不直接主动提醒', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-28T10:00:00.000+08:00'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')

    const elderKey = 'elder:test:asr-reminder-candidate'
    page.currentElderKey = elderKey
    page._markCallConnectedIfNeeded = jest.fn()
    page._tryResolvePendingMemoryConfirmation = jest.fn()
    page.pendingMemoryConfirmation = null
    page.messages = []
    page.client = {}
    page.recorder = {}
    page.player = { appendChunk: jest.fn(), playBuffered: jest.fn(), stop: jest.fn(), playing: false }

    page._setupCallbacks()
    page.client.onASRText('我明天去医院复查', true)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('医院复查')
    expect(list[0].status).toBe('candidate')
    expect(list[0].remindDate).toBe('2026-04-29')
    expect(store.pickNextIncomingReminder(elderKey)).toBe(null)
  })

  test('ASR 先写入口语化提醒后，摘要候选不会重复新增', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-28T10:00:00.000+08:00'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')

    const elderKey = 'elder:test:asr-summary-reminder-dedup'
    page.currentElderKey = elderKey
    page._markCallConnectedIfNeeded = jest.fn()
    page._tryResolvePendingMemoryConfirmation = jest.fn()
    page.pendingMemoryConfirmation = null
    page.messages = []
    page.client = {}
    page.recorder = {}
    page.player = { appendChunk: jest.fn(), playBuffered: jest.fn(), stop: jest.fn(), playing: false }

    page._setupCallbacks()
    page.client.onASRText('提醒我明天九点出门吧', true)

    let list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('出门')

    await page._evolveMemory({
      id: 'call_reminder_particle_1',
      messages: [
        { role: 'user', content: '提醒我明天九点出门吧' },
      ],
    }, {
      summary: '用户要求明天九点出门提醒',
      reminderCandidates: [
        {
          title: '出门',
          scheduleType: 'once',
          remindDate: '2026-04-29',
          timeOfDay: '09:00',
          confidence: 0.92,
          intentType: 'explicit_reminder',
          needsConfirmation: false,
          evidence: '提醒我明天九点出门吧',
        },
      ],
    })

    list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('出门')
    expect(list[0].confidence).toBe(0.92)
  })

  test('模拟呼入提醒回访后，不会重复新增同名提醒', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')

    const elderKey = 'elder:test:incoming-reminder-dedup'
    page.currentElderKey = elderKey

    store.saveReminder({
      title: '起床',
      scheduleType: 'daily',
      timeOfDay: '07:30',
      status: 'triggered',
    }, elderKey)

    const record = {
      id: 'call_incoming_1',
      messages: [
        { role: 'assistant', content: '我来提醒您“起床”。这件事完成了吗？' },
        { role: 'user', content: '完成了，谢谢你提醒我起床' },
      ],
    }

    page._evolveMemory(record, {
      summary: '本次为提醒回访电话',
      topics: ['日常提醒'],
      highlights: ['提醒回访起床'],
      reminderCandidates: [
        {
          title: '起床',
          scheduleType: 'daily',
          confidence: 0.9,
          evidence: '我来提醒您“起床”。这件事完成了吗？',
        },
      ],
      mood: '平静',
      moodEmoji: '😌',
    })

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('起床')
    expect(list[0].timeOfDay).toBe('07:30')
  })

  test('_evolveMemory 会优先使用 extractMemories 云函数返回的结构化记忆', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:cloud-memory'
    page.currentElderKey = elderKey
    wx.cloud = {
      callFunction: jest.fn(() => Promise.resolve({
        result: {
          success: true,
          data: {
            elderMemory: {
              interestTags: ['书法'],
            },
            xiaolinMemory: {
              followUps: ['下次问问书法班报名情况'],
            },
            memoryItems: [
              {
                type: 'interest',
                text: '最近在练书法',
                confidence: 0.88,
                evidence: '我最近在练书法',
                needsConfirmation: false,
              },
            ],
          },
        },
      })),
    }
    const record = {
      id: 'call_cloud_memory_1',
      messages: [
        { role: 'user', content: '我最近在练书法' },
        { role: 'assistant', content: '那很好呀，下次我再问问您练得怎么样。' },
      ],
    }

    await page._evolveMemory(record, {
      summary: '聊到书法练习',
      topics: ['书法'],
      highlights: ['老人最近在练书法'],
    })

    expect(wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: 'extractMemories',
    }))
    const bundle = store.getMemoryBundle(elderKey)
    const item = bundle.memoryItems.find(memory => memory.text === '最近在练书法')
    expect(item).toBeTruthy()
    expect(item.source).toBe('cloud_ark')
    expect(item.sourceCallId).toBe('call_cloud_memory_1')
    expect(item.evidence).toBe('我最近在练书法')
    expect(bundle.xiaolinMemory.followUps).toContain('下次问问书法班报名情况')
  })

  test('呼入回访已确认完成时，会抑制同提醒候选的二次入库', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const record = {
      id: 'call_incoming_done_1',
      messages: [
        { role: 'assistant', content: '我来提醒您“吃降压药”。这件事完成了吗？' },
        { role: 'user', content: '嗯，已经完成了' },
      ],
    }
    page.setData({ callMode: 'incoming' })
    page.incomingReminder = { id: 'rem_1', title: '吃降压药' }

    const candidates = page._extractReminderCandidates(record, {
      reminderCandidates: [
        {
          title: '每天九点吃降压药',
          scheduleType: 'daily',
          timeOfDay: '09:00',
          confidence: 0.9,
          evidence: '我来提醒您吃降压药，这件事完成了吗',
        },
      ],
    })
    expect(candidates).toHaveLength(0)
  })

  test('_handleIncomingReminderFollowup 在用户确认完成时会立即标记提醒完成', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:incoming-reminder-complete'
    page.currentElderKey = elderKey
    const reminder = store.saveReminder({
      title: '吃药',
      scheduleType: 'daily',
      timeOfDay: '08:00',
      status: 'triggered',
    }, elderKey)

    page.incomingReminder = { id: reminder.id, title: reminder.title }
    page.incomingFollowupState = {
      reminderCompleted: false,
      waitingNoMoreChatConfirm: false,
      shouldAutoEndAfterAssistant: false,
    }

    page._handleIncomingReminderFollowup('嗯，已完成啦')
    const list = store.getReminders(elderKey)
    const current = list.find(item => item.id === reminder.id)
    expect(current.status).toBe('done')
    expect(page.incomingFollowupState.waitingNoMoreChatConfirm).toBe(true)
    expect(page.incomingFollowupState.shouldAutoEndAfterAssistant).toBe(false)
  })

  test('_isReminderCompletedByUserText 按三层规则识别口语完成和未完成', () => {
    const page = loadPage()

    page.incomingReminder = { id: 'rem_1', title: '吃降压药' }
    expect(page._isReminderCompletedByUserText('嗯，已完成啦')).toBe(true)
    expect(page._isReminderCompletedByUserText('已经搞定啦')).toBe(true)
    expect(page._isReminderCompletedByUserText('刚才吃了')).toBe(true)
    expect(page._isReminderCompletedByUserText('还没完成')).toBe(false)
    expect(page._isReminderIncompleteByUserText('还没完成')).toBe(true)
    expect(page._isReminderCompletedByUserText('没来得及吃')).toBe(false)
    expect(page._isReminderIncompleteByUserText('没来得及吃')).toBe(true)

    page.incomingReminder = { id: 'rem_2', title: '测血压' }
    expect(page._isReminderCompletedByUserText('我刚量过了')).toBe(true)
    expect(page._isReminderCompletedByUserText('还没有量')).toBe(false)
    expect(page._isReminderIncompleteByUserText('还没有量')).toBe(true)
  })

  test('_handleIncomingReminderFollowup 不会把普通“没有”误判为结束', () => {
    const page = loadPage()
    page.incomingReminder = { id: 'rem_1', title: '复查' }
    page.incomingFollowupState = {
      reminderCompleted: false,
      waitingNoMoreChatConfirm: false,
      shouldAutoEndAfterAssistant: false,
    }

    page._handleIncomingReminderFollowup('没有，我还没去')
    page._handleExplicitEndCallIntent('没有，我还没去')

    expect(page.incomingFollowupState.shouldAutoEndAfterAssistant).toBe(false)
    expect(page.callEndingState).toBeUndefined()
  })

  test('_handleIncomingReminderFollowup 在“没别的想聊”时会触发收尾结束标记', () => {
    const page = loadPage()
    page.incomingReminder = { id: 'rem_1', title: '复查' }
    page.incomingFollowupState = {
      reminderCompleted: true,
      waitingNoMoreChatConfirm: true,
      shouldAutoEndAfterAssistant: false,
    }

    page._handleIncomingReminderFollowup('没有了，就先这样吧')
    expect(page.incomingFollowupState.shouldAutoEndAfterAssistant).toBe(true)
  })

  test('_handleExplicitEndCallIntent 只在明确结束语时触发普通通话收尾', () => {
    const page = loadPage()

    page._handleExplicitEndCallIntent('没有，我想再听听')
    expect(page.callEndingState).toBeUndefined()

    page._handleExplicitEndCallIntent('今天先这样吧，我挂了')
    expect(page.callEndingState.shouldAutoEndAfterAssistant).toBe(true)
    expect(page.callEndingState.source).toBe('user_end_intent')
  })
  function setupRagCallPage(page, elderKey) {
    page.currentElderKey = elderKey
    page._markCallConnectedIfNeeded = jest.fn()
    page._tryResolvePendingMemoryConfirmation = jest.fn()
    page.pendingMemoryConfirmation = null
    page.sentRagQuestionIds = new Set()
    page.ragInFlightKeys = new Set()
    page.lastRagFinalText = ''
    page.lastRagFinalTextAt = 0
    page.messages = []
    page.latencySamples = []
    page.currentLatencyTurn = null
    page.latencyRunId = 'rag-test'
    page.latencyTurnSeq = 0
    page.recorder = {}
    page.player = { appendChunk: jest.fn(), playBuffered: jest.fn(), stop: jest.fn(), playing: false }
    page.client = {
      sessionActive: true,
      sendRAGText: jest.fn(() => Promise.resolve(true)),
      sendTextQuery: jest.fn(),
    }
    page._setupCallbacks()
    return page.client
  }

  test('pending 记忆不会进入 RAG，没有相关记忆时不发送 502', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:rag-pending'
    store.mergeMemoryBundle(elderKey, {
      elderMemory: { healthNotes: ['最近血压有点波动'] },
      memoryItems: [
        { type: 'healthNote', text: '最近血压有点波动', status: 'pending', needsConfirmation: true, confidence: 0.92 },
      ],
    }, 'call_rag_pending')
    const client = setupRagCallPage(page, elderKey)
    client.onASRText('我最近血压怎么样', true, { questionId: 'q-pending-health' })
    expect(client.sendRAGText).not.toHaveBeenCalled()
    expect(client.sendTextQuery).not.toHaveBeenCalled()
  })

  test('confirmed 兴趣可在相关闲聊中召回，且 RAG 不调用 sendTextQuery', async () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:rag-interest'
    store.mergeMemoryBundle(elderKey, {
      memoryItems: [
        { type: 'interest', text: '太极拳', status: 'confirmed', needsConfirmation: false, confidence: 0.9 },
      ],
    }, 'call_rag_interest')
    const client = setupRagCallPage(page, elderKey)
    client.onASRText('最近太极拳还在打吗', true, { questionId: 'q-taiji' })
    await new Promise(r => setTimeout(r, 0))
    expect(client.sendRAGText).toHaveBeenCalledTimes(1)
    expect(client.sendTextQuery).not.toHaveBeenCalled()
    const ragItems = client.sendRAGText.mock.calls[0][0]
    expect(ragItems[0].title).toBe('长期记忆')
    expect(ragItems[0].content).toContain('太极拳')
    const used = store.getMemoryBundle(elderKey).memoryItems.find(item => item.text === '太极拳')
    expect(used.lastUsedAt).toBeTruthy()
  })

  test('广场舞建档原话只召回相关兴趣，不带入无关高血压记忆', async () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:rag-square-dance'
    store.initMemoryBundle(elderKey, {
      hobbies: ['广场舞'],
      health: '高血压',
      preferredAddress: '张叔叔',
    })
    const client = setupRagCallPage(page, elderKey)

    client.onASRText('我今天感觉自己跳广场舞跳得特别好', true, {
      questionId: 'q-square-dance-profile',
    })
    await new Promise(r => setTimeout(r, 0))

    expect(client.sendRAGText).toHaveBeenCalledTimes(1)
    expect(client.sendRAGText).toHaveBeenCalledWith([
      { title: '长期记忆', content: '广场舞' },
    ])
  })

  test('健康记忆不会在无关闲聊中召回，同一 questionId 不重复发送 RAG', async () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:rag-health-idle'
    store.mergeMemoryBundle(elderKey, {
      memoryItems: [
        { type: 'healthNote', text: '最近血压有点波动', status: 'confirmed', needsConfirmation: false, confidence: 0.92 },
        { type: 'interest', text: '太极拳', status: 'confirmed', needsConfirmation: false, confidence: 0.9 },
      ],
    }, 'call_rag_health')
    const client = setupRagCallPage(page, elderKey)
    client.onASRText('今天天气怎么样', true, { questionId: 'q-weather' })
    await new Promise(r => setTimeout(r, 0))
    expect(client.sendRAGText).not.toHaveBeenCalled()

    client.onASRText('最近太极拳还在打吗', true, { questionId: 'q-taiji-dup' })
    client.onASRText('最近太极拳还在打吗', true, { questionId: 'q-taiji-dup' })
    await new Promise(r => setTimeout(r, 0))
    expect(client.sendRAGText).toHaveBeenCalledTimes(1)
    const ragItems = client.sendRAGText.mock.calls[0][0]
    expect(ragItems.some(item => String(item.content).includes('血压'))).toBe(false)
  })

  test('RAG 发送失败不得中断通话，且不更新冷却', async () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:rag-fail'
    store.mergeMemoryBundle(elderKey, {
      memoryItems: [
        { type: 'interest', text: '太极拳', status: 'confirmed', needsConfirmation: false, confidence: 0.9 },
      ],
    }, 'call_rag_fail')
    const client = setupRagCallPage(page, elderKey)
    client.sendRAGText.mockImplementation(() => Promise.resolve(false))
    expect(() => {
      client.onASRText('最近太极拳还在打吗', true, { questionId: 'q-fail' })
    }).not.toThrow()
    await new Promise(r => setTimeout(r, 0))
    const item = store.getMemoryBundle(elderKey).memoryItems.find(row => row.text === '太极拳')
    expect(item.lastUsedAt || '').toBe('')
    expect(client.sendTextQuery).not.toHaveBeenCalled()
  })

  test('q1 成功 → q2 成功 → 再次 q1 不重发 502', async () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:rag-q1-q2-q1'
    store.mergeMemoryBundle(elderKey, {
      memoryItems: [
        { type: 'interest', text: '太极拳', status: 'confirmed', needsConfirmation: false, confidence: 0.9 },
      ],
    }, 'call_rag_q1_q2')
    const client = setupRagCallPage(page, elderKey)
    const ragText = '最近太极拳还在打吗'
    client.onASRText(ragText, true, { questionId: 'q1' })
    await new Promise(r => setTimeout(r, 0))
    const taijiItem = store.getMemoryBundle(elderKey).memoryItems.find(i => i.text === '太极拳')
    if (taijiItem) taijiItem.lastUsedAt = ''
    client.onASRText(ragText, true, { questionId: 'q2' })
    await new Promise(r => setTimeout(r, 0))
    client.onASRText(ragText, true, { questionId: 'q1' })
    await new Promise(r => setTimeout(r, 0))
    expect(client.sendRAGText).toHaveBeenCalledTimes(2)
    expect(page.sentRagQuestionIds.has('q1')).toBe(true)
    expect(page.sentRagQuestionIds.has('q2')).toBe(true)
  })

  test('q1 未完成 → q2 未完成 → 再次 q1 不重发 502', async () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:rag-inflight'
    store.mergeMemoryBundle(elderKey, {
      memoryItems: [
        { type: 'interest', text: '太极拳', status: 'confirmed', needsConfirmation: false, confidence: 0.9 },
      ],
    }, 'call_rag_inflight')
    const client = setupRagCallPage(page, elderKey)
    const resolvers = []
    client.sendRAGText.mockImplementation(() => new Promise(resolve => {
      resolvers.push(resolve)
    }))
    const ragText = '最近太极拳还在打吗'
    client.onASRText(ragText, true, { questionId: 'q1' })
    client.onASRText(ragText, true, { questionId: 'q2' })
    await new Promise(r => setTimeout(r, 0))
    expect(client.sendRAGText).toHaveBeenCalledTimes(2)
    expect(page.ragInFlightKeys.has('q1')).toBe(true)
    expect(page.ragInFlightKeys.has('q2')).toBe(true)

    client.onASRText(ragText, true, { questionId: 'q1' })
    await new Promise(r => setTimeout(r, 0))
    expect(client.sendRAGText).toHaveBeenCalledTimes(2)

    resolvers.forEach(resolve => resolve(true))
    await new Promise(r => setTimeout(r, 0))
  })

  test('q1 发送失败后可重试相同 questionId', async () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:rag-retry-q1'
    store.mergeMemoryBundle(elderKey, {
      memoryItems: [
        { type: 'interest', text: '太极拳', status: 'confirmed', needsConfirmation: false, confidence: 0.9 },
      ],
    }, 'call_rag_retry_q1')
    const client = setupRagCallPage(page, elderKey)
    client.sendRAGText
      .mockImplementationOnce(() => Promise.resolve(false))
      .mockImplementation(() => Promise.resolve(true))

    client.onASRText('最近太极拳还在打吗', true, { questionId: 'q1' })
    await new Promise(r => setTimeout(r, 0))
    expect(client.sendRAGText).toHaveBeenCalledTimes(1)
    expect(page.sentRagQuestionIds.has('q1')).toBe(false)

    client.onASRText('最近太极拳还在打吗', true, { questionId: 'q1' })
    await new Promise(r => setTimeout(r, 0))
    expect(client.sendRAGText).toHaveBeenCalledTimes(2)
    expect(page.sentRagQuestionIds.has('q1')).toBe(true)
  })

  test('无 questionId 时 1.8s 内同句去重，超窗后可再发', async () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:rag-text-dedupe'
    store.mergeMemoryBundle(elderKey, {
      memoryItems: [
        { type: 'interest', text: '太极拳', status: 'confirmed', needsConfirmation: false, confidence: 0.9 },
      ],
    }, 'call_rag_dedupe')
    const client = setupRagCallPage(page, elderKey)
    let nowVal = 10000
    jest.spyOn(Date, 'now').mockImplementation(() => nowVal)
    client.onASRText('最近太极拳还在打吗', true, {})
    await new Promise(r => setTimeout(r, 0))
    expect(client.sendRAGText).toHaveBeenCalledTimes(1)

    nowVal += 500
    client.onASRText('最近太极拳还在打吗', true, {})
    await new Promise(r => setTimeout(r, 0))
    expect(client.sendRAGText).toHaveBeenCalledTimes(1)

    nowVal += 2000
    // 清除记忆使用冷却，避免 store 12h 冷却阻断第三次发送
    const taijiItem = store.getMemoryBundle(elderKey).memoryItems.find(i => i.text === '太极拳')
    if (taijiItem) { taijiItem.lastUsedAt = '' }
    client.onASRText('最近太极拳还在打吗', true, {})
    await new Promise(r => setTimeout(r, 0))
    expect(client.sendRAGText).toHaveBeenCalledTimes(2)
    Date.now.mockRestore()
  })

  test('character_manifest 包含 PHONE_CONVERSATION_GUIDE 收尾规则', () => {
    const page = loadPage()
    const manifest = page._buildCharacterManifest({
      title: '王阿姨',
      voicePreset: { characterManifest: '温柔亲切', careStrategies: [] },
      memoryBundle: { elderMemory: {}, xiaolinMemory: {} },
      callMode: 'outgoing',
    })
    expect(manifest).toContain('收尾规则')
    expect(manifest).toContain('不继续抛新问题')
  })

  test('character_manifest 包含健康不适边界和120', () => {
    const page = loadPage()
    const manifest = page._buildCharacterManifest({
      title: '王阿姨',
      voicePreset: { characterManifest: '温柔亲切', careStrategies: [] },
      memoryBundle: { elderMemory: {}, xiaolinMemory: {} },
    })
    expect(manifest).toContain('健康不适边界')
    expect(manifest).toContain('联系120')
    expect(manifest).toContain('先共情')
  })

  test('character_manifest 只在提醒回访时包含五步规则', () => {
    const page = loadPage()
    const withReminder = page._buildCharacterManifest({
      title: '王阿姨',
      voicePreset: { characterManifest: '温柔亲切', careStrategies: [] },
      memoryBundle: { elderMemory: {}, xiaolinMemory: {} },
      usedReminderId: 'reminder-123',
    })
    expect(withReminder).toContain('提醒回访五步规则')
    expect(withReminder).toContain('首句只提醒事项')
    expect(withReminder).toContain('说一句短收尾')

    const withoutReminder = page._buildCharacterManifest({
      title: '王阿姨',
      voicePreset: { characterManifest: '温柔亲切', careStrategies: [] },
      memoryBundle: { elderMemory: {}, xiaolinMemory: {} },
    })
    expect(withoutReminder).not.toContain('提醒回访五步规则')
  })

  test('普通通话明确结束意图会等待小林最后一句播放完成后再结束', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page._endCall = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: true,
    }
    page.messages = []
    page.chatBuffer = ''
    page.pendingAssistantDraft = '好，那您先休息，咱们回头再聊。'
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 1
    page.isBoundaryRepairing = false
    page.currentLatencyTurn = null
    page.callEndingState = {
      shouldAutoEndAfterAssistant: false,
      pendingAutoEndAfterPlayback: false,
      source: '',
    }
    page.setData({
      currentAssistantDraft: '好，那您先休息，咱们回头再聊。',
      transcriptItems: [],
    })

    page._handleExplicitEndCallIntent('今天先这样吧，我挂了')
    page._setupCallbacks()
    page.client.onTTSEnd()
    expect(page._endCall).not.toHaveBeenCalled()
    expect(page.callEndingState.pendingAutoEndAfterPlayback).toBe(true)

    page.player.onPlayEnd()
    expect(page._endCall).toHaveBeenCalledTimes(1)
  })

  test('自动收尾会等待最后一句播放完成后再结束通话', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page._endCall = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: true,
    }
    page.messages = []
    page.chatBuffer = ''
    page.pendingAssistantDraft = '那我们今天就先聊到这里，您早点休息。'
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 1
    page.isBoundaryRepairing = false
    page.currentLatencyTurn = null
    page.incomingFollowupState = {
      reminderCompleted: true,
      waitingNoMoreChatConfirm: true,
      shouldAutoEndAfterAssistant: true,
      pendingAutoEndAfterPlayback: false,
    }
    page.setData({
      currentAssistantDraft: '那我们今天就先聊到这里，您早点休息。',
      transcriptItems: [],
    })

    page._setupCallbacks()
    page.client.onTTSEnd()
    expect(page._endCall).not.toHaveBeenCalled()
    expect(page.incomingFollowupState.pendingAutoEndAfterPlayback).toBe(true)

    page.player.onPlayEnd()
    expect(page._endCall).toHaveBeenCalledTimes(1)
  })

  test('自动收尾在播放器未进入播放态时会延迟兜底挂断', () => {
    jest.useFakeTimers()
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page._endCall = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
    }
    page.messages = []
    page.chatBuffer = ''
    page.pendingAssistantDraft = '那我们今天就先聊到这里，您早点休息。'
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 1
    page.isBoundaryRepairing = false
    page.currentLatencyTurn = null
    page.incomingFollowupState = {
      reminderCompleted: true,
      waitingNoMoreChatConfirm: true,
      shouldAutoEndAfterAssistant: true,
      pendingAutoEndAfterPlayback: false,
    }
    page.setData({
      currentAssistantDraft: '那我们今天就先聊到这里，您早点休息。',
      transcriptItems: [],
    })

    page._setupCallbacks()
    page.client.onTTSEnd()
    expect(page._endCall).not.toHaveBeenCalled()
    expect(page.incomingFollowupState.pendingAutoEndAfterPlayback).toBe(true)

    jest.advanceTimersByTime(4999)
    expect(page._endCall).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(page._endCall).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  test('自动收尾兜底会覆盖预计剩余播放时长而非固定 1.8 秒', () => {
    jest.useFakeTimers()
    const page = loadPage()
    page._endCall = jest.fn()
    page.currentLatencyTurn = null
    page.player = {
      getEstimatedRemainingMs: jest.fn(() => 10000),
    }
    page.callEndingState = {
      shouldAutoEndAfterAssistant: false,
      pendingAutoEndAfterPlayback: true,
      source: 'user_end_intent',
    }
    page.incomingFollowupState = {
      pendingAutoEndAfterPlayback: false,
    }

    page._startIncomingAutoEndGuard()
    jest.advanceTimersByTime(12999)
    expect(page._endCall).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(page._endCall).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  test('自动收尾到期时播放器仍忙会续期而不是截断', () => {
    jest.useFakeTimers()
    const page = loadPage()
    page._endCall = jest.fn()
    page.currentLatencyTurn = null
    page.player = {
      playing: true,
      preparingSegment: false,
      webPreparing: false,
      getEstimatedRemainingMs: jest.fn(() => 1000),
    }
    page.callEndingState = {
      shouldAutoEndAfterAssistant: false,
      pendingAutoEndAfterPlayback: true,
      source: 'user_end_intent',
    }
    page.incomingFollowupState = {
      pendingAutoEndAfterPlayback: false,
    }

    page._startIncomingAutoEndGuard()
    jest.advanceTimersByTime(5000)
    expect(page._endCall).not.toHaveBeenCalled()

    page.player.playing = false
    jest.advanceTimersByTime(5000)
    expect(page._endCall).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  test('AI 生成状态异常时会解锁半双工生成锁', () => {
    jest.useFakeTimers()
    const page = loadPage()
    page.currentLatencyTurn = null
    page.assistantTurnInProgress = false
    page.assistantTurnProgressTimer = null

    page._markAssistantTurnInProgress()
    expect(page.assistantTurnInProgress).toBe(true)
    jest.advanceTimersByTime(45000)
    expect(page.assistantTurnInProgress).toBe(false)
    expect(page.assistantTurnProgressTimer).toBe(null)
    jest.useRealTimers()
  })

  test('通话页 WXML 共用静音循环视频层，且无控制栏', () => {
    const fs = require('fs')
    const wxml = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/pages/call/call.wxml'), 'utf8')
    expect(wxml).toContain('id="companion-idle"')
    expect(wxml).toContain('id="companion-speaking"')
    expect(wxml).toContain('class="companion-stage"')
    expect(wxml).toContain('muted="{{true}}"')
    expect(wxml).toContain('loop="{{true}}"')
    expect(wxml).toContain('controls="{{false}}"')
    expect(wxml).toContain('show-center-play-btn="{{false}}"')
    expect(wxml).toContain('picture-in-picture-mode=""')
    expect(wxml).not.toContain('src="/assets/images/companion-xiaolin-call.jpg"')
    expect((wxml.match(/<video/g) || []).length).toBe(2)
    expect(wxml.indexOf('companion-stage')).toBeLessThan(wxml.indexOf('call-page'))
    expect(wxml.indexOf('companion-stage')).toBeLessThan(wxml.indexOf('incoming-page'))
  })

  test('会把 CloudBase 文件经临时 HTTPS 下到本地，并且初始化时只播 idle', () => {
    const page = loadPage()
    page.onLoad({ mode: 'incoming' })
    expect(page.data.companionPosterSrc).toBe('/assets/images/companion-xiaolin-call-v3.jpg')
    expect(page.data.companionIdleSrc).toBe('/tmp/companion-xiaolin-idle.mp4')
    expect(page.data.companionSpeakingSrc).toBe('/tmp/companion-xiaolin-speaking.mp4')
    expect(wx.cloud.getTempFileURL).toHaveBeenCalled()
    expect(wx.downloadFile).toHaveBeenCalled()
    expect(wx.cloud.downloadFile).not.toHaveBeenCalled()
    expect(wx.__videoContexts['companion-idle'].play).toHaveBeenCalled()
    expect(wx.__videoContexts['companion-speaking']).toBeTruthy()
    expect(wx.__videoContexts['companion-speaking'].play).not.toHaveBeenCalled()
    const downloadUrls = wx.downloadFile.mock.calls.map((args) => String(args[0].url || ''))
    const speakingIdx = downloadUrls.findIndex((url) => url.includes('speaking'))
    const idleIdx = downloadUrls.findIndex((url) => url.includes('idle'))
    expect(speakingIdx).toBeGreaterThanOrEqual(0)
    expect(idleIdx).toBeGreaterThan(speakingIdx)
    page.onUnload()
  })

  test('speaking 没下完之前不会开始下 idle', () => {
    const pending = []
    wx.downloadFile.mockImplementation(({ url, filePath, success }) => {
      const name = String(url || '').split('?')[0].split('/').pop()
      const done = () => success({
        tempFilePath: filePath || `/tmp/${name || 'video.mp4'}`,
        statusCode: 200,
      })
      if (String(url).includes('speaking')) {
        pending.push(done)
        return
      }
      done()
    })
    const page = loadPage()
    page.onLoad({ mode: 'incoming' })
    expect(pending).toHaveLength(1)
    expect(wx.downloadFile.mock.calls).toHaveLength(1)
    expect(String(wx.downloadFile.mock.calls[0][0].url)).toContain('speaking')
    expect(page.data.companionSpeakingSrc).toBe('')
    expect(page.data.companionIdleSrc).toBe('')
    pending[0]()
    expect(page.data.companionSpeakingSrc).toBe('/tmp/companion-xiaolin-speaking.mp4')
    expect(page.data.companionIdleSrc).toBe('/tmp/companion-xiaolin-idle.mp4')
    expect(wx.downloadFile.mock.calls).toHaveLength(2)
    expect(String(wx.downloadFile.mock.calls[1][0].url)).toContain('idle')
    page.onUnload()
  })

  test('本地已缓存时进通话页不再下载', () => {
    wx.__fs.__savedFiles.add('/tmp/companion-xiaolin-idle.mp4')
    wx.__fs.__savedFiles.add('/tmp/companion-xiaolin-speaking.mp4')
    const page = loadPage()
    page.onLoad({ mode: 'incoming' })
    expect(wx.downloadFile).not.toHaveBeenCalled()
    expect(page.data.companionIdleSrc).toBe('/tmp/companion-xiaolin-idle.mp4')
    expect(page.data.companionSpeakingSrc).toBe('/tmp/companion-xiaolin-speaking.mp4')
    page.onUnload()
  })

  test('临时地址为空时回落到 CloudBase CDN，不再把 cloud:// 交给 video', () => {
    wx.cloud.getTempFileURL.mockImplementation(({ fileList, success }) => {
      success({
        fileList: (fileList || []).map((fileID) => ({
          fileID,
          tempFileURL: '',
          status: -403003,
          errMsg: 'empty download url',
        })),
      })
    })
    wx.downloadFile.mockImplementation(({ fail }) => {
      if (typeof fail === 'function') fail({ errMsg: 'downloadFile:fail url not in domain list' })
    })
    const page = loadPage()
    page.onLoad({ mode: 'incoming' })
    expect(page.data.companionIdleSrc).toBe('https://636c-test-bucket.tcb.qcloud.la/companion-xiaolin-idle.mp4')
    expect(page.data.companionSpeakingSrc).toBe('https://636c-test-bucket.tcb.qcloud.la/companion-xiaolin-speaking.mp4')
    expect(page.data.companionIdleSrc.startsWith('cloud://')).toBe(false)
    page.onUnload()
  })

  test('idle 视频在 loadedmetadata 后就会显示，不依赖 play 事件', () => {
    const page = loadPage()
    page.onLoad({ mode: 'incoming' })
    expect(page.data.showIdleVideo).toBe(false)
    page.onCompanionIdleLoaded()
    expect(page.data.showIdleVideo).toBe(true)
    expect(page.data.companionVisualState).toBe('idle')
    page.onUnload()
  })

  test('接通后问候出声前保持海报，不先播 idle', () => {
    const page = loadPage()
    page.onLoad({ mode: 'incoming' })
    page.onCompanionIdleLoaded()
    expect(page.data.showIdleVideo).toBe(true)

    page.companionDeferIdle = true
    page._requestCompanionVisual('idle')
    expect(page.data.showIdleVideo).toBe(false)
    expect(page.data.companionVisualState).toBe('poster')
    page.onCompanionIdlePlay()
    expect(page.data.showIdleVideo).toBe(false)

    page._setupCallbacks()
    page.player.onPlayStart({
      at: Date.now(),
      source: 'inner_audio_on_play',
      authoritative: true,
    })
    page.onCompanionSpeakingPlay()
    expect(page.data.showSpeakingVideo).toBe(true)
    expect(page.data.companionVisualState).toBe('speaking')

    page.waitingGreetingPlaybackEnd = true
    page.player.onPlayEnd()
    expect(page.companionDeferIdle).toBe(false)
    expect(page.companionExpectedState).toBe('idle')
    page.onUnload()
  })

  test('TTS 开始或收到音频不会进入 speaking，真实 onPlayStart 后才切换', () => {
    const page = loadPage()
    page.onLoad({ mode: 'incoming' })
    page.onCompanionIdlePlay()
    expect(page.data.showIdleVideo).toBe(true)
    expect(page.data.companionVisualState).toBe('idle')

    page._setupCallbacks()
    page.client.onTTSStart('您好呀，我是小林。')
    expect(page.data.isAssistantSpeaking).toBe(false)
    expect(page.data.showSpeakingVideo).toBe(false)
    expect(page.companionExpectedState).toBe('idle')

    page.client.onAudioData(new Uint8Array(640).buffer)
    expect(page.data.isAssistantSpeaking).toBe(false)
    expect(page.data.showSpeakingVideo).toBe(false)

    page.player.onPlayStart({
      at: Date.now(),
      source: 'inner_audio_on_play',
      authoritative: true,
    })
    expect(page.data.isAssistantSpeaking).toBe(true)
    expect(page.companionExpectedState).toBe('speaking')
    expect(page.data.showSpeakingVideo).toBe(false)
    expect(page.data.showIdleVideo).toBe(true)
    expect(wx.__videoContexts['companion-speaking'].play).toHaveBeenCalled()

    page.onCompanionSpeakingPlay()
    expect(page.data.showSpeakingVideo).toBe(true)
    expect(page.data.companionVisualState).toBe('speaking')
    expect(wx.__videoContexts['companion-idle'].pause).toHaveBeenCalled()
    page.onUnload()
  })

  test('播放结束、播放错误和挂断都会从 speaking 回到 idle', () => {
    const page = loadPage()
    page.onLoad({ mode: 'incoming' })
    page._setupCallbacks()
    page.onCompanionIdlePlay()

    page.player.onPlayStart({ at: 1, source: 'inner_audio_on_play', authoritative: true })
    page.onCompanionSpeakingPlay()
    expect(page.data.showSpeakingVideo).toBe(true)

    page.player.onPlayEnd()
    page.onCompanionIdlePlay()
    expect(page.data.isAssistantSpeaking).toBe(false)
    expect(page.data.showSpeakingVideo).toBe(false)
    expect(page.data.showIdleVideo).toBe(true)

    page.player.onPlayStart({ at: 2, source: 'inner_audio_on_play', authoritative: true })
    page.onCompanionSpeakingPlay()
    page.player.onPlayError({ stage: 'playback' })
    page.onCompanionIdlePlay()
    expect(page.data.isAssistantSpeaking).toBe(false)
    expect(page.data.showSpeakingVideo).toBe(false)
    expect(page.data.companionVisualState).toBe('idle')

    page.player.onPlayStart({ at: 3, source: 'inner_audio_on_play', authoritative: true })
    page.onCompanionSpeakingPlay()
    page.onHangup()
    page.onCompanionIdlePlay()
    expect(page.data.status).toBe('ended')
    expect(page.data.isAssistantSpeaking).toBe(false)
    expect(page.data.showSpeakingVideo).toBe(false)
    expect(page.data.companionVisualState).toBe('idle')
    page.onUnload()
  })

  test('idle 或 speaking 视频失败时回落到静态海报', () => {
    const page = loadPage()
    page.onLoad({ mode: 'incoming' })
    page.onCompanionIdlePlay()
    expect(page.data.showIdleVideo).toBe(true)

    page.onCompanionIdleError()
    expect(page.data.companionVisualState).toBe('poster')
    expect(page.data.showIdleVideo).toBe(false)
    expect(page.data.showSpeakingVideo).toBe(false)

    const speakingPage = loadPage()
    speakingPage.onLoad({ mode: 'incoming' })
    speakingPage._setupCallbacks()
    speakingPage.onCompanionIdlePlay()
    speakingPage.player.onPlayStart({ at: 1, source: 'inner_audio_on_play', authoritative: true })
    speakingPage.onCompanionSpeakingPlay()
    speakingPage.onCompanionSpeakingError()
    speakingPage.onCompanionIdlePlay()
    expect(speakingPage.data.showSpeakingVideo).toBe(false)
    expect(speakingPage.data.companionVisualState).toBe('idle')
    page.onUnload()
    speakingPage.onUnload()
  })

  test('隐藏和卸载会停止视频，迟到回调不能把画面打回 speaking', () => {
    const page = loadPage()
    page.onLoad({ mode: 'incoming' })
    page._setupCallbacks()
    page.onCompanionIdlePlay()
    page.player.onPlayStart({ at: 1, source: 'inner_audio_on_play', authoritative: true })
    page.onCompanionSpeakingPlay()
    expect(page.data.showSpeakingVideo).toBe(true)

    page.onHide()
    expect(page.data.companionVisualState).toBe('poster')
    expect(page.data.showSpeakingVideo).toBe(false)
    expect(wx.__videoContexts['companion-idle'].pause).toHaveBeenCalled()
    expect(wx.__videoContexts['companion-speaking'].pause).toHaveBeenCalled()

    page.onCompanionSpeakingPlay()
    expect(page.data.showSpeakingVideo).toBe(false)
    expect(page.data.companionVisualState).toBe('poster')

    page.connectedUiTimer = setTimeout(() => {}, 60000)
    page.failNavigateTimer = setTimeout(() => {}, 60000)
    page.endNavigateTimer = setTimeout(() => {}, 60000)
    page.onUnload()
    expect(page.companionDestroyed).toBe(true)
    expect(page.idleVideoContext).toBe(null)
    expect(page.speakingVideoContext).toBe(null)
    expect(page.connectedUiTimer).toBe(null)
    expect(page.failNavigateTimer).toBe(null)
    expect(page.endNavigateTimer).toBe(null)
    expect(page.assistantTurnProgressTimer).toBe(null)
    expect(wx.__videoContexts['companion-idle'].stop).toHaveBeenCalled()
    expect(wx.__videoContexts['companion-speaking'].stop).toHaveBeenCalled()

    page.onCompanionIdlePlay()
    page.onCompanionSpeakingPlay()
    expect(page.data.showIdleVideo).toBe(false)
    expect(page.data.showSpeakingVideo).toBe(false)
  })
})
