const { RealtimeAPIClient } = require('../../utils/realtime-api')
const { AudioRecorder, AudioPlayer, FRAME_SIZE } = require('../../utils/audio')
const store = require('../../utils/store')
const { generateSummary, applyLocalSummary } = require('../../utils/call-finalizer')
const reminderExtractor = require('../../utils/reminder-extractor')
const cloudFunctions = require('../../utils/cloud-functions')
const createLogger = (() => {
  try {
    const loggerModule = require('../../utils/logger')
    if (loggerModule && loggerModule.createLogger) return loggerModule.createLogger
  } catch (err) {}
  return (scope) => {
    const prefix = scope ? `[${scope}]` : ''
    return {
      info() {},
      warn(...args) { globalThis.console.warn(prefix, ...args) },
      error(...args) { globalThis.console.error(prefix, ...args) },
    }
  }
})()
const normalizeSummaryPayload = (() => {
  function normalizeTextList(items, maxCount) {
    if (!Array.isArray(items)) return []
    const uniqMap = {}
    items.forEach((item) => {
      const text = String(item || '').trim()
      if (!text || uniqMap[text]) return
      uniqMap[text] = true
    })
    return Object.keys(uniqMap).slice(0, maxCount || 5)
  }
  function normalizeMoodLabel(input) {
    const text = String(input || '').trim()
    if (text === '开心' || text === '平静' || text === '低落' || text === '焦虑') return text
    if (/焦虑|担心|紧张|害怕|不舒服|难受|疼|痛/.test(text)) return '焦虑'
    if (/低落|难过|伤心|孤单|孤独|失落/.test(text)) return '低落'
    if (/开心|高兴|愉快|放心|舒服多了|好多了|顺利/.test(text)) return '开心'
    if (/平静|稳定|平稳/.test(text)) return '平静'
    return ''
  }
  function normalizeMoodEmoji(input, moodLabel) {
    const text = String(input || '').trim()
    const map = { 开心: '😊', 平静: '😌', 低落: '😢', 焦虑: '😟' }
    if (map[moodLabel]) return map[moodLabel]
    if (text === '😊' || text === '😌' || text === '😢' || text === '😟') return text
    return ''
  }
  function inferMoodFromText(text) {
    const normalized = String(text || '').replace(/\s+/g, '')
    if (!normalized) return { mood: '😌', moodLabel: '平静' }
    if (/(担心|焦虑|紧张|害怕|慌|发愁|烦|睡不着|失眠|不舒服|难受|疼|痛|胸闷|胸痛|头晕|血压高|血糖高|没药|忘吃药)/.test(normalized)) return { mood: '😟', moodLabel: '焦虑' }
    if (/(难过|低落|伤心|没意思|孤单|孤独|失落|想哭|不想说话|提不起劲)/.test(normalized)) return { mood: '😢', moodLabel: '低落' }
    if (/(开心|高兴|不错|挺好|愉快|放心|舒服多了|好多了|顺利|满意)/.test(normalized)) return { mood: '😊', moodLabel: '开心' }
    return { mood: '😌', moodLabel: '平静' }
  }
  function inferMoodFromMessages(messages) {
    const userText = (messages || [])
      .filter(item => item && item.role === 'user')
      .map(item => String(item.content || '').trim())
      .join(' ')
    return inferMoodFromText(userText)
  }
  const fallback = (summaryData, record, options) => {
    const payload = summaryData && typeof summaryData === 'object' ? summaryData : {}
    const moodFromModel = normalizeMoodLabel(payload.mood || payload.moodLabel)
    const moodFallback = inferMoodFromMessages((record && record.messages) || [])
    const summarySource = String(payload.summarySource || (options && options.preferSource) || 'local_rule').trim()
    const shouldUseMoodFallback = moodFromModel === '平静'
      && moodFallback.moodLabel
      && moodFallback.moodLabel !== '平静'
      && summarySource === 'local_rule'
    const finalMoodLabel = shouldUseMoodFallback
      ? moodFallback.moodLabel
      : (moodFromModel || moodFallback.moodLabel || '平静')
    const finalMoodEmoji = normalizeMoodEmoji(payload.moodEmoji, finalMoodLabel) || moodFallback.mood || '😌'
    return {
      summary: String(payload.summary || '').trim(),
      topics: normalizeTextList(payload.topics, 6),
      highlights: normalizeTextList(payload.highlights, 5),
      reminderCandidates: Array.isArray(payload.reminderCandidates) ? payload.reminderCandidates : [],
      mood: finalMoodEmoji,
      moodLabel: finalMoodLabel,
      summarySource,
      summaryModel: String(payload.summaryModel || '').trim(),
    }
  }
  try {
    const rules = require('../../utils/shared-rules')
    if (rules && rules.normalizeSummaryPayload) return rules.normalizeSummaryPayload
  } catch (err) {}
  return fallback
})()
const logger = createLogger('Call')
const console = {
  log: (...args) => logger.info(...args),
  warn: (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args),
}
const SUBTITLE_THROTTLE_MS = 120
const USER_DRAFT_THROTTLE_MS = 120
const TRANSCRIPT_MAX_ITEMS = 30
const ENABLE_AUTO_SESSION_REFRESH = false
const FLOW_LOG_PREFIX = '[CallFlow]'
const ALLOW_UPLINK_DURING_PLAYBACK = false
const UPLINK_KEEPALIVE_INTERVAL_MS = 1200
const UPLINK_IDLE_TRIGGER_MS = 1800
const GREETING_ECHO_GUARD_MAX_MS = 8000
const RECORDER_RESTART_COOLDOWN_MS = 3500
const PLAYBACK_ECHO_TAIL_GUARD_MS = 420
const REMINDER_COMPLETE_HINTS = ['完成了', '办好了', '弄好了', '已经好了', '处理好了', '做完了', '解决了']
const REMINDER_INCOMPLETE_HINTS = ['还没', '没做完', '没完成', '还没弄好', '还没办好', '没处理完', '还在弄']
const NO_MORE_CHAT_HINTS = ['没有了', '没了', '没别的', '没其他', '不用了', '先这样', '不聊了', '没什么了', '就这样吧', '不用聊了']
const SMALL_TALK_INTENT_HINTS = ['聊聊天', '聊聊', '随便聊', '没啥事', '没什么事', '就是想聊', '想说说话', '陪我聊', '说说话']
const CONCRETE_NEED_HINTS = ['提醒', '记得', '复查', '复诊', '吃药', '测血压', '血糖', '不舒服', '难受', '胸闷', '胸痛', '头晕', '帮我', '联系', '预约', '挂号', '怎么做', '怎么办']
const END_CALL_INTENT_HINTS = ['先这样吧', '先这样了', '就这样吧', '我挂了', '挂了啊', '不聊了', '不用聊了', '回头再说', '下次再聊', '改天再聊', '今天先到这', '今天就到这', '先聊到这', '再见', '拜拜']
const GREETING_MEMORY_COOLDOWN_MS = 48 * 60 * 60 * 1000
const MIN_CONNECTING_UI_MS = 2200
const CONNECTING_FALLBACK_MS = 6500
const INCOMING_AUTO_END_PLAYBACK_GRACE_MS = 1800
const SPEAKER_FALLBACK_CHAIN = [
  'saturn_zh_female_wenrouwenya_tob',
  'saturn_zh_female_tiexinnvyou_tob',
]
const BOUNDARY_VIOLATION_PATTERNS = [
  /(我|我来|我可以|我能|我去|我会).{0,6}(陪您|陪你).{0,8}(去|到).{0,10}(医院|门诊|看病|复诊|体检)/,
  /(我|我来|我可以|我能|我去|我会).{0,8}(上门|过去|到您家|去您家)/,
  /(我|我来|我可以|我能|我去|我会).{0,8}(帮您买|给您买|代买|代办|跑腿|送过去|寄给您|陪同就医)/,
]
const BOUNDARY_SAFE_REPLY = '我不能线下陪同或代办，但我可以马上帮您联系对应的人。您这件事我建议先联系家人；如果是紧急不适，我现在就帮您优先联系120。'
const DEFAULT_VOICE_PRESET = 'expressive'
const UPLINK_CHUNK_BYTES = FRAME_SIZE || 640
const SC20_EXPERIMENT_TAG = 'sc20_v1_wenrouwenya_keepalive_vad1300'
const DEFAULT_ASR_PROFILE = Object.freeze({
  mode: 'steady',
  enableCustomVad: true,
  // 用户反馈思考停顿容易被提前判停，默认回调到更稳妥窗口
  endSmoothWindowMs: 1300,
  enableAsrTwopass: true,
  hotwords: [
    '小林', '提醒', '提醒我', '叫我', '通知我',
    '吃药', '服药', '测血压', '测血糖',
    '复查', '复诊', '医院复查', '关煤气',
    '明天', '后天', '大后天', '下周一', '每天', '每周一',
    '太极拳',
  ],
  correctWords: {
    小玲: '小林',
    浮查: '复查',
    复擦: '复查',
    量血压: '测血压',
    关煤汽: '关煤气',
  },
})
const LATENCY_BASELINE_TARGET = Object.freeze({
  playP50MaxMs: 2200,
  playP90MaxMs: 3600,
})
const CARE_RESPONSE_PLAYBOOK = [
  '关怀策略卡：先接住情绪（复述感受）-> 再追问一个具体细节（时间/地点/人物）-> 再给1-2条电话内可执行建议 -> 最后温和收束并确认是否需要继续帮忙。',
  '场景路由：普通闲聊=多问生活细节、少说教；低落情绪=先安抚后建议；健康不适=先评估风险再转介家属/医生；提醒回访=先确认进展再给下一步。',
].join('\n')
const PHONE_CONVERSATION_GUIDE = [
  '电话感规则：像熟人打电话，不报功能菜单；每轮1-2句，一次只推进一个重点。',
  '追问规则：一次只问一个问题。用户停顿或回答很短时，先接住，再轻轻追问。',
  '开场规则：第一句要短。用户主动打来时先确认来意，不在第一句带历史记忆。',
  '收尾规则：用户明确说“先这样吧/我挂了/不聊了/回头再说/再见”时，只说一句短收尾，不继续抛新问题，等对方挂断。',
].join('\n')
const VOICE_PRESET_CONFIG = {
  safe: {
    label: '自然稳健',
    speakingStyle: '说话温柔自然，句子短一点，停顿清楚，语速平稳偏慢，优先保证可懂度',
    characterManifest: '温柔、耐心、短句表达、信息明确，优先保证老人可理解。',
    careStrategies: ['语速自然正常', '语句简短', '多确认理解', '情绪表达克制而温暖'],
    tts: { speechRate: -2, loudnessRate: -4, enableLoudnessNorm: true },
  },
  balanced: {
    label: '轻情感',
    speakingStyle: '说话自然亲切，适度加入情绪起伏，句子保持口语化，停顿柔和',
    characterManifest: '自然亲切，保持口语化，但每句话只表达一个重点。',
    careStrategies: ['语速自然正常', '口语化表达', '多给共情反馈', '建议保持可执行'],
    tts: { speechRate: 0, loudnessRate: 0, enableLoudnessNorm: true },
  },
  expressive: {
    label: '情感实验',
    speakingStyle: '说话更有情感层次，但不要夸张，保持语义清晰和断句稳定',
    characterManifest: '更有情感层次，但不过度夸张，始终保持清晰断句。',
    careStrategies: ['语速自然正常', '口语化表达', '先共情再建议', '高风险场景优先安抚与转介'],
    tts: { speechRate: 6, loudnessRate: 3, enableLoudnessNorm: true },
  },
}

Page({
  data: {
    status: 'connecting', // connecting | connected | ended
    connectionPhase: 'dialing', // dialing | authorizing | connecting | preparing | ready
    connectionHint: '正在呼叫...',
    elapsed: 0,
    elapsedText: '00:00',
    transcriptItems: [],
    currentUserDraft: '',
    currentAssistantDraft: '',
    transcriptAnchorId: 'transcript-anchor',
    transcriptScrollTop: 0,
    isSpeaking: false,
    isAssistantSpeaking: false,
    showIncoming: false, // 是否展示来电界面
    callMode: 'outgoing', // outgoing | incoming
    isIncomingAnswering: false,
    incomingHint: '正在响铃...',
    incomingReminderTitle: '',
  },

  onLoad(options) {
    this.client = new RealtimeAPIClient()
    this.recorder = new AudioRecorder()
    this.player = new AudioPlayer()
    this.timer = null
    this.chatBuffer = ''
    this.pendingAssistantDraft = ''
    this.messages = []
    this.hasFinalizedCall = false
    this.currentElderKey = store.getElderKey()
    this.assistantTurnCount = 0
    this.isRefreshingSession = false
    this.sessionOptions = null
    this.assistantDraftFlushTimer = null
    this.assistantDraftLastFlushAt = 0
    this.userDraftFlushTimer = null
    this.userDraftLastFlushAt = 0
    this.pendingUserDraft = ''
    this.currentLatencyTurn = null
    this.latencySamples = []
    this.lastUplinkBlockReason = ''
    this.isRecoveringDisconnect = false
    this.lastAudioUplinkAt = 0
    this.uplinkKeepaliveTimer = null
    this.silenceFrame = null
    this.initialEchoGuardActive = true
    this.waitingGreetingPlaybackEnd = false
    this.greetingEchoGuardTimer = null
    this.lastRecorderRestartAt = 0
    this.playbackEchoGuardUntil = 0
    this.currentSpeakerIndex = 0
    this.isSwitchingSpeaker = false
    this.callStartAt = Date.now()
    this.uplinkRemainder = new Uint8Array(0)
    this.stabilityMetrics = {
      idleTimeoutCount: 0,
      reconnectAttempts: 0,
      reconnectSuccess: 0,
    }
    this.hasSwitchedToConnected = false
    this.connectingFallbackTimer = null
    this.incomingAutoEndTimer = null
    this.currentTurnBoundaryViolated = false
    this.isBoundaryRepairing = false
    this.incomingReminder = null
    this.incomingFollowupState = {
      reminderCompleted: false,
      waitingNoMoreChatConfirm: false,
      shouldAutoEndAfterAssistant: false,
      pendingAutoEndAfterPlayback: false,
    }
    this.callEndingState = {
      shouldAutoEndAfterAssistant: false,
      pendingAutoEndAfterPlayback: false,
      source: '',
    }
    this.timeWeatherContext = store.getMockTimeWeatherContext()
    this.pendingMemoryConfirmation = null
    this.lastSmallTalkSteerAt = 0

    // incoming 模式：先显示来电界面
    if (options.mode === 'incoming') {
      this.incomingReminder = this._resolveIncomingReminder(options)
      this.setData({
        showIncoming: true,
        callMode: 'incoming',
        incomingReminderTitle: this.incomingReminder && this.incomingReminder.title ? this.incomingReminder.title : '',
      })
    } else {
      this._startCall()
    }
  },

  onUnload() {
    this._cleanup()
  },

  // ===== 来电界面操作 =====
  onAccept() {
    if (this.data.isIncomingAnswering) return
    this.setData({
      status: 'connecting',
      connectionPhase: 'dialing',
      connectionHint: '正在接听，马上就好...',
      isIncomingAnswering: true,
      incomingHint: '正在接听，请稍候...',
    })
    this._startCall()
  },

  onDecline() {
    if (this.data.isIncomingAnswering) return
    wx.navigateBack()
  },

  onTranscriptScroll(e) {
    const detail = e && e.detail ? e.detail : {}
    const scrollTop = Number(detail.scrollTop || 0)
    if (!Number.isFinite(scrollTop)) return
    this.setData({ transcriptScrollTop: Math.max(0, Math.floor(scrollTop)) })
  },

  onTranscriptScrollToLower() {
    // 保持锚点在底部，避免新分片到来时滚动抖动
    this.setData({ transcriptAnchorId: 'transcript-anchor' })
  },

  // ===== 通话核心逻辑 =====
  async _startCall() {
    this._setupCallbacks()
    this._setConnectionPhase('dialing')
    console.log(FLOW_LOG_PREFIX, '开始通话初始化')

    try {
      const elderConfig = store.getElderConfig()
      const title = store.getElderTitle()
      this.currentElderKey = store.getElderKey(elderConfig)
      const dialogId = store.getDialogId(this.currentElderKey)
      const memoryBundle = store.getMemoryBundle(this.currentElderKey)
      const pendingConfirm = this._pickPendingMemoryConfirmation()
      this.pendingMemoryConfirmation = pendingConfirm
      const isFirstVoiceCall = this._isFirstVoiceCall(dialogId)
      const greetingPayload = this._buildMemoryAwareGreeting(title, memoryBundle, this.incomingReminder, pendingConfirm, {
        isFirstVoiceCall,
      })
      const memoryContext = store.buildMemoryContext
        ? store.buildMemoryContext(this.currentElderKey, {
          intent: this.data.callMode === 'incoming' ? 'opening' : 'outgoingNeed',
          callMode: this.data.callMode,
          maxItems: 1,
          minConfidence: 0.6,
          includePreferredAddress: true,
        })
        : { prompt: store.buildMemoryPrompt(this.currentElderKey, { maxItems: 1, minConfidence: 0.6 }) }
      const memoryPrompt = greetingPayload.usedMemoryText
        ? ''
        : (memoryContext && memoryContext.prompt ? memoryContext.prompt : '')
      const contextPrompt = this.timeWeatherContext && this.timeWeatherContext.prompt
        ? `\n当前场景：${this.timeWeatherContext.prompt}`
        : ''

      const voicePreset = VOICE_PRESET_CONFIG[DEFAULT_VOICE_PRESET] || VOICE_PRESET_CONFIG.safe
      const layeredPersonaManifest = this._buildCharacterManifest({
        title,
        voicePreset,
        memoryBundle,
      })
      const reminderGuidance = greetingPayload.usedReminderId
        ? `\n当前通话是“提醒事项回访”。对话顺序必须遵守：
1) 首句只提醒事项并确认现在是否方便看一下，不直接问“完成了吗”；
2) 若用户说方便或正在处理，再确认提醒事项进展；
3) 若用户说已完成：先肯定，再只追问一次“您还有别的事想和我说吗？”；
4) 若用户说没有其他想聊：说一句短收尾，不继续追问；
5) 若用户说未完成：先问阻碍并给1-2条可执行建议，再简短确认是否需要继续帮忙。
不要再用“能聊聊吗/方便聊两句吗”作为开场。`
        : ''
      const pendingMemoryGuidance = pendingConfirm
        ? `\n当前有待确认记忆：${pendingConfirm.text}。请在本轮自然确认，不要诱导；若用户明确否认则放弃该记忆，若明确认可再继续使用。`
        : ''
      const outgoingGuidance = this.data.callMode === 'outgoing'
        ? (isFirstVoiceCall
          ? '\n当前是用户和小林第一次语音通话：语气比普通来电更温暖，先建立关系，不用“喂”开头，不急着追问需求，也不要引用历史记忆。'
          : '\n当前是“立即通话”场景：第一句只做需求确认（如“您找我有什么事”），不要在第一句带入历史记忆。若用户表示“想聊聊/没啥事就聊聊”，第二轮再自然带出1条历史话题并追问近况。')
        : ''
      const systemRole = `你是小林，一个温柔亲切的大学女生陪伴助手，正在和${title}通电话。请全程用“您”称呼对方，句子短而自然，避免长句说教。
如果对方说“叫我XXX”，请立即切换称呼并记住。
如果有历史记忆，优先在需求已明确后自然带出1条，不重复盘问。
你可以做的事：聊天陪伴、情绪安抚、提醒复述、给出现实可执行建议（如联系家属/医生/社区服务），并在用户提出诉求时主动协助其联系对应人员。
你绝对不能做的事：承诺或描述你会线下执行任何动作（上门照料、陪同就医、代买代办、寄送物品、按摩护理等）。
禁止句式示例（绝对不要说）：我陪您去医院、我马上过去、我去帮您买药、我替您办好。
遇到用户请求线下陪同/代办时，固定回复策略：先共情，再明确“我不能线下行动”，然后明确“我可以帮您联系对应的人”，并给电话内可执行方案（联系家属/120/社区服务/网约车）。
遇到健康不适或生活困难时，先共情，再给电话内可执行建议，并提醒联系家属或专业机构。
表达风格：口语化、真诚、有节奏停顿，不要模板化复读，不要夸张表演腔。
${PHONE_CONVERSATION_GUIDE}
${CARE_RESPONSE_PLAYBOOK}
${memoryPrompt ? `\n已知记忆：\n${memoryPrompt}` : ''}${contextPrompt}${reminderGuidance}${pendingMemoryGuidance}${outgoingGuidance}`

      // 1-2. 并行处理：请求麦克风权限 + 连接 WebSocket，减少冷启动串行耗时
      this._setConnectionPhase('authorizing')
      const authorizePromise = this._authorize().then(() => {
        console.log(FLOW_LOG_PREFIX, '麦克风权限已授权')
      })
      this._setConnectionPhase('connecting')
      const connectPromise = this.client.connect().then(() => {
        console.log(FLOW_LOG_PREFIX, 'WebSocket 已连接')
      })
      await Promise.all([authorizePromise, connectPromise])

      // 3. 开始会话（默认 server_vad 模式，自动检测说话停顿）
      this._setConnectionPhase('preparing')
      this.sessionOptions = {
        botName: '小林',
        systemRole,
        speakingStyle: voicePreset.speakingStyle,
        characterManifest: layeredPersonaManifest,
        careStrategies: voicePreset.careStrategies || [],
        ttsAudioConfig: voicePreset.tts || {},
        asrConfig: Object.assign({}, DEFAULT_ASR_PROFILE),
        dialogId,
        speaker: SPEAKER_FALLBACK_CHAIN[this.currentSpeakerIndex] || SPEAKER_FALLBACK_CHAIN[0],
        inputMode: 'keep_alive',
        profileTag: SC20_EXPERIMENT_TAG,
        voicePreset: DEFAULT_VOICE_PRESET,
      }
      const returnedDialogId = await this.client.startSession(this.sessionOptions)
      console.log(FLOW_LOG_PREFIX, '会话已启动', {
        dialogId: returnedDialogId || '',
      })

      if (returnedDialogId) {
        store.saveDialogId(returnedDialogId, this.currentElderKey)
      }

      this._setConnectionPhase('ready')
      this._startUplinkKeepalive()
      this._armGreetingEchoGuardFailsafe()

      // 4. 小林先打招呼
      this.client.sayHello(greetingPayload.text)
      // 首句兜底：部分场景服务端不会返回 chat 分片，先用本地问候文案占位字幕
      const greetingDraft = this._sanitizeForDisplay(greetingPayload.text)
      this.pendingAssistantDraft = greetingDraft || ''
      this.setData({
        currentAssistantDraft: greetingDraft || '',
        transcriptAnchorId: greetingDraft ? 'draft-assistant' : this.data.transcriptAnchorId,
      })
      this._armConnectingFallback()
      if (greetingPayload.usedMemoryText) {
        store.markMemoryItemsUsed(this.currentElderKey, [greetingPayload.usedMemoryText])
        store.markGreetingMemoryUsed(this.currentElderKey, greetingPayload.usedMemoryText)
      }
      if (greetingPayload.usedReminderId) {
        store.markReminderTriggered(greetingPayload.usedReminderId, this.currentElderKey)
      }

      // 5. 开始录音，持续流式发送（麦克风常开模式）
      console.log('[Call] 开始启动录音...')
      this.recorder.start()
      console.log('[Call] recorder.start() 已调用')
      console.log(FLOW_LOG_PREFIX, '录音启动完成，等待上行音频帧')

    } catch (err) {
      console.error('[Call] start failed:', err)
      console.error(FLOW_LOG_PREFIX, '通话初始化失败', err)
      this.setData({
        currentAssistantDraft: '连接失败，请重试',
        isIncomingAnswering: false,
        incomingHint: '接听失败，请重试',
      })
      setTimeout(() => wx.navigateBack(), 2000)
    }
  },

  _setupCallbacks() {
    // 录音帧 → 持续发送到 WebSocket
    this._frameCount = 0
    this.recorder.onFrameData = (pcmBuffer) => {
      this._frameCount++
      if (this._frameCount <= 3 || this._frameCount % 200 === 0) {
        console.log('[Call] 录音帧 #' + this._frameCount + ', 大小:', pcmBuffer ? pcmBuffer.byteLength : 0)
      }
      if (this.initialEchoGuardActive) {
        if (this.lastUplinkBlockReason !== 'greeting_echo_guard') {
          this.lastUplinkBlockReason = 'greeting_echo_guard'
          console.warn(FLOW_LOG_PREFIX, '上行暂时阻断: 首句欢迎语回声保护中')
        }
        return
      }
      // 服务端存在 audio idle timeout，默认允许播放期继续上行，避免会话被判定空闲
      if (!ALLOW_UPLINK_DURING_PLAYBACK && this.player && this.player.playing) {
        if (this.lastUplinkBlockReason !== 'playing') {
          this.lastUplinkBlockReason = 'playing'
          console.warn(FLOW_LOG_PREFIX, '上行暂时阻断: AI 播放中')
        }
        return
      }
      if (!ALLOW_UPLINK_DURING_PLAYBACK && Date.now() < this.playbackEchoGuardUntil) {
        if (this.lastUplinkBlockReason !== 'playback_tail_guard') {
          this.lastUplinkBlockReason = 'playback_tail_guard'
          console.warn(FLOW_LOG_PREFIX, '上行暂时阻断: 播放尾音抑制中')
        }
        return
      }
      if (!this.client.sessionActive) {
        if (this.lastUplinkBlockReason !== 'session_inactive') {
          this.lastUplinkBlockReason = 'session_inactive'
          console.warn(FLOW_LOG_PREFIX, '上行阻断: session 未激活，准备恢复会话')
        }
        if (!this.isRefreshingSession) {
          console.warn('[Call] 检测到 session inactive，尝试自动恢复会话')
          this._refreshSessionForLongCall()
        }
        return
      }
      if (this.lastUplinkBlockReason) {
        console.log(FLOW_LOG_PREFIX, '上行恢复发送')
        this.lastUplinkBlockReason = ''
      }
      this._sendAudioIn20msFrames(pcmBuffer)
    }

    // ASR：用户说话识别
    this.client.onASRText = (text, isFinal) => {
      this._markCallConnectedIfNeeded('asr')
      const visibleText = this._sanitizeForDisplay(text)
      this.pendingUserDraft = visibleText || ''
      this._flushUserDraft(false)
      this.setData({ isSpeaking: true, isAssistantSpeaking: false })
      if (isFinal && visibleText) {
        this._flushUserDraft(true)
        this._appendTranscriptItem('user', visibleText)
        this.messages.push({ role: 'user', content: text })
        this._tryResolvePendingMemoryConfirmation(text)
        this._handleIncomingReminderFollowup(text)
        this._handleExplicitEndCallIntent(text)
        this._maybeInjectOutgoingSmallTalkSteer(text)
        // P0：当用户在本轮明确说出“提醒/记得 + 具体时间/日期”时，立刻写入提醒，避免等待通话摘要
        this._tryUpsertReminderCandidatesFromASRFinal(text)
        this.setData({ currentUserDraft: '' })
      }
    }

    // ASR 结束：用户停止说话
    this.client.onASREnd = () => {
      this.setData({ isSpeaking: false, currentUserDraft: '' })
      console.log(FLOW_LOG_PREFIX, 'ASR 结束，等待模型回复')
      this.currentLatencyTurn = {
        userEndAt: Date.now(),
        firstChatAt: 0,
        firstTTSAt: 0,
        playStartAt: 0,
        finalized: false,
      }
    }

    // AI 回复文本（流式）
    this.client.onChatText = (text) => {
      this._markCallConnectedIfNeeded('chat')
      this.chatBuffer += text
      this.currentTurnBoundaryViolated = this.currentTurnBoundaryViolated || this._isBoundaryViolationText(this.chatBuffer)
      this.pendingAssistantDraft = this.currentTurnBoundaryViolated
        ? BOUNDARY_SAFE_REPLY
        : this._sanitizeForDisplay(this.chatBuffer)
      this._flushAssistantDraft(false)
      // 某些机型可能收不到 ASR_ENDED，AI 有文本回复时强制退出聆听态
      if (this.data.isSpeaking) {
        this.setData({ isSpeaking: false, currentUserDraft: '' })
      }
      if (this.currentLatencyTurn && !this.currentLatencyTurn.firstChatAt) {
        this.currentLatencyTurn.firstChatAt = Date.now()
        console.log(FLOW_LOG_PREFIX, '收到首个聊天文本分片')
      }
    }

    // TTS 音频数据
    this.client.onAudioData = (audioData) => {
      this._markCallConnectedIfNeeded('audio')
      this.player.appendChunk(audioData)
      if (this.currentLatencyTurn && !this.currentLatencyTurn.firstTTSAt) {
        this.currentLatencyTurn.firstTTSAt = Date.now()
        console.log(FLOW_LOG_PREFIX, '收到首个 TTS 音频分片')
      }
    }

    // AI 开始说新的一句
    this.client.onTTSStart = (text) => {
      this._markCallConnectedIfNeeded('tts_start')
      this._flushAssistantDraft(true)
      const seededAssistantDraft = this._sanitizeForDisplay(text)
        || this.pendingAssistantDraft
        || this.data.currentAssistantDraft
      this.chatBuffer = ''
      this.pendingAssistantDraft = seededAssistantDraft || ''
      this.currentTurnBoundaryViolated = false
      this.setData({
        currentUserDraft: '',
        currentAssistantDraft: seededAssistantDraft || '',
        transcriptAnchorId: seededAssistantDraft ? 'draft-assistant' : this.data.transcriptAnchorId,
        transcriptScrollTop: this.data.transcriptScrollTop + 9999,
        isSpeaking: false,
        isAssistantSpeaking: true,
      })
    }

    // AI 这一轮说完
    this.client.onTTSEnd = () => {
      if (this.currentTurnBoundaryViolated) {
        console.warn(FLOW_LOG_PREFIX, '检测到越界话术，丢弃当前语音并触发安全重说')
        this.player.stop()
        this.chatBuffer = ''
        this.pendingAssistantDraft = BOUNDARY_SAFE_REPLY
        this._flushAssistantDraft(true)
        this._appendTranscriptItem('assistant', BOUNDARY_SAFE_REPLY)
        this.setData({ currentAssistantDraft: '', isAssistantSpeaking: false })
        this._triggerBoundarySafeRepair()
        this._finalizeLatencyTurn()
        return
      }
      this._flushAssistantDraft(true)
      const finalVisibleAssistant = this._sanitizeForDisplay(
        this.chatBuffer || this.pendingAssistantDraft || this.data.currentAssistantDraft
      )
      const finalRawAssistant = this.chatBuffer || this.pendingAssistantDraft || this.data.currentAssistantDraft
      const hasAssistantTurn = !!finalVisibleAssistant
      const isFirstAssistantTurn = this.assistantTurnCount === 0 && hasAssistantTurn
      this.player.playBuffered()
      if (hasAssistantTurn) {
        this.messages.push({ role: 'assistant', content: finalRawAssistant })
        this._appendTranscriptItem('assistant', finalVisibleAssistant)
        this.assistantTurnCount += 1
        if (this.isBoundaryRepairing) {
          this.isBoundaryRepairing = false
        }
      }
      if (isFirstAssistantTurn) {
        this.waitingGreetingPlaybackEnd = true
      }
      this._finalizeLatencyTurn()
      this.chatBuffer = ''
      this.pendingAssistantDraft = ''
      this.setData({ currentAssistantDraft: '' })
      if (this.incomingFollowupState && this.incomingFollowupState.shouldAutoEndAfterAssistant) {
        this.incomingFollowupState.shouldAutoEndAfterAssistant = false
        // 不依赖瞬时 playing 状态，统一等播放器回调后再挂断，避免最后一句被截断
        this.incomingFollowupState.pendingAutoEndAfterPlayback = true
        this._startIncomingAutoEndGuard()
      }
      if (this.callEndingState && this.callEndingState.shouldAutoEndAfterAssistant) {
        this.callEndingState.shouldAutoEndAfterAssistant = false
        this.callEndingState.pendingAutoEndAfterPlayback = true
        this._startIncomingAutoEndGuard()
      }
      console.log(FLOW_LOG_PREFIX, '本轮 TTS 结束')
      // 规避服务端轮次上限：每 8 轮自动续会话，保持同一 dialog_id
      if (ENABLE_AUTO_SESSION_REFRESH && this.assistantTurnCount > 0 && this.assistantTurnCount % 8 === 0) {
        this._refreshSessionForLongCall()
      }
    }

    this.client.onError = (err) => {
      console.error('[Call] API error:', err)
      if (!err || this.data.status !== 'connected') return
      if (this._isInvalidSpeakerError(err)) {
        console.warn(FLOW_LOG_PREFIX, '检测到 InvalidSpeaker，尝试切换音色并恢复会话')
        this._switchSpeakerAndRecover()
        return
      }
      // sami error: DialogAudioIdleTimeoutError，通常表示服务端判定上行音频长时间中断
      if (String(err.code) === '55000001') {
        this.stabilityMetrics.idleTimeoutCount += 1
        console.warn(FLOW_LOG_PREFIX, '收到 idle timeout 错误，尝试恢复会话')
        this._refreshSessionForLongCall()
      }
    }

    // WebSocket 意外断开时优先尝试恢复，恢复失败再结束通话
    this.client.onDisconnect = () => {
      console.log('[Call] WebSocket disconnected')
      if (this.data.status === 'connected') {
        if (this.isRefreshingSession || this.isRecoveringDisconnect) return
        this._recoverAfterDisconnect()
      }
    }

    this.client.onFirstChatPacket = (ts) => {
      if (this.currentLatencyTurn && !this.currentLatencyTurn.firstChatAt) {
        this.currentLatencyTurn.firstChatAt = ts || Date.now()
      }
    }

    this.client.onFirstTTSAudioPacket = (ts) => {
      if (this.currentLatencyTurn && !this.currentLatencyTurn.firstTTSAt) {
        this.currentLatencyTurn.firstTTSAt = ts || Date.now()
      }
    }

    this.player.onPlayStart = () => {
      this.playbackEchoGuardUntil = 0
      this.setData({ isAssistantSpeaking: true })
      if (this.currentLatencyTurn && !this.currentLatencyTurn.playStartAt) {
        this.currentLatencyTurn.playStartAt = Date.now()
      }
      console.log(FLOW_LOG_PREFIX, '播放器开始播放')
    }
    this.player.onPlayEnd = () => {
      this.setData({ isAssistantSpeaking: false })
      if (this.waitingGreetingPlaybackEnd) {
        this.waitingGreetingPlaybackEnd = false
        this.initialEchoGuardActive = false
        this._clearGreetingEchoGuardFailsafe()
        console.log(FLOW_LOG_PREFIX, '首句欢迎语播放结束，解除回声保护')
      }
      this.playbackEchoGuardUntil = Date.now() + PLAYBACK_ECHO_TAIL_GUARD_MS
      if (this._hasPendingAutoEndAfterPlayback()) {
        this._clearPendingAutoEndAfterPlayback()
        this._clearIncomingAutoEndGuard()
        this._endCall({
          reason: 'hangup',
          shouldDisconnect: true,
          shouldNavigateBack: true,
        })
        return
      }
      console.log(FLOW_LOG_PREFIX, '播放器播放结束')
    }
  },

  _startUplinkKeepalive() {
    this._stopUplinkKeepalive()
    this.lastAudioUplinkAt = Date.now()
    this.uplinkKeepaliveTimer = setInterval(() => {
      if (this.data.status !== 'connected') return
      if (!this.recorder || !this.recorder.recording) {
        const now = Date.now()
        if (now - this.lastRecorderRestartAt >= RECORDER_RESTART_COOLDOWN_MS) {
          this.lastRecorderRestartAt = now
          console.warn(FLOW_LOG_PREFIX, '检测到录音已停止，尝试自动重启录音')
          try {
            this.recorder.start()
          } catch (err) {
            console.error(FLOW_LOG_PREFIX, '自动重启录音失败', err)
          }
        }
        return
      }
      if (!this.client || !this.client.connected || !this.client.sessionActive) return
      if (this.isRefreshingSession || this.isRecoveringDisconnect) return
      if (!ALLOW_UPLINK_DURING_PLAYBACK) {
        if (this.initialEchoGuardActive) return
        if (this.player && this.player.playing) return
        if (Date.now() < this.playbackEchoGuardUntil) return
      }
      const now = Date.now()
      if (now - this.lastAudioUplinkAt < UPLINK_IDLE_TRIGGER_MS) return
      const silence = this._getSilenceFrame()
      this._sendAudioIn20msFrames(silence)
      console.log(FLOW_LOG_PREFIX, '发送静音保活帧，防止 idle timeout')
    }, UPLINK_KEEPALIVE_INTERVAL_MS)
  },

  _stopUplinkKeepalive() {
    if (this.uplinkKeepaliveTimer) {
      clearInterval(this.uplinkKeepaliveTimer)
      this.uplinkKeepaliveTimer = null
    }
  },

  _armConnectingFallback() {
    if (this.connectingFallbackTimer) {
      clearTimeout(this.connectingFallbackTimer)
      this.connectingFallbackTimer = null
    }
    this.connectingFallbackTimer = setTimeout(() => {
      this._markCallConnectedIfNeeded('fallback')
    }, CONNECTING_FALLBACK_MS)
  },

  _markCallConnectedIfNeeded(reason) {
    if (this.hasSwitchedToConnected || this.data.status === 'ended') return
    this.hasSwitchedToConnected = true
    if (this.connectingFallbackTimer) {
      clearTimeout(this.connectingFallbackTimer)
      this.connectingFallbackTimer = null
    }
    const elapsed = Date.now() - (this.callStartAt || Date.now())
    const waitMs = Math.max(0, MIN_CONNECTING_UI_MS - elapsed)
    setTimeout(() => {
      if (this.data.status === 'ended') return
      this.setData({
        status: 'connected',
        showIncoming: false,
        isIncomingAnswering: false,
      })
      this._startTimer()
      console.log(FLOW_LOG_PREFIX, '状态切换为 connected', { reason })
    }, waitMs)
  },

  _armGreetingEchoGuardFailsafe() {
    this._clearGreetingEchoGuardFailsafe()
    this.greetingEchoGuardTimer = setTimeout(() => {
      if (!this.initialEchoGuardActive) return
      this.initialEchoGuardActive = false
      this.waitingGreetingPlaybackEnd = false
      console.warn(FLOW_LOG_PREFIX, '回声保护超时自动解除，避免首轮卡死')
    }, GREETING_ECHO_GUARD_MAX_MS)
  },

  _clearGreetingEchoGuardFailsafe() {
    if (this.greetingEchoGuardTimer) {
      clearTimeout(this.greetingEchoGuardTimer)
      this.greetingEchoGuardTimer = null
    }
  },

  _startIncomingAutoEndGuard() {
    this._clearIncomingAutoEndGuard()
    this.incomingAutoEndTimer = setTimeout(() => {
      if (!this._hasPendingAutoEndAfterPlayback()) return
      this._clearPendingAutoEndAfterPlayback()
      this._endCall({
        reason: 'hangup',
        shouldDisconnect: true,
        shouldNavigateBack: true,
      })
    }, INCOMING_AUTO_END_PLAYBACK_GRACE_MS)
  },

  _clearIncomingAutoEndGuard() {
    if (this.incomingAutoEndTimer) {
      clearTimeout(this.incomingAutoEndTimer)
      this.incomingAutoEndTimer = null
    }
  },

  _hasPendingAutoEndAfterPlayback() {
    const incomingPending = this.incomingFollowupState && this.incomingFollowupState.pendingAutoEndAfterPlayback
    const callEndingPending = this.callEndingState && this.callEndingState.pendingAutoEndAfterPlayback
    return Boolean(incomingPending || callEndingPending)
  },

  _clearPendingAutoEndAfterPlayback() {
    if (this.incomingFollowupState) {
      this.incomingFollowupState.pendingAutoEndAfterPlayback = false
    }
    if (this.callEndingState) {
      this.callEndingState.pendingAutoEndAfterPlayback = false
      this.callEndingState.source = ''
    }
  },

  _getSilenceFrame() {
    if (this.silenceFrame) return this.silenceFrame
    // 16kHz, 16bit, mono, 20ms => 640 bytes
    this.silenceFrame = new ArrayBuffer(640)
    return this.silenceFrame
  },

  _sendAudioIn20msFrames(pcmBuffer) {
    if (!pcmBuffer) return
    const incoming = new Uint8Array(pcmBuffer)
    if (incoming.byteLength === 0) return
    const merged = new Uint8Array(this.uplinkRemainder.byteLength + incoming.byteLength)
    merged.set(this.uplinkRemainder, 0)
    merged.set(incoming, this.uplinkRemainder.byteLength)
    let offset = 0
    while (offset + UPLINK_CHUNK_BYTES <= merged.byteLength) {
      const frame = new Uint8Array(UPLINK_CHUNK_BYTES)
      frame.set(merged.slice(offset, offset + UPLINK_CHUNK_BYTES))
      this.client.sendAudio(frame.buffer)
      this.lastAudioUplinkAt = Date.now()
      offset += UPLINK_CHUNK_BYTES
    }
    this.uplinkRemainder = merged.slice(offset)
  },

  // 挂断
  onHangup() {
    this._endCall({
      reason: 'hangup',
      shouldDisconnect: true,
      shouldNavigateBack: true,
    })
  },

  _endCall({ reason, shouldDisconnect, shouldNavigateBack }) {
    if (this.hasFinalizedCall) return
    this.hasFinalizedCall = true

    this.setData({
      status: 'ended',
      currentUserDraft: '',
      currentAssistantDraft: '',
      isAssistantSpeaking: false,
    })
    this._appendTranscriptItem('assistant', reason === 'disconnect' ? '网络中断，通话已结束' : '通话已结束')
    this._clearGreetingEchoGuardFailsafe()
    if (this.connectingFallbackTimer) {
      clearTimeout(this.connectingFallbackTimer)
      this.connectingFallbackTimer = null
    }
    this._stopUplinkKeepalive()
    this._stopTimer()
    this.recorder.stop()
    this.player.stop()

    if (shouldDisconnect && this.client) {
      this.client.finishSession()
      this.client.disconnect()
    }
    console.log('[Call][Stability]', {
      profile: this.sessionOptions && this.sessionOptions.profileTag,
      idleTimeoutCount: this.stabilityMetrics.idleTimeoutCount,
      reconnectAttempts: this.stabilityMetrics.reconnectAttempts,
      reconnectSuccess: this.stabilityMetrics.reconnectSuccess,
    })

    const record = this._buildCallRecord()
    if (this.messages.length > 0 || this.data.elapsed > 5) {
      store.addCallRecord(record)
      if (this.incomingReminder && this._isReminderCompletedByConversation(record.messages)) {
        store.markReminderDone(this.incomingReminder.id, this.currentElderKey)
      }
      if (this.messages.length > 0) {
        this._generateSummary(record)
      }
    }

    if (shouldNavigateBack) {
      setTimeout(() => wx.navigateBack(), reason === 'disconnect' ? 300 : 0)
    }
  },

  async _refreshSessionForLongCall() {
    if (this.isRefreshingSession || this.data.status !== 'connected') return
    if (!this.sessionOptions || !this.client) return
    if (!this.client.connected) {
      this._recoverAfterDisconnect()
      return
    }
    this.isRefreshingSession = true
    this.stabilityMetrics.reconnectAttempts += 1
    console.warn(FLOW_LOG_PREFIX, '开始自动恢复会话')
    try {
      const latestDialogId = store.getDialogId(this.currentElderKey) || this.client.dialogId || ''
      this.client.finishSession()
      const nextDialogId = await this.client.startSession(Object.assign({}, this.sessionOptions, {
        dialogId: latestDialogId,
      }))
      if (nextDialogId) {
        store.saveDialogId(nextDialogId, this.currentElderKey)
      }
      this.stabilityMetrics.reconnectSuccess += 1
      console.log('[Call] 已自动续会话，assistantTurnCount=', this.assistantTurnCount)
      console.log(FLOW_LOG_PREFIX, '自动恢复会话成功', {
        dialogId: nextDialogId || latestDialogId || '',
      })
    } catch (err) {
      console.warn('[Call] 自动续会话失败:', err)
      console.error(FLOW_LOG_PREFIX, '自动恢复会话失败', err)
    } finally {
      this.isRefreshingSession = false
    }
  },

  async _recoverAfterDisconnect() {
    if (this.isRecoveringDisconnect || this.data.status !== 'connected') return
    if (!this.sessionOptions || !this.client) return
    this.isRecoveringDisconnect = true
    this.stabilityMetrics.reconnectAttempts += 1
    console.warn(FLOW_LOG_PREFIX, '检测到断连，开始自动重连恢复')
    try {
      await this.client.connect()
      const latestDialogId = store.getDialogId(this.currentElderKey) || this.client.dialogId || ''
      const resumedDialogId = await this.client.startSession(Object.assign({}, this.sessionOptions, {
        dialogId: latestDialogId,
      }))
      if (resumedDialogId) {
        store.saveDialogId(resumedDialogId, this.currentElderKey)
      }
      this.stabilityMetrics.reconnectSuccess += 1
      console.log(FLOW_LOG_PREFIX, '断连恢复成功', {
        dialogId: resumedDialogId || latestDialogId || '',
      })
    } catch (err) {
      console.error(FLOW_LOG_PREFIX, '断连恢复失败，结束通话', err)
      this._endCall({
        reason: 'disconnect',
        shouldDisconnect: false,
        shouldNavigateBack: true,
      })
    } finally {
      this.isRecoveringDisconnect = false
    }
  },

  _isInvalidSpeakerError(err) {
    const detail = String((err && err.detail && err.detail.error) || (err && err.detail) || '')
    return detail.includes('InvalidSpeaker')
  },

  _isBoundaryViolationText(text) {
    const normalized = this._normalizeMemorySentence(text).toLowerCase()
    if (!normalized) return false
    return BOUNDARY_VIOLATION_PATTERNS.some(pattern => pattern.test(normalized))
  },

  _triggerBoundarySafeRepair() {
    if (this.isBoundaryRepairing || !this.client || !this.client.sessionActive) return
    this.isBoundaryRepairing = true
    const rewritePrompt = `请立即重说上一句，严格遵守以下要求：
1) 明确表示你不能线下行动（不能去医院、不能上门、不能代买代办）；
2) 语气要温柔，不要生硬拒绝；
3) 明确表达“我可以帮您联系对应的人”，并给电话内可执行建议（联系家属/120/社区服务）；
4) 回复控制在1-2句。
请直接输出最终对老人说的话，不要解释规则。`
    this.client.sendTextQuery(rewritePrompt)
  },

  async _switchSpeakerAndRecover() {
    if (this.isSwitchingSpeaker || this.data.status !== 'connected') return
    if (this.currentSpeakerIndex >= SPEAKER_FALLBACK_CHAIN.length - 1) {
      console.error(FLOW_LOG_PREFIX, '可回退音色已耗尽，保持当前会话错误状态')
      return
    }
    this.isSwitchingSpeaker = true
    this.currentSpeakerIndex += 1
    const nextSpeaker = SPEAKER_FALLBACK_CHAIN[this.currentSpeakerIndex]
    this.sessionOptions = Object.assign({}, this.sessionOptions || {}, {
      speaker: nextSpeaker,
    })
    console.warn(FLOW_LOG_PREFIX, '切换到回退音色', nextSpeaker)
    try {
      await this._refreshSessionForLongCall()
    } finally {
      this.isSwitchingSpeaker = false
    }
  },

  _buildCallRecord() {
    const duration = this.data.elapsed
    const minutes = Math.floor(duration / 60)
    const seconds = duration % 60
    const durationText = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`
    const now = new Date()
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    return {
      id: `call_${Date.now()}`,
      date: dateStr,
      duration: durationText,
      durationSeconds: duration,
      mood: '😊',
      moodLabel: '开心',
      summary: '',
      topics: [],
      highlights: [],
      messages: this.messages,
      summaryStatus: this.messages.length > 0 ? 'pending' : 'done',
      summaryUpdatedAt: new Date().toISOString(),
      summaryError: '',
      summarySource: '',
      summaryModel: '',
    }
  },

  _flushAssistantDraft(force) {
    if (force) {
      if (this.assistantDraftFlushTimer) {
        clearTimeout(this.assistantDraftFlushTimer)
        this.assistantDraftFlushTimer = null
      }
      this.assistantDraftLastFlushAt = Date.now()
      this.setData({
        currentAssistantDraft: this.pendingAssistantDraft || '',
        transcriptAnchorId: 'draft-assistant',
        transcriptScrollTop: this.data.transcriptScrollTop + 9999,
      })
      return
    }

    if (this.assistantDraftFlushTimer) return
    const now = Date.now()
    const elapsed = now - this.assistantDraftLastFlushAt
    const waitMs = elapsed >= SUBTITLE_THROTTLE_MS ? 0 : (SUBTITLE_THROTTLE_MS - elapsed)
    this.assistantDraftFlushTimer = setTimeout(() => {
      this.assistantDraftFlushTimer = null
      this.assistantDraftLastFlushAt = Date.now()
      this.setData({
        currentAssistantDraft: this.pendingAssistantDraft || '',
        transcriptAnchorId: 'draft-assistant',
        transcriptScrollTop: this.data.transcriptScrollTop + 9999,
      })
    }, waitMs)
  },

  _flushUserDraft(force) {
    if (force) {
      if (this.userDraftFlushTimer) {
        clearTimeout(this.userDraftFlushTimer)
        this.userDraftFlushTimer = null
      }
      this.userDraftLastFlushAt = Date.now()
      this.setData({
        currentUserDraft: this.pendingUserDraft || '',
        transcriptAnchorId: 'draft-user',
        transcriptScrollTop: this.data.transcriptScrollTop + 9999,
      })
      return
    }
    if (this.userDraftFlushTimer) return
    const now = Date.now()
    const elapsed = now - this.userDraftLastFlushAt
    const waitMs = elapsed >= USER_DRAFT_THROTTLE_MS ? 0 : (USER_DRAFT_THROTTLE_MS - elapsed)
    this.userDraftFlushTimer = setTimeout(() => {
      this.userDraftFlushTimer = null
      this.userDraftLastFlushAt = Date.now()
      this.setData({
        currentUserDraft: this.pendingUserDraft || '',
        transcriptAnchorId: 'draft-user',
        transcriptScrollTop: this.data.transcriptScrollTop + 9999,
      })
    }, waitMs)
  },

  _appendTranscriptItem(role, content) {
    const text = this._sanitizeForDisplay(content)
    if (!text) return
    const id = `${role}_${Date.now()}_${Math.floor(Math.random() * 1000)}`
    const next = (this.data.transcriptItems || []).concat([{ id, role, content: text }])
    const clipped = next.slice(-TRANSCRIPT_MAX_ITEMS)
    this.setData({
      transcriptItems: clipped,
      transcriptAnchorId: id,
      transcriptScrollTop: this.data.transcriptScrollTop + 9999,
    })
  },

  _sanitizeForDisplay(text) {
    if (!text) return ''
    let output = String(text)
    for (let i = 0; i < 5; i += 1) {
      const stripped = output.replace(/（[^（）]*）|\([^()]*\)/g, '')
      if (stripped === output) break
      output = stripped
    }
    return output.replace(/\s+/g, ' ').trim()
  },

  _finalizeLatencyTurn() {
    const turn = this.currentLatencyTurn
    if (!turn || turn.finalized || !turn.userEndAt) return
    turn.finalized = true
    this.latencySamples.push(Object.assign({}, turn))
    this.currentLatencyTurn = null
    this._reportLatencyStats()
  },

  _reportLatencyStats() {
    if (!this.latencySamples || this.latencySamples.length === 0) return
    const firstPlayLatencies = this.latencySamples
      .map(item => {
        if (!item.userEndAt || !item.playStartAt) return 0
        return item.playStartAt - item.userEndAt
      })
      .filter(v => v > 0)

    if (firstPlayLatencies.length === 0) return

    const sorted = firstPlayLatencies.slice().sort((a, b) => a - b)
    const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)]
    const p90 = sorted[Math.floor((sorted.length - 1) * 0.9)]
    const latest = this.latencySamples[this.latencySamples.length - 1]
    const chatDelay = latest.firstChatAt ? (latest.firstChatAt - latest.userEndAt) : -1
    const ttsDelay = latest.firstTTSAt ? (latest.firstTTSAt - latest.userEndAt) : -1
    const playDelay = latest.playStartAt ? (latest.playStartAt - latest.userEndAt) : -1
    console.log('[Call][Latency] profile=', this.sessionOptions && this.sessionOptions.profileTag, 'latest(chat/tts/play)=', chatDelay, ttsDelay, playDelay, 'ms; p50/p90(play)=', p50, p90, 'ms')
    if (p50 > LATENCY_BASELINE_TARGET.playP50MaxMs || p90 > LATENCY_BASELINE_TARGET.playP90MaxMs) {
      console.warn('[Call][Latency][ABCheck] 超出阈值', {
        profile: this.sessionOptions && this.sessionOptions.profileTag,
        p50,
        p90,
        target: LATENCY_BASELINE_TARGET,
      })
    }
  },

  _buildCharacterManifest({ title, voicePreset, memoryBundle }) {
    const elderMemory = memoryBundle && memoryBundle.elderMemory ? memoryBundle.elderMemory : {}
    const xiaolinMemory = memoryBundle && memoryBundle.xiaolinMemory ? memoryBundle.xiaolinMemory : {}
    const stableInterests = (elderMemory.interestTags || []).slice(0, 3).join('、')
    const stableHealth = (elderMemory.healthNotes || []).slice(0, 2).join('；')
    const tabooTopics = (xiaolinMemory.tabooTopics || []).slice(0, 2).join('、')
    const careStrategies = (voicePreset.careStrategies || []).slice(0, 4).join('；')
    return [
      `你是“小林”，服务对象是${title}，核心目标是提供温柔、可靠、电话内可执行的陪伴。`,
      '人物背景：你是刚工作的晚辈女生，习惯先关心再建议，语气亲切但不撒娇，不把老人当小孩。',
      '关系连续性：优先记住上次约定、近期生活变化和称呼偏好；若信息不确定，先确认再引用。',
      '优先级规则：安全约束 > 角色稳定规则 > 动态记忆事实；低优先级不得覆盖高优先级。',
      '角色底线：不能承诺线下行动（上门、陪同、代买代办、寄送等），只能提供电话内协助与转介。',
      `表达风格：${voicePreset.characterManifest || '温柔亲切，短句清晰，避免说教。'}`,
      '沟通习惯：像电话里熟悉的晚辈，每次回复只推进一个重点，先共情再追问，避免连续抛出多个问题。',
      careStrategies ? `陪伴策略：${careStrategies}` : '',
      stableInterests ? `动态记忆（兴趣，谨慎提及）：${stableInterests}` : '',
      stableHealth ? `动态记忆（健康背景，仅在相关场景提及）：${stableHealth}` : '',
      tabooTopics ? `动态记忆（慎提话题）：${tabooTopics}` : '',
    ].filter(Boolean).join('\n')
  },

  // 异步生成通话摘要
  _generateSummary(record) {
    const elderConfig = store.getElderConfig()
    const elderName = elderConfig ? elderConfig.parentName : '老人'
    generateSummary(record, {
      elderName,
      normalizeSummaryPayload: this._normalizeSummaryPayload.bind(this),
      updateCallRecord: this._updateCallRecord.bind(this),
      evolveMemory: this._evolveMemory.bind(this),
    })
  },

  // 本地摘要生成（fallback）
  _localSummary(record) {
    try {
      const elderConfig = store.getElderConfig()
      const elderName = elderConfig ? elderConfig.parentName : '老人'
      applyLocalSummary(record, {
        elderName,
        normalizeSummaryPayload: this._normalizeSummaryPayload.bind(this),
        updateCallRecord: this._updateCallRecord.bind(this),
        evolveMemory: this._evolveMemory.bind(this),
      })
    } catch (err) {
      console.error('[Call] 本地摘要生成失败:', err)
      this._updateCallRecord(record.id, {
        summaryStatus: 'failed',
        summaryUpdatedAt: new Date().toISOString(),
        summaryError: '摘要生成失败，请稍后重试',
      })
    }
  },

  _evolveMemory(record, summaryData) {
    const applyMemoryDelta = (memoryDelta) => {
      this._applyMemoryDelta(record, summaryData, memoryDelta)
      return memoryDelta
    }

    const localDelta = this._extractMemoryDelta(record, summaryData)
    if (!cloudFunctions.canCallFunction('extractMemories')) {
      return Promise.resolve(applyMemoryDelta(localDelta))
    }

    const elderConfig = store.getElderConfig()
    const elderName = elderConfig ? elderConfig.parentName : '老人'
    return cloudFunctions.callFunction('extractMemories', {
      messages: record.messages || [],
      summaryData: summaryData || {},
      elderName,
      elderKey: this.currentElderKey || store.getElderKey(elderConfig),
      callId: record.id || '',
    }).then(res => {
      if (res.result && res.result.success && res.result.data) {
        const cloudDelta = this._normalizeMemoryDelta(res.result.data, record, 'cloud_ark')
        return applyMemoryDelta(cloudDelta)
      }
      return applyMemoryDelta(localDelta)
    }).catch(err => {
      if (cloudFunctions.isExpectedFallbackError(err)) {
        console.log('[Call] extractMemories 云函数不可用，使用本地规则')
      } else {
        console.warn('[Call] 云函数记忆抽取失败，使用本地规则:', err)
      }
      return applyMemoryDelta(localDelta)
    })
  },

  _applyMemoryDelta(record, summaryData, memoryDelta) {
    const elderConfig = store.getElderConfig()
    const elderKey = this.currentElderKey || store.getElderKey(elderConfig)
    const title = store.getElderTitle()
    const safeMemoryDelta = memoryDelta || this._extractMemoryDelta(record, summaryData)
    safeMemoryDelta.elderMemory = safeMemoryDelta.elderMemory || {}
    safeMemoryDelta.xiaolinMemory = safeMemoryDelta.xiaolinMemory || {}
    safeMemoryDelta.memoryItems = Array.isArray(safeMemoryDelta.memoryItems) ? safeMemoryDelta.memoryItems : []
    const userMessages = (record.messages || [])
      .filter(item => item.role === 'user')
      .map(item => String(item.content || '').trim())
      .filter(Boolean)
    const preferredAddress = this._extractPreferredAddressFromMessages(userMessages)
    const currentBundle = store.getMemoryBundle(elderKey)
    const currentPreferred = currentBundle && currentBundle.xiaolinMemory
      ? String(currentBundle.xiaolinMemory.preferredAddress || '').trim()
      : ''
    if (preferredAddress) {
      safeMemoryDelta.xiaolinMemory.preferredAddress = preferredAddress
    } else if (!currentPreferred && title) {
      safeMemoryDelta.xiaolinMemory.preferredAddress = title
    }
    safeMemoryDelta.xiaolinMemory.careStrategies = ['语速自然正常，语句简短，多确认，情绪表达更有温度']

    if (elderConfig && elderConfig.health) {
      safeMemoryDelta.elderMemory.healthNotes = [elderConfig.health].concat(safeMemoryDelta.elderMemory.healthNotes || [])
    }

    safeMemoryDelta.memorySource = safeMemoryDelta.memorySource || 'summary'
    safeMemoryDelta.sourceCallId = safeMemoryDelta.sourceCallId || record.id || ''
    store.mergeMemoryBundle(elderKey, safeMemoryDelta, record.id)
    const reminderCandidates = this._extractReminderCandidates(record, summaryData)
    if (reminderCandidates.length > 0) {
      store.upsertExtractedReminderCandidates(reminderCandidates, elderKey, { autoThreshold: 0.78 })
    }
  },

  _extractFollowUps(summaryData, userMessages) {
    const candidates = []
      .concat(summaryData.highlights || [])
      .concat(userMessages || [])
    return this._extractTopicMemoryCandidates(candidates, {
      maxItems: 3,
      maxSegments: 5,
      preferFuture: true,
      requireAction: true,
    }).filter(text => !this._isReminderCommandLike(text))
  },

  _extractReminderCandidates(record, summaryData) {
    const summaryCandidates = Array.isArray(summaryData && summaryData.reminderCandidates)
      ? summaryData.reminderCandidates
      : []
    const userMessages = (record.messages || [])
      .filter(item => item.role === 'user')
      .map(item => String(item.content || '').trim())
      .filter(Boolean)
    const localCandidates = userMessages
      .map(text => this._buildReminderCandidateFromText(text))
      .filter(Boolean)
    let merged = summaryCandidates.concat(localCandidates)
      .map(item => this._normalizeReminderCandidate(item))
      .filter(Boolean)
    if (this.data.callMode === 'incoming' && this.incomingReminder && this.incomingReminder.title) {
      const incomingTitle = this._normalizeMemorySentence(this.incomingReminder.title)
      if (incomingTitle) {
        merged = merged.filter(item => {
          const title = this._normalizeMemorySentence(item && item.title)
          const evidence = this._normalizeMemorySentence(item && item.evidence)
          if (!title && !evidence) return false
          const titleRelated = title && (title.includes(incomingTitle) || incomingTitle.includes(title))
          const evidenceRelated = evidence && (evidence.includes(incomingTitle) || incomingTitle.includes(evidence))
          return !(titleRelated || evidenceRelated)
        })
      }
    }
    const dedupMap = {}
    merged.forEach(item => {
      const key = `${this._normalizeMemorySentence(item.title)}:${item.scheduleType}:${item.timeOfDay}`
      if (!dedupMap[key] || dedupMap[key].confidence < item.confidence) {
        dedupMap[key] = item
      }
    })
    return Object.keys(dedupMap).map(key => dedupMap[key]).slice(0, 6)
  },

  _extractPreferredAddressFromMessages(userMessages) {
    const lines = (userMessages || [])
      .map(text => String(text || '').trim())
      .filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      const normalized = line.replace(/\s+/g, '')
      const patterns = [
        /(?:你|您)?(?:可以|就)?(?:直接|以后)?(?:叫|喊)我([^\s，。！？,.；;：:"'“”‘’]{1,10})/,
        /我(?:叫|是)([^\s，。！？,.；;：:"'“”‘’]{1,10})/,
      ]
      for (let j = 0; j < patterns.length; j++) {
        const match = normalized.match(patterns[j])
        if (!match || !match[1]) continue
        const candidate = String(match[1] || '').replace(/[。！？,.，；;:："'“”‘’]/g, '').trim()
        if (!candidate) continue
        if (/^(一下|一声|什么|啥|名字|称呼|称谓)$/.test(candidate)) continue
        if (candidate.length > 10) continue
        return candidate
      }
    }
    return ''
  },

  _normalizeReminderCandidate(candidate) {
    return reminderExtractor.normalizeReminderCandidate(candidate)
  },

  _buildReminderCandidateFromText(text) {
    return reminderExtractor.buildReminderCandidateFromText(text)
  },

  _normalizeScheduleType(rawType, text) {
    return reminderExtractor.inferScheduleType(rawType, text)
  },

  _normalizeCandidateTime(rawTime, text) {
    return reminderExtractor.normalizeTime(rawTime, text).timeOfDay
  },

  _parseChineseHour(text) {
    const raw = String(text || '').trim()
    if (!raw) return NaN
    const digitMap = {
      零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
      五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    }
    if (raw === '十') return 10
    if (raw === '十一') return 11
    if (raw === '十二') return 12
    if (/^[一二两三四五六七八九]十$/.test(raw)) {
      return (digitMap[raw.charAt(0)] || 0) * 10
    }
    if (/^[一二两三四五六七八九]十[一二两三四五六七八九]$/.test(raw)) {
      return (digitMap[raw.charAt(0)] || 0) * 10 + (digitMap[raw.charAt(2)] || 0)
    }
    if (Object.prototype.hasOwnProperty.call(digitMap, raw)) {
      return digitMap[raw]
    }
    return NaN
  },

  _applyMeridiemToHour(hour, normalizedText) {
    const normalized = this._normalizeMemorySentence(normalizedText)
    const hasAfternoon = /下午/.test(normalized)
    const hasEvening = /晚上|今晚|夜里|夜间/.test(normalized)
    const hasNoon = /中午/.test(normalized)
    const hasMorning = /上午|早上|清晨/.test(normalized)
    const hasEarlyMorning = /凌晨/.test(normalized)

    let h = Math.min(23, Math.max(0, Number(hour) || 0))
    if ((hasAfternoon || hasEvening) && h > 0 && h < 12) {
      h += 12
    }
    if (hasNoon && h > 0 && h < 11) {
      h += 12
    }
    if (hasEarlyMorning && h === 12) {
      h = 0
    }
    if (hasMorning && h === 12) {
      h = 0
    }
    if (hasEvening && h === 12) {
      h = 0
    }
    return h
  },

  _normalizeCandidateDate(rawDate, scheduleType, text) {
    return reminderExtractor.normalizeCandidateDate(rawDate, scheduleType, text)
  },

  _resolveRelativeDate(text) {
    return reminderExtractor.resolveRelativeDate(text)
  },

  _formatDateOffset(baseDate, days) {
    const date = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000)
    return this._formatDate(date)
  },

  _formatDate(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  },

  _resolveIncomingReminder(options) {
    const elderKey = this.currentElderKey || store.getElderKey()
    const reminderId = options && options.reminderId ? decodeURIComponent(options.reminderId) : ''
    const reminderText = options && options.reminderText ? decodeURIComponent(options.reminderText) : ''
    if (reminderId || reminderText) {
      let resolvedTitle = reminderText || ''
      if (!resolvedTitle && reminderId) {
        const found = store.getReminders(elderKey).find(item => item.id === reminderId)
        resolvedTitle = found ? found.title : ''
      }
      return {
        id: reminderId || '',
        title: resolvedTitle,
      }
    }
    return store.pickNextIncomingReminder(elderKey) || null
  },

  _isFirstVoiceCall(dialogId) {
    if (this.data.callMode !== 'outgoing') return false
    if (dialogId) return false
    return !this._hasAnyCallHistory()
  },

  _hasAnyCallHistory() {
    if (!store.getCallHistory) return false
    const history = store.getCallHistory()
    return Array.isArray(history) && history.length > 0
  },

  _buildMemoryAwareGreeting(title, memoryBundle, incomingReminder, pendingMemoryConfirmation, options) {
    const elderMemory = memoryBundle && memoryBundle.elderMemory ? memoryBundle.elderMemory : {}
    const xiaolinMemory = memoryBundle && memoryBundle.xiaolinMemory ? memoryBundle.xiaolinMemory : {}
    const followUp = this._pickFirstNotCooling(xiaolinMemory.followUps || [])
    const recentEvent = this._pickFirstNotCooling(elderMemory.recentEvents || [])
    const interest = this._pickFirstNotCooling(elderMemory.interestTags || [])
    const pendingConfirmText = pendingMemoryConfirmation && pendingMemoryConfirmation.text
      ? this._normalizeMemorySentence(pendingMemoryConfirmation.text)
      : ''

    if (this.data.callMode === 'incoming') {
      if (incomingReminder && incomingReminder.title) {
        const followupPrompt = this._buildIncomingReminderFollowupPrompt(incomingReminder.title)
        const reminderTitle = this._normalizeMemorySentence(incomingReminder.title) || '这件事'
        return {
          text: `喂，${title}，我是小林。到时间啦，我提醒您${reminderTitle}，您现在方便看一下吗？${followupPrompt}`,
          usedMemoryText: '',
          usedReminderId: incomingReminder.id || '',
        }
      }
      if (pendingConfirmText) {
        return {
          text: `喂，${title}，我是小林。上次我记了“${pendingConfirmText}”，怕记错了，想跟您确认一下。`,
          usedMemoryText: '',
          usedReminderId: '',
        }
      }
      if (followUp) {
        const naturalFollowUp = this._humanizeGreetingMemoryText(followUp)
        return {
          text: `喂，${title}，我是小林。上次您说${naturalFollowUp}，我有点惦记，这两天怎么样？`,
          usedMemoryText: followUp,
          usedReminderId: '',
        }
      }
      if (recentEvent) {
        const naturalRecentEvent = this._humanizeGreetingMemoryText(recentEvent)
        return {
          text: `喂，${title}，我是小林。上次您说${naturalRecentEvent}，这两天还顺利吗？`,
          usedMemoryText: recentEvent,
          usedReminderId: '',
        }
      }
      if (interest) {
        return {
          text: `喂，${title}，我是小林。您之前提到喜欢${interest}，最近还有继续吗？`,
          usedMemoryText: interest,
          usedReminderId: '',
        }
      }
      return {
        text: `喂，${title}，我是小林。今天想听听您这两天怎么样。`,
        usedMemoryText: '',
        usedReminderId: '',
      }
    }

    if (options && options.isFirstVoiceCall) {
      const address = title ? `${title}您好` : '您好'
      return {
        text: `${address}，我是小林。第一次和您通话，我先陪您慢慢聊。您今天想先跟我说说什么？`,
        usedMemoryText: '',
        usedReminderId: '',
      }
    }

    return {
      text: `喂，${title}，我是小林。您找我呀？`,
      usedMemoryText: '',
      usedReminderId: '',
    }
  },

  _buildIncomingReminderFollowupPrompt(reminderTitle) {
    const title = this._normalizeMemorySentence(reminderTitle)
    if (!title) return '不急，您方便时我陪您确认一下。'
    if (/(吃药|服药|药)/.test(title)) {
      return '不急，您方便时我陪您确认一下。'
    }
    if (/(复查|复诊|看医生|门诊|医院|体检)/.test(title)) {
      return '不急，您方便时我们再看看怎么安排。'
    }
    if (/(测血压|血压|血糖)/.test(title)) {
      return '不急，您方便时我陪您确认一下。'
    }
    return '不急，您方便时我陪您确认一下。'
  },

  _pickFirstNotCooling(candidates) {
    const list = (candidates || [])
      .map(text => this._normalizeMemorySentence(text))
      .filter(text => text && !this._isLowInfoSentence(text))
      .filter(text => !this._isReminderCommandLike(text))
    for (let i = 0; i < list.length; i++) {
      const text = list[i]
      if (!store.isGreetingMemoryCooling(this.currentElderKey, text, GREETING_MEMORY_COOLDOWN_MS)) {
        return text
      }
    }
    return ''
  },

  _isReminderCompletedByConversation(messages) {
    const userTexts = (messages || [])
      .filter(item => item.role === 'user')
      .map(item => String(item.content || ''))
      .join(' ')
    if (!userTexts) return false
    return REMINDER_COMPLETE_HINTS.some(keyword => userTexts.includes(keyword))
  },

  _isReminderCompletedByUserText(text) {
    const normalized = this._normalizeMemorySentence(text)
    if (!normalized) return false
    return REMINDER_COMPLETE_HINTS.some(keyword => normalized.includes(keyword))
  },

  _isReminderIncompleteByUserText(text) {
    const normalized = this._normalizeMemorySentence(text)
    if (!normalized) return false
    return REMINDER_INCOMPLETE_HINTS.some(keyword => normalized.includes(keyword))
  },

  _hasNoMoreChatIntent(text) {
    const normalized = this._normalizeMemorySentence(text)
    if (!normalized) return false
    return NO_MORE_CHAT_HINTS.some(keyword => normalized.includes(keyword))
  },

  _handleIncomingReminderFollowup(userText) {
    if (!this.incomingReminder || !this.incomingReminder.id) return
    if (!this.incomingFollowupState) return
    if (this._isReminderCompletedByUserText(userText)) {
      this.incomingFollowupState.reminderCompleted = true
      this.incomingFollowupState.waitingNoMoreChatConfirm = true
      store.markReminderDone(this.incomingReminder.id, this.currentElderKey)
      return
    }
    if (this._isReminderIncompleteByUserText(userText)) {
      this.incomingFollowupState.reminderCompleted = false
      this.incomingFollowupState.waitingNoMoreChatConfirm = false
      this.incomingFollowupState.shouldAutoEndAfterAssistant = false
      this.incomingFollowupState.pendingAutoEndAfterPlayback = false
      this._clearIncomingAutoEndGuard()
      return
    }
    if (this.incomingFollowupState.waitingNoMoreChatConfirm && this._hasNoMoreChatIntent(userText)) {
      this.incomingFollowupState.shouldAutoEndAfterAssistant = true
    }
  },

  _handleExplicitEndCallIntent(userText) {
    if (!this._hasExplicitEndCallIntent(userText)) return
    if (!this.callEndingState) {
      this.callEndingState = {
        shouldAutoEndAfterAssistant: false,
        pendingAutoEndAfterPlayback: false,
        source: '',
      }
    }
    this.callEndingState.shouldAutoEndAfterAssistant = true
    this.callEndingState.pendingAutoEndAfterPlayback = false
    this.callEndingState.source = 'user_end_intent'
  },

  _hasExplicitEndCallIntent(text) {
    const normalized = this._normalizeMemorySentence(text)
    if (!normalized) return false
    if (END_CALL_INTENT_HINTS.some(keyword => normalized.includes(keyword))) return true
    return /(今天|这次|咱们|我们)?(先|就)?聊到这(里)?吧?$/.test(normalized) ||
      /^(那)?(我)?先挂(电话)?(了|啦|吧)?$/.test(normalized) ||
      /^(那)?(回头|改天|下次)(再)?(聊|说)(吧)?$/.test(normalized)
  },

  _pickPendingMemoryConfirmation() {
    if (!store.getPendingMemoryConfirmations) return null
    const pending = store.getPendingMemoryConfirmations(this.currentElderKey, { maxCount: 1 })
    if (!Array.isArray(pending) || pending.length === 0) return null
    return pending[0]
  },

  _tryResolvePendingMemoryConfirmation(userText) {
    const target = this.pendingMemoryConfirmation
    if (!target || !target.id || !store.confirmMemoryItem) return
    const normalized = this._normalizeMemorySentence(userText)
    if (!normalized) return
    const positive = /(是的|对的|没错|说得对|就是|确实|嗯对|记得对)/.test(normalized)
    const negative = /(不是|不对|记错|没有|别这么说|搞错|说反了)/.test(normalized)
    if (!positive && !negative) return
    store.confirmMemoryItem(this.currentElderKey, target.id, positive && !negative)
    this.pendingMemoryConfirmation = null
  },

  _tryUpsertReminderCandidatesFromASRFinal(userText) {
    if (!this.currentElderKey || !store.upsertExtractedReminderCandidates) return
    const candidate = this._buildReminderCandidateFromText(userText)
    if (!candidate) return
    store.upsertExtractedReminderCandidates([candidate], this.currentElderKey, { autoThreshold: 0.78 })
  },

  _maybeInjectOutgoingSmallTalkSteer(userText) {
    if (this.data.callMode !== 'outgoing') return
    if (!this.client || !this.client.sessionActive || typeof this.client.sendTextQuery !== 'function') return
    if (this.assistantTurnCount < 1) return
    if (this._hasExplicitEndCallIntent(userText)) return
    const normalized = this._normalizeMemorySentence(userText)
    if (!normalized) return
    if (!this._hasSmallTalkIntent(normalized)) return
    if (this._hasConcreteNeedIntent(normalized)) return
    const now = Date.now()
    if (now - this.lastSmallTalkSteerAt < 8000) return
    const steerPrompt = this._buildSmallTalkSteerPrompt()
    if (!steerPrompt) return
    this.lastSmallTalkSteerAt = now
    this.client.sendTextQuery(steerPrompt)
  },

  _hasSmallTalkIntent(text) {
    const normalized = this._normalizeMemorySentence(text)
    if (!normalized) return false
    return SMALL_TALK_INTENT_HINTS.some(keyword => normalized.includes(keyword))
  },

  _hasConcreteNeedIntent(text) {
    const normalized = this._normalizeMemorySentence(text)
    if (!normalized) return false
    return CONCRETE_NEED_HINTS.some(keyword => normalized.includes(keyword))
  },

  _buildSmallTalkSteerPrompt() {
    const memoryBundle = store.getMemoryBundle(this.currentElderKey)
    const elderMemory = memoryBundle && memoryBundle.elderMemory ? memoryBundle.elderMemory : {}
    const interests = (elderMemory.interestTags || []).filter(Boolean)
    const health = (elderMemory.healthNotes || []).filter(Boolean)
    const interest = this._pickFirstNotCooling(interests)
    const healthSignal = this._pickFirstNotCooling(health)
    if (!interest && !healthSignal) return ''

    if (interest && healthSignal) {
      return `用户明确表示“想聊聊”，且当前没有提出新的具体诉求。请优先按以下顺序继续：
1) 先从兴趣话题自然开启：${interest}
2) 若用户反馈健康相关，再温和承接健康信号：${healthSignal}
要求：只问一个具体近况问题，口语化短句，不要一次抛多个问题。`
    }
    if (interest) {
      return `用户明确表示“想聊聊”，且当前没有提出新的具体诉求。请直接从这个兴趣话题继续：${interest}。要求：自然追问一个具体近况，口语化短句，不要说教。`
    }
    return `用户明确表示“想聊聊”，且当前没有提出新的具体诉求。请温和承接这个健康信号并继续聊天：${healthSignal}。要求：先共情，再追问一个近况细节，不要制造焦虑。`
  },

  _normalizeMemoryDelta(rawData, record, source) {
    const input = rawData && typeof rawData === 'object' ? rawData : {}
    const callId = record && record.id ? record.id : ''
    const observedAt = input.observedAt || new Date().toISOString()
    const delta = {
      memorySource: source || input.memorySource || 'summary',
      sourceCallId: callId,
      observedAt,
      elderMemory: {
        interestTags: [],
        healthNotes: [],
        routineNotes: [],
        recentEvents: [],
      },
      xiaolinMemory: {
        followUps: [],
        tabooTopics: [],
        careStrategies: [],
      },
      memoryItems: [],
    }

    const elderMemory = input.elderMemory && typeof input.elderMemory === 'object' ? input.elderMemory : {}
    const xiaolinMemory = input.xiaolinMemory && typeof input.xiaolinMemory === 'object' ? input.xiaolinMemory : {}
    delta.elderMemory.interestTags = this._normalizeTextList(elderMemory.interestTags, 8)
    delta.elderMemory.healthNotes = this._normalizeTextList(elderMemory.healthNotes, 6)
      .filter(text => !this._isReminderCommandLike(text))
    delta.elderMemory.routineNotes = this._normalizeTextList(elderMemory.routineNotes, 6)
    delta.elderMemory.recentEvents = this._normalizeTextList(elderMemory.recentEvents, 8)
    delta.xiaolinMemory.followUps = this._normalizeTextList(xiaolinMemory.followUps, 6)
    delta.xiaolinMemory.tabooTopics = this._normalizeTextList(xiaolinMemory.tabooTopics, 4)
    delta.xiaolinMemory.careStrategies = this._normalizeTextList(xiaolinMemory.careStrategies, 4)

    const appendLegacyList = (type, text) => {
      const cleanText = this._normalizeMemorySentence(text)
      if (!cleanText) return
      if (type === 'interest') delta.elderMemory.interestTags.push(cleanText)
      else if (type === 'healthNote') delta.elderMemory.healthNotes.push(cleanText)
      else if (type === 'routineNote') delta.elderMemory.routineNotes.push(cleanText)
      else if (type === 'recentEvent') delta.elderMemory.recentEvents.push(cleanText)
      else if (type === 'followUp') delta.xiaolinMemory.followUps.push(cleanText)
      else if (type === 'tabooTopic') delta.xiaolinMemory.tabooTopics.push(cleanText)
    }

    ;(Array.isArray(input.memoryItems) ? input.memoryItems : []).forEach(rawItem => {
      if (!rawItem || typeof rawItem !== 'object') return
      const type = this._normalizeMemoryItemType(rawItem.type)
      const text = this._normalizeMemorySentence(rawItem.text)
      if (!text || this._isLowInfoSentence(text)) return
      if (type === 'healthNote' && this._isReminderCommandLike(text)) return
      const confidence = Math.max(0, Math.min(1, Number(rawItem.confidence || 0.7)))
      const sensitivity = rawItem.sensitivity || (type === 'healthNote' && confidence >= 0.85 ? 'sensitive' : 'normal')
      const needsConfirmation = typeof rawItem.needsConfirmation === 'boolean'
        ? rawItem.needsConfirmation
        : (type === 'healthNote' || sensitivity === 'sensitive' || confidence < 0.7)
      delta.memoryItems.push({
        type,
        text,
        confidence,
        evidence: String(rawItem.evidence || text).trim(),
        source: source || rawItem.source || 'cloud_ark',
        sourceCallId: callId,
        sourceTurnId: String(rawItem.sourceTurnId || rawItem.turnId || '').trim(),
        observedAt: String(rawItem.observedAt || observedAt).trim(),
        validFrom: String(rawItem.validFrom || '').trim(),
        validTo: String(rawItem.validTo || '').trim(),
        expiresAt: String(rawItem.expiresAt || '').trim(),
        sensitivity,
        visibility: rawItem.visibility || '',
        status: needsConfirmation ? 'pending' : 'confirmed',
        needsConfirmation,
        contradicts: Array.isArray(rawItem.contradicts) ? rawItem.contradicts : [],
      })
      appendLegacyList(type, text)
    })

    delta.elderMemory.interestTags = Array.from(new Set(delta.elderMemory.interestTags)).slice(0, 8)
    delta.elderMemory.healthNotes = Array.from(new Set(delta.elderMemory.healthNotes)).slice(0, 6)
    delta.elderMemory.routineNotes = Array.from(new Set(delta.elderMemory.routineNotes)).slice(0, 6)
    delta.elderMemory.recentEvents = Array.from(new Set(delta.elderMemory.recentEvents)).slice(0, 8)
    delta.xiaolinMemory.followUps = Array.from(new Set(delta.xiaolinMemory.followUps)).slice(0, 6)
    delta.xiaolinMemory.tabooTopics = Array.from(new Set(delta.xiaolinMemory.tabooTopics)).slice(0, 4)
    return delta
  },

  _normalizeMemoryItemType(type) {
    const raw = String(type || '').trim()
    const aliasMap = {
      health: 'healthNote',
      health_note: 'healthNote',
      healthNote: 'healthNote',
      interest: 'interest',
      hobby: 'interest',
      routine: 'routineNote',
      routine_note: 'routineNote',
      routineNote: 'routineNote',
      recent_event: 'recentEvent',
      recentEvent: 'recentEvent',
      event: 'recentEvent',
      follow_up: 'followUp',
      followUp: 'followUp',
      taboo: 'tabooTopic',
      taboo_topic: 'tabooTopic',
      tabooTopic: 'tabooTopic',
    }
    return aliasMap[raw] || 'recentEvent'
  },

  _extractMemoryDelta(record, summaryData) {
    const userMessages = (record.messages || [])
      .filter(item => item.role === 'user')
      .map(item => item.content)

    const topicsFromSummary = summaryData.topics || []
    const highlights = (summaryData.highlights || []).slice(0, 3)
    const interestsFromUser = this._extractInterestTags(userMessages)
    const summaryInterestSet = new Set((topicsFromSummary || []).map(t => String(t || '').trim()).filter(Boolean))
    const crossInterests = interestsFromUser.filter(tag => summaryInterestSet.has(tag))
    const interestTags = crossInterests.length > 0 ? crossInterests : interestsFromUser.slice(0, 5)

    const healthNotes = this._extractByKeywords(userMessages, [
      '高血压', '血糖', '血压', '头晕', '腿疼', '膝盖', '失眠', '胃口', '复查', '吃药', '体检'
    ], 3)
    const routineNotes = this._extractByKeywords(userMessages, [
      '早上', '晚上', '睡觉', '起床', '散步', '买菜', '做饭', '午休', '公园', '广场'
    ], 3)
    const recentEvents = this._extractRecentEvents(userMessages, highlights)
    const followUps = this._extractFollowUps(summaryData, userMessages)
    const tabooTopics = this._extractByKeywords(userMessages, [
      '不想聊', '别提', '不太想说', '不方便说'
    ], 2)

    return {
      memorySource: 'local_rule',
      sourceCallId: record.id || '',
      observedAt: new Date().toISOString(),
      elderMemory: {
        interestTags: interestTags,
        recentEvents,
        routineNotes,
        healthNotes,
      },
      xiaolinMemory: {
        followUps,
        tabooTopics,
      },
    }
  },

  _extractRecentEvents(userMessages, highlights) {
    const candidates = []
      .concat(highlights || [])
      .concat(userMessages || [])
    return this._extractTopicMemoryCandidates(candidates, {
      maxItems: 5,
      maxSegments: 6,
      preferFuture: false,
      requireAction: false,
    })
  },

  _extractInterestTags(userMessages) {
    const interestDict = {
      太极拳: ['太极', '太极拳'],
      书法: ['书法'],
      烹饪: ['烹饪', '做饭'],
      广场舞: ['广场舞', '跳舞'],
      跳芭蕾: ['芭蕾', '芭蕾舞', '跳芭蕾'],
      养生: ['养生'],
      看电视剧: ['电视剧', '追剧'],
      棋牌: ['棋牌', '下棋', '打牌'],
      散步: ['散步', '公园'],
      戏曲音乐: ['戏曲', '越剧', '评弹', '音乐', '听歌'],
    }
    const tags = []
    ;(userMessages || []).forEach(text => {
      const line = this._normalizeMemorySentence(text)
      if (!line || this._isLowInfoSentence(line)) return

      // 显式兴趣表达优先抽取（例如：我喜欢跳芭蕾 / 我爱好是养花）
      const explicitMatch = line.match(/(?:我)?(?:特别)?(?:很)?(?:喜欢|爱好是|爱好|最爱|平时爱|平时喜欢)(.{1,12})/)
      if (explicitMatch && explicitMatch[1]) {
        const candidate = explicitMatch[1]
          .replace(/^(是|做|去|在|会)/, '')
          .replace(/(呢|呀|啊|啦|了|呀|哦|嘛)+$/g, '')
          .replace(/[。！？!?,，、；;]+$/g, '')
        const canonicalCandidate = this._canonicalizeInterestTag(candidate)
        if (canonicalCandidate && canonicalCandidate.length >= 2 && canonicalCandidate.length <= 10) {
          tags.push(canonicalCandidate)
        }
      }

      Object.keys(interestDict).forEach(tag => {
        const variants = interestDict[tag]
        if (variants.some(keyword => line.includes(keyword))) {
          tags.push(tag)
        }
      })
    })
    const dedup = []
    const seen = {}
    tags.forEach(tag => {
      const canonical = this._canonicalizeInterestTag(tag)
      if (!canonical || seen[canonical]) return
      seen[canonical] = true
      dedup.push(canonical)
    })
    return dedup.slice(0, 5)
  },

  _canonicalizeInterestTag(tag) {
    const raw = this._normalizeMemorySentence(tag)
    if (!raw) return ''

    const normalized = raw
      .replace(/^(我|我就|我最|平时|平常|最近)+/, '')
      .replace(/^(是|做|去|在|会|爱|喜欢)+/, '')
      .replace(/^(打|练|学|玩|听|看|追|做|去|跳)(太极拳|太极|书法|广场舞|芭蕾舞?|电视剧|戏曲|评弹|音乐|歌|棋|牌|散步)/, '$2')
      .replace(/(呢|呀|啊|啦|了|哦|嘛)+$/g, '')
      .replace(/[。！？!?,，、；;]+$/g, '')

    const aliasMap = {
      太极: '太极拳',
      打太极拳: '太极拳',
      练太极拳: '太极拳',
      跳舞: '广场舞',
      跳广场舞: '广场舞',
      打牌: '棋牌',
      下棋: '棋牌',
      追剧: '看电视剧',
      看剧: '看电视剧',
      听歌: '戏曲音乐',
    }
    return aliasMap[normalized] || normalized
  },

  _extractByKeywords(userMessages, keywords, limit) {
    const result = []
    ;(userMessages || []).forEach(text => {
      const line = this._normalizeMemorySentence(text)
      if (!line) return
      if (this._isLowInfoSentence(line)) return
      if (this._isReminderCommandLike(line)) return
      if (keywords.some(k => line.includes(k))) {
        result.push(line)
      }
    })
    return result.slice(0, limit)
  },

  _normalizeMemorySentence(text) {
    return String(text || '')
      .trim()
      .replace(/[。！？!?,，、；;]+$/g, '')
      .replace(/\s+/g, '')
  },

  _isReminderCommandLike(text) {
    const line = this._normalizeMemorySentence(text)
    if (!line) return false
    // 类似“提醒张叔叔吃药/提醒我出门”是提醒指令，不适合直接作为寒暄回忆
    if (/^(提醒|记得提醒|叫我|通知我)/.test(line)) return true
    if (/提醒.{0,10}(吃药|出门|复查|复诊|测血压|锻炼|散步|起床)/.test(line)) return true
    if (/(提醒|记得).{0,8}(我|您|他|她|[^\s，。！？]{1,4}).{0,10}(起床|吃药|复查|复诊|测血压|锻炼|散步|出门)/.test(line)) return true
    return false
  },

  _humanizeGreetingMemoryText(text) {
    const line = String(text || '').trim()
    if (!line) return '最近的事'
    const compact = line
      .replace(/^(提醒|记得提醒|叫我|通知我)(一下)?/u, '')
      .replace(/^(?:老[\u4e00-\u9fa5]{1,2}|[\u4e00-\u9fa5]{1,3}(?:叔叔|阿姨|爷爷|奶奶|伯伯|大爷|大妈|老师|医生|先生|女士|哥哥|姐姐|弟弟|妹妹))/u, '')
      .replace(/^[，。！？、\s]+/, '')
    if (!compact) return '最近的事'
    if (/^吃药$/.test(compact)) return '按时吃药这件事'
    if (/^出门$/.test(compact)) return '出门安排这件事'
    return compact
  },

  _extractTopicMemoryCandidates(lines, options) {
    const opts = options || {}
    const normalizedLines = (lines || [])
      .map(text => this._normalizeMemorySentence(text))
      .filter(Boolean)
      .filter(text => !this._isLowInfoSentence(text))
      .filter(text => text.length >= 6)
    if (normalizedLines.length === 0) return []

    const maxSegments = typeof opts.maxSegments === 'number' ? opts.maxSegments : 6
    const maxItems = typeof opts.maxItems === 'number' ? opts.maxItems : 3
    const segments = this._buildTopicSegments(normalizedLines).slice(0, maxSegments)
    const picked = []
    segments.forEach(segment => {
      const best = this._pickBestSentenceInSegment(segment, opts)
      if (best) picked.push(best)
    })
    return Array.from(new Set(picked)).slice(0, maxItems)
  },

  _buildTopicSegments(lines) {
    const segments = []
    let current = []
    let currentSignals = {}
    ;(lines || []).forEach((line) => {
      const signals = this._extractTopicSignals(line)
      const overlap = this._topicSignalOverlap(currentSignals, signals)
      if (current.length === 0 || overlap >= 0.2) {
        current.push(line)
        currentSignals = this._mergeTopicSignals(currentSignals, signals)
        return
      }
      segments.push(current)
      current = [line]
      currentSignals = signals
    })
    if (current.length > 0) segments.push(current)
    return segments
  },

  _pickBestSentenceInSegment(segment, options) {
    const opts = options || {}
    let bestText = ''
    let bestScore = -Infinity
    ;(segment || []).forEach(text => {
      const score = this._scoreMemorySentence(text, opts)
      if (score > bestScore) {
        bestScore = score
        bestText = text
      }
    })
    if (!bestText) return ''
    if (bestScore < 2.5) return ''
    return bestText
  },

  _scoreMemorySentence(text, options) {
    const opts = options || {}
    const line = this._normalizeMemorySentence(text)
    if (!line || this._isLowInfoSentence(line)) return -10

    const hasAction = /(去|做|看|聊|问|复查|复诊|提醒|联系|准备|安排|散步|锻炼|吃药|买菜|睡|起床)/.test(line)
    const hasTime = /(今天|昨天|最近|这周|这两天|前几天|明天|后天|下周|周[一二三四五六日天]|早上|上午|中午|下午|晚上|\d+点|\d+月\d+[日号]?)/.test(line)
    const hasEntity = /(医院|门诊|医生|女儿|儿子|家里|社区|公园|药|血压|血糖|睡眠|兴趣|太极|书法|复查|复诊)/.test(line)
    const hasFollowUpIntent = /(下次|回头|改天|之后|记得|提醒|进展|到时候)/.test(line)
    const hasOnlyNegation = /^(没有|没)(呢|呀|啊)?([，,、]?)(没有|没)?(出去|出门|外出)?(玩|逛|活动)?$/.test(line)

    if (opts.requireAction && !hasAction) return -4
    if (opts.preferFuture && !(hasFollowUpIntent || /明天|后天|下周|记得|提醒|复查|复诊/.test(line))) return -3
    if (hasOnlyNegation) return -6

    let score = 0
    score += Math.min(2, line.length / 10)
    if (hasAction) score += 1.6
    if (hasTime) score += 1.2
    if (hasEntity) score += 1.2
    if (hasFollowUpIntent) score += 1
    if (/我(想|要|准备|计划)/.test(line)) score += 0.8
    if (/但是|不过|因为|所以/.test(line)) score += 0.4
    return score
  },

  _extractTopicSignals(text) {
    const line = this._normalizeMemorySentence(text)
    const groups = {
      health: ['血压', '血糖', '膝盖', '复查', '复诊', '医院', '医生', '吃药', '睡眠'],
      family: ['女儿', '儿子', '孙子', '孙女', '老伴', '家里'],
      routine: ['早上', '上午', '中午', '下午', '晚上', '起床', '散步', '买菜', '做饭'],
      hobby: ['太极', '书法', '广场舞', '音乐', '戏曲', '电视剧', '公园'],
      reminder: ['提醒', '记得', '下次', '回头', '安排', '计划', '准备'],
    }
    const signals = {}
    Object.keys(groups).forEach(group => {
      groups[group].forEach(keyword => {
        if (line.includes(keyword)) {
          signals[`${group}:${keyword}`] = true
        }
      })
    })
    if (/(今天|昨天|最近|明天|后天|下周|周[一二三四五六日天])/.test(line)) {
      signals['time:relative'] = true
    }
    return signals
  },

  _mergeTopicSignals(base, incoming) {
    return Object.assign({}, base || {}, incoming || {})
  },

  _topicSignalOverlap(a, b) {
    const aKeys = Object.keys(a || {})
    const bKeys = Object.keys(b || {})
    if (aKeys.length === 0 || bKeys.length === 0) return 0
    let hit = 0
    bKeys.forEach(key => {
      if (a[key]) hit += 1
    })
    return hit / Math.max(1, Math.min(aKeys.length, bKeys.length))
  },

  _isLowInfoSentence(text) {
    const line = this._normalizeMemorySentence(text)
    if (!line) return true
    if (line.length <= 3) return true

    const lowInfoSet = new Set([
      '还不错', '挺好', '很好', '还好', '一般', '就那样', '可以', '行', '嗯', '嗯嗯', '哦', '好的',
      '没事', '没什么', '都好', '还行', '可以的', '还可以', '是的', '对', '对的', '好'
    ])
    if (lowInfoSet.has(line)) return true

    // 只包含情绪应答词且没有实体信息
    if (/^(挺|还|就)?(好|行|可以|不错)$/.test(line)) return true
    // 常见寒暄短答：过得还行吧 / 日子就那样
    if (/^(过得|日子|最近)?(还|挺|就)?(行|还行|一般|凑合|那样)(吧|呢|呀)?$/.test(line)) return true
    // 常见否定短答：没有呢，没有出去玩
    if (/^(没有|没)(呢|呀|啊)?([，,、]?)(没有|没)?(出去|出门|外出)?(玩|逛|活动)?$/.test(line)) return true
    // 没有明确时间/人物/事项的泛化回复，不作为跨通话记忆
    if (/^(没有|没)(什么|啥)?(特别|安排|计划|进展)?(的)?$/.test(line)) return true
    return false
  },

  // 更新 store 中的通话记录
  _updateCallRecord(callId, summaryData) {
    const updated = store.updateCallRecord(callId, {
      summary: summaryData.summary || '',
      topics: summaryData.topics || [],
      highlights: summaryData.highlights || [],
      mood: summaryData.mood || '😌',
      moodLabel: summaryData.moodLabel || '平静',
      summaryStatus: summaryData.summaryStatus || 'done',
      summaryUpdatedAt: summaryData.summaryUpdatedAt || new Date().toISOString(),
      summaryError: summaryData.summaryError || '',
      summarySource: summaryData.summarySource || '',
      summaryModel: summaryData.summaryModel || '',
    })

    if (updated) {
      console.log('[Call] 摘要已更新:', callId)
    }
  },

  _normalizeSummaryPayload(summaryData, record, options) {
    return normalizeSummaryPayload(summaryData, record, options)
  },

  _normalizeTextList(items, maxCount) {
    if (!Array.isArray(items)) return []
    const uniqMap = {}
    items.forEach(item => {
      const text = String(item || '').trim()
      if (!text) return
      if (!uniqMap[text]) {
        uniqMap[text] = true
      }
    })
    return Object.keys(uniqMap).slice(0, maxCount || 5)
  },

  _normalizeMoodLabel(input) {
    const text = String(input || '').trim()
    if (!text) return ''
    if (text === '开心' || text === '平静' || text === '低落' || text === '焦虑') {
      return text
    }
    if (/焦虑|担心|紧张|害怕|不舒服|难受|疼|痛/.test(text)) return '焦虑'
    if (/低落|难过|伤心|孤单|孤独|失落/.test(text)) return '低落'
    if (/开心|高兴|愉快|放心|舒服多了|好多了|顺利/.test(text)) return '开心'
    if (/平静|稳定|平稳/.test(text)) return '平静'
    return ''
  },

  _normalizeMoodEmoji(input, moodLabel) {
    const text = String(input || '').trim()
    const moodMap = {
      开心: '😊',
      平静: '😌',
      低落: '😢',
      焦虑: '😟',
    }
    if (moodMap[moodLabel]) return moodMap[moodLabel]
    if (text === '😊' || text === '😌' || text === '😢' || text === '😟') {
      return text
    }
    return ''
  },

  _inferMoodFromMessages(messages) {
    const userText = (messages || [])
      .filter(item => item && item.role === 'user')
      .map(item => String(item.content || '').trim())
      .join(' ')
    const normalized = userText.replace(/\s+/g, '')
    if (!normalized) return { mood: '😌', moodLabel: '平静' }
    if (/(担心|焦虑|紧张|害怕|慌|发愁|烦|睡不着|失眠|不舒服|难受|疼|痛|胸闷|胸痛|头晕|血压高|血糖高|没药|忘吃药)/.test(normalized)) {
      return { mood: '😟', moodLabel: '焦虑' }
    }
    if (/(难过|低落|伤心|没意思|孤单|孤独|失落|想哭|不想说话|提不起劲)/.test(normalized)) {
      return { mood: '😢', moodLabel: '低落' }
    }
    if (/(开心|高兴|不错|挺好|愉快|放心|舒服多了|好多了|顺利|满意)/.test(normalized)) {
      return { mood: '😊', moodLabel: '开心' }
    }
    return { mood: '😌', moodLabel: '平静' }
  },

  _authorize() {
    return new Promise((resolve, reject) => {
      wx.authorize({
        scope: 'scope.record',
        success: resolve,
        fail: () => {
          wx.showModal({
            title: '需要麦克风权限',
            content: '请在设置中允许使用麦克风',
            success: (res) => {
              if (res.confirm) wx.openSetting({ success: resolve, fail: reject })
              else reject(new Error('用户拒绝麦克风权限'))
            },
          })
        },
      })
    })
  },

  _setConnectionPhase(phase) {
    const isIncoming = this.data.callMode === 'incoming'
    const hintMap = {
      dialing: isIncoming ? '正在接听，马上就好...' : '正在呼叫小林...',
      authorizing: '正在检查麦克风权限...',
      connecting: '正在建立语音连接...',
      preparing: '正在准备对话内容...',
      ready: '已接通，正在进入通话',
    }
    this.setData({
      connectionPhase: phase,
      connectionHint: hintMap[phase] || '正在准备中...',
    })
  },

  _startTimer() {
    this.timer = setInterval(() => {
      const elapsed = this.data.elapsed + 1
      const m = Math.floor(elapsed / 60)
      const s = elapsed % 60
      this.setData({
        elapsed,
        elapsedText: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      })
    }, 1000)
  },

  _stopTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  _cleanup() {
    if (this.userDraftFlushTimer) {
      clearTimeout(this.userDraftFlushTimer)
      this.userDraftFlushTimer = null
    }
    if (this.assistantDraftFlushTimer) {
      clearTimeout(this.assistantDraftFlushTimer)
      this.assistantDraftFlushTimer = null
    }
    this._clearGreetingEchoGuardFailsafe()
    this._clearIncomingAutoEndGuard()
    if (this.connectingFallbackTimer) {
      clearTimeout(this.connectingFallbackTimer)
      this.connectingFallbackTimer = null
    }
    this._stopTimer()
    this._stopUplinkKeepalive()
    this.recorder.stop()
    this.player.stop()
    this.player.destroy()
    this.uplinkRemainder = new Uint8Array(0)
    if (this.client.connected) {
      this.client.finishSession()
      this.client.disconnect()
    }
  },
})
