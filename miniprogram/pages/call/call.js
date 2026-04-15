const { RealtimeAPIClient } = require('../../utils/realtime-api')
const { AudioRecorder, AudioPlayer } = require('../../utils/audio')
const store = require('../../utils/store')
const SUBTITLE_THROTTLE_MS = 120
const ENABLE_AUTO_SESSION_REFRESH = false
const FLOW_LOG_PREFIX = '[CallFlow]'
const ALLOW_UPLINK_DURING_PLAYBACK = false
const UPLINK_KEEPALIVE_INTERVAL_MS = 1200
const UPLINK_IDLE_TRIGGER_MS = 1800
const GREETING_ECHO_GUARD_MAX_MS = 8000
const RECORDER_RESTART_COOLDOWN_MS = 3500
const PLAYBACK_ECHO_TAIL_GUARD_MS = 420
const REMINDER_COMPLETE_HINTS = ['完成了', '办好了', '弄好了', '已经好了', '处理好了', '做完了', '解决了']
const GREETING_MEMORY_COOLDOWN_MS = 48 * 60 * 60 * 1000
const MIN_CONNECTING_UI_MS = 2200
const CONNECTING_FALLBACK_MS = 6500
const SPEAKER_FALLBACK_CHAIN = [
  'saturn_zh_female_tiexinnvyou_tob',
  'zh_female_vv_jupiter_bigtts',
]
const BOUNDARY_VIOLATION_PATTERNS = [
  /(我|我来|我可以|我能|我去|我会).{0,6}(陪您|陪你).{0,8}(去|到).{0,10}(医院|门诊|看病|复诊|体检)/,
  /(我|我来|我可以|我能|我去|我会).{0,8}(上门|过去|到您家|去您家)/,
  /(我|我来|我可以|我能|我去|我会).{0,8}(帮您买|给您买|代买|代办|跑腿|送过去|寄给您|陪同就医)/,
]
const BOUNDARY_SAFE_REPLY = '我不能线下陪同或代办，但我可以马上帮您联系对应的人。您这件事我建议先联系家人；如果是紧急不适，我现在就帮您优先联系120。'
const DEFAULT_VOICE_PRESET = 'expressive'
const VOICE_PRESET_CONFIG = {
  safe: {
    label: '自然稳健',
    speakingStyle: '说话温柔自然，句子短一点，停顿清楚，语速平稳偏慢，优先保证可懂度',
    tts: { speedRatio: 0.97, pitchRatio: 1.0, volumeRatio: 1.0 },
  },
  balanced: {
    label: '轻情感',
    speakingStyle: '说话自然亲切，适度加入情绪起伏，句子保持口语化，停顿柔和',
    tts: { speedRatio: 1.0, pitchRatio: 1.02, volumeRatio: 1.02 },
  },
  expressive: {
    label: '情感实验',
    speakingStyle: '说话更有情感层次，但不要夸张，保持语义清晰和断句稳定',
    tts: { speedRatio: 1.03, pitchRatio: 1.04, volumeRatio: 1.03 },
  },
}

Page({
  data: {
    status: 'connecting', // connecting | connected | ended
    connectionPhase: 'dialing', // dialing | authorizing | connecting | preparing | ready
    connectionHint: '正在呼叫...',
    elapsed: 0,
    elapsedText: '00:00',
    subtitle: '',
    userText: '',
    isSpeaking: false,
    showIncoming: false, // 是否展示来电界面
    callMode: 'outgoing', // outgoing | incoming
    isIncomingAnswering: false,
    incomingHint: '正在响铃...',
  },

  onLoad(options) {
    this.client = new RealtimeAPIClient()
    this.recorder = new AudioRecorder()
    this.player = new AudioPlayer()
    this.timer = null
    this.chatBuffer = ''
    this.messages = []
    this.hasFinalizedCall = false
    this.currentElderKey = store.getElderKey()
    this.assistantTurnCount = 0
    this.isRefreshingSession = false
    this.sessionOptions = null
    this.subtitleFlushTimer = null
    this.subtitleLastFlushAt = 0
    this.pendingSubtitle = ''
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
    this.hasSwitchedToConnected = false
    this.connectingFallbackTimer = null
    this.currentTurnBoundaryViolated = false
    this.isBoundaryRepairing = false
    this.incomingReminder = null
    this.timeWeatherContext = store.getMockTimeWeatherContext()

    // incoming 模式：先显示来电界面
    if (options.mode === 'incoming') {
      this.incomingReminder = this._resolveIncomingReminder(options)
      this.setData({ showIncoming: true, callMode: 'incoming' })
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

  // ===== 通话核心逻辑 =====
  async _startCall() {
    this._setupCallbacks()
    this._setConnectionPhase('dialing')
    console.log(FLOW_LOG_PREFIX, '开始通话初始化')

    try {
      // 1. 请求麦克风权限
      this._setConnectionPhase('authorizing')
      await this._authorize()
      console.log(FLOW_LOG_PREFIX, '麦克风权限已授权')

      // 2. 连接 WebSocket
      this._setConnectionPhase('connecting')
      await this.client.connect()
      console.log(FLOW_LOG_PREFIX, 'WebSocket 已连接')

      const elderConfig = store.getElderConfig()
      const title = store.getElderTitle()
      this.currentElderKey = store.getElderKey(elderConfig)
      const dialogId = store.getDialogId(this.currentElderKey)
      const memoryBundle = store.getMemoryBundle(this.currentElderKey)
      const greetingPayload = this._buildMemoryAwareGreeting(title, memoryBundle, this.incomingReminder)
      const memoryPrompt = greetingPayload.usedMemoryText
        ? ''
        : store.buildMemoryPrompt(this.currentElderKey, { maxItems: 1, minConfidence: 0.6 })
      const contextPrompt = this.timeWeatherContext && this.timeWeatherContext.prompt
        ? `\n当前场景：${this.timeWeatherContext.prompt}`
        : ''

      const voicePreset = VOICE_PRESET_CONFIG[DEFAULT_VOICE_PRESET] || VOICE_PRESET_CONFIG.safe
      const systemRole = `你是小林，一个温柔亲切的大学女生陪伴助手，正在和${title}通电话。请全程用“您”称呼对方，句子短而自然，避免长句说教。
如果对方说“叫我XXX”，请立即切换称呼并记住。
如果有历史记忆，首轮回复自然带出1条，不重复盘问。
你可以做的事：聊天陪伴、情绪安抚、提醒复述、给出现实可执行建议（如联系家属/医生/社区服务），并在用户提出诉求时主动协助其联系对应人员。
你绝对不能做的事：承诺或描述你会线下执行任何动作（上门照料、陪同就医、代买代办、寄送物品、按摩护理等）。
禁止句式示例（绝对不要说）：我陪您去医院、我马上过去、我去帮您买药、我替您办好。
遇到用户请求线下陪同/代办时，固定回复策略：先共情，再明确“我不能线下行动”，然后明确“我可以帮您联系对应的人”，并给电话内可执行方案（联系家属/120/社区服务/网约车）。
遇到健康不适或生活困难时，先共情，再给电话内可执行建议，并提醒联系家属或专业机构。
表达风格：口语化、真诚、有节奏停顿，不要模板化复读，不要夸张表演腔。
${memoryPrompt ? `\n已知记忆：\n${memoryPrompt}` : ''}${contextPrompt}`

      // 3. 开始会话（默认 server_vad 模式，自动检测说话停顿）
      this._setConnectionPhase('preparing')
      this.sessionOptions = {
        botName: '小林',
        systemRole,
        speakingStyle: voicePreset.speakingStyle,
        dialogId,
        speaker: SPEAKER_FALLBACK_CHAIN[this.currentSpeakerIndex] || SPEAKER_FALLBACK_CHAIN[0],
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
        subtitle: '连接失败，请重试',
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
      if (this._frameCount <= 3 || this._frameCount % 50 === 0) {
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
      this.client.sendAudio(pcmBuffer)
      this.lastAudioUplinkAt = Date.now()
    }

    // ASR：用户说话识别
    this.client.onASRText = (text, isFinal) => {
      this._markCallConnectedIfNeeded('asr')
      this.setData({ userText: text, isSpeaking: true })
      if (isFinal && text) {
        this.messages.push({ role: 'user', content: text })
      }
    }

    // ASR 结束：用户停止说话
    this.client.onASREnd = () => {
      this.setData({ isSpeaking: false })
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
      this.pendingSubtitle = this.currentTurnBoundaryViolated ? BOUNDARY_SAFE_REPLY : this.chatBuffer
      this._flushSubtitle(false)
      // 某些机型可能收不到 ASR_ENDED，AI 有文本回复时强制退出聆听态
      if (this.data.isSpeaking) {
        this.setData({ isSpeaking: false })
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
      this.chatBuffer = ''
      this.pendingSubtitle = ''
      this.currentTurnBoundaryViolated = false
      this.setData({ userText: '', isSpeaking: false })
    }

    // AI 这一轮说完
    this.client.onTTSEnd = () => {
      if (this.currentTurnBoundaryViolated) {
        console.warn(FLOW_LOG_PREFIX, '检测到越界话术，丢弃当前语音并触发安全重说')
        this.player.stop()
        this.chatBuffer = ''
        this.pendingSubtitle = BOUNDARY_SAFE_REPLY
        this._flushSubtitle(true)
        this._triggerBoundarySafeRepair()
        this._finalizeLatencyTurn()
        return
      }
      const isFirstAssistantTurn = this.assistantTurnCount === 0 && !!this.chatBuffer
      this._flushSubtitle(true)
      this.player.playBuffered()
      if (this.chatBuffer) {
        this.messages.push({ role: 'assistant', content: this.chatBuffer })
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
      if (this.currentLatencyTurn && !this.currentLatencyTurn.playStartAt) {
        this.currentLatencyTurn.playStartAt = Date.now()
      }
      console.log(FLOW_LOG_PREFIX, '播放器开始播放')
    }
    this.player.onPlayEnd = () => {
      if (this.waitingGreetingPlaybackEnd) {
        this.waitingGreetingPlaybackEnd = false
        this.initialEchoGuardActive = false
        this._clearGreetingEchoGuardFailsafe()
        console.log(FLOW_LOG_PREFIX, '首句欢迎语播放结束，解除回声保护')
      }
      this.playbackEchoGuardUntil = Date.now() + PLAYBACK_ECHO_TAIL_GUARD_MS
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
      const now = Date.now()
      if (now - this.lastAudioUplinkAt < UPLINK_IDLE_TRIGGER_MS) return
      const silence = this._getSilenceFrame()
      this.client.sendAudio(silence)
      this.lastAudioUplinkAt = now
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

  _getSilenceFrame() {
    if (this.silenceFrame) return this.silenceFrame
    // 16kHz, 16bit, mono, 20ms => 640 bytes
    this.silenceFrame = new ArrayBuffer(640)
    return this.silenceFrame
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
      subtitle: reason === 'disconnect' ? '网络中断，通话已结束' : '通话已结束',
    })
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
    }
  },

  _flushSubtitle(force) {
    if (force) {
      if (this.subtitleFlushTimer) {
        clearTimeout(this.subtitleFlushTimer)
        this.subtitleFlushTimer = null
      }
      this.subtitleLastFlushAt = Date.now()
      this.setData({ subtitle: this.pendingSubtitle || '' })
      return
    }

    if (this.subtitleFlushTimer) return
    const now = Date.now()
    const elapsed = now - this.subtitleLastFlushAt
    const waitMs = elapsed >= SUBTITLE_THROTTLE_MS ? 0 : (SUBTITLE_THROTTLE_MS - elapsed)
    this.subtitleFlushTimer = setTimeout(() => {
      this.subtitleFlushTimer = null
      this.subtitleLastFlushAt = Date.now()
      this.setData({ subtitle: this.pendingSubtitle || '' })
    }, waitMs)
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
    console.log('[Call][Latency] latest(chat/tts/play)=', chatDelay, ttsDelay, playDelay, 'ms; p50/p90(play)=', p50, p90, 'ms')
  },

  // 异步生成通话摘要
  _generateSummary(record) {
    if (!record.messages || record.messages.length === 0) return

    const elderConfig = store.getElderConfig()
    const elderName = elderConfig ? elderConfig.parentName : '老人'

    // 尝试云函数（如果云开发已初始化）
    if (wx.cloud) {
      wx.cloud.callFunction({
        name: 'generateSummary',
        data: {
          messages: record.messages,
          elderName: elderName,
        },
      }).then(res => {
        if (res.result && res.result.success) {
          const summaryPayload = Object.assign({}, res.result.data, {
            summaryStatus: 'done',
            summaryUpdatedAt: new Date().toISOString(),
            summaryError: '',
          })
          this._updateCallRecord(record.id, summaryPayload)
          this._evolveMemory(record, summaryPayload)
        } else {
          this._localSummary(record)
        }
      }).catch(err => {
        console.warn('[Call] 云函数摘要生成失败，使用本地生成:', err)
        this._localSummary(record)
      })
    } else {
      // 云开发未初始化，直接本地生成
      this._localSummary(record)
    }
  },

  // 本地摘要生成（fallback）
  _localSummary(record) {
    try {
      const elderConfig = store.getElderConfig()
      const elderName = elderConfig ? elderConfig.parentName : '老人'
      const messages = record.messages || []
      const userMsgs = messages.filter(m => m.role === 'user').map(m => m.content)
      const allText = messages.map(m => m.content).join(' ')

      const topicKeywords = ['健康', '养生', '太极拳', '书法', '电视剧', '运动',
        '做饭', '烹饪', '家庭', '天气', '散步', '公园', '邻居', '睡眠', '买菜']
      const topics = topicKeywords.filter(k => allText.includes(k))

      const summary = `${elderName}和小林进行了${messages.length}轮对话。` +
        (topics.length > 0 ? `话题涉及${topics.join('、')}。` : '')

      this._updateCallRecord(record.id, {
        summary,
        topics: topics.length > 0 ? topics : ['日常聊天'],
        highlights: userMsgs.slice(0, 3),
        mood: '😊',
        moodLabel: '开心',
        summaryStatus: 'done',
        summaryUpdatedAt: new Date().toISOString(),
        summaryError: '',
      })
      this._evolveMemory(record, {
        summary,
        topics: topics.length > 0 ? topics : ['日常聊天'],
        highlights: userMsgs.slice(0, 3),
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
    const elderConfig = store.getElderConfig()
    const elderKey = this.currentElderKey || store.getElderKey(elderConfig)
    const title = store.getElderTitle()
    const memoryDelta = this._extractMemoryDelta(record, summaryData)
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
      memoryDelta.xiaolinMemory.preferredAddress = preferredAddress
    } else if (!currentPreferred && title) {
      memoryDelta.xiaolinMemory.preferredAddress = title
    }
    memoryDelta.xiaolinMemory.careStrategies = ['语速自然正常，语句简短，多确认，情绪表达更有温度']

    if (elderConfig && elderConfig.health) {
      memoryDelta.elderMemory.healthNotes = [elderConfig.health]
    }

    store.mergeMemoryBundle(elderKey, memoryDelta, record.id)
    const reminderCandidates = this._extractReminderCandidates(record, summaryData)
    if (reminderCandidates.length > 0) {
      store.upsertExtractedReminderCandidates(reminderCandidates, elderKey, { autoThreshold: 0.78 })
    }
  },

  _extractFollowUps(summaryData, userMessages) {
    const candidates = []
      .concat(summaryData.highlights || [])
      .concat(userMessages || [])
      .filter(Boolean)
      .map(text => String(text).trim())
      .filter(text => text.length >= 6)
      .filter(text => {
        const normalized = this._normalizeMemorySentence(text)
        if (this._isLowInfoSentence(normalized)) return false
        // 需要包含未来行动/提醒/回访语义，避免“想/可以/需要”等泛词误判
        const hasIntentSignal = /下次|回头|改天|之后|明天|这周|记得|提醒|复查|复诊|进展|到时候/.test(normalized)
        if (!hasIntentSignal) return false
        // 同时要有动作信息，降低空泛句入库
        return /去|做|看|聊|问|复查|复诊|提醒|联系|准备|安排/.test(normalized)
      })

    return candidates.slice(0, 3)
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
    const merged = summaryCandidates.concat(localCandidates)
      .map(item => this._normalizeReminderCandidate(item))
      .filter(Boolean)
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
    if (!candidate) return null
    const title = String(candidate.title || '').trim()
    if (!title) return null
    const evidence = String(candidate.evidence || title)
    const scheduleType = this._normalizeScheduleType(candidate.scheduleType, evidence)
    const timeOfDay = this._normalizeCandidateTime(
      String(candidate.timeOfDay || '09:00'),
      `${title}${evidence}`
    )
    const remindDate = this._normalizeCandidateDate(
      String(candidate.remindDate || ''),
      scheduleType,
      `${title}${evidence}`
    )
    return {
      title,
      scheduleType,
      timeOfDay,
      remindDate,
      confidence: Math.max(0, Math.min(1, Number(candidate.confidence || 0.65))),
      evidence,
    }
  },

  _buildReminderCandidateFromText(text) {
    const normalized = this._normalizeMemorySentence(text)
    if (!normalized) return null
    const hasAction = /(记得|提醒|别忘|需要|要去|要做|得去|按时|复查|复诊|吃药|测血压|锻炼)/.test(normalized)
    const hasTimeSignal = /(明天|后天|今晚|今天|每天|每周|每月|周[一二三四五六日天]|号|点|早上|上午|中午|下午|晚上)/.test(normalized)
    if (!(hasAction && hasTimeSignal)) return null

    const scheduleType = this._normalizeScheduleType('', normalized)
    const timeOfDay = this._normalizeCandidateTime('09:00', normalized)
    const remindDate = this._normalizeCandidateDate('', scheduleType, normalized)

    const confidence = Math.min(0.92, 0.55 + (hasAction ? 0.2 : 0) + (hasTimeSignal ? 0.2 : 0))
    return {
      title: String(text || '').trim(),
      scheduleType,
      timeOfDay,
      remindDate,
      confidence,
      evidence: normalized,
    }
  },

  _normalizeScheduleType(rawType, text) {
    const given = String(rawType || '').trim()
    if (given === 'once' || given === 'daily' || given === 'weekly' || given === 'monthly') {
      return given
    }
    const normalized = this._normalizeMemorySentence(text)
    if (/每周|周[一二三四五六日天]/.test(normalized)) return 'weekly'
    if (/每月|\d+号/.test(normalized)) return 'monthly'
    if (/明天|后天|今晚|今天|下周|周末/.test(normalized)) return 'once'
    return 'daily'
  },

  _normalizeCandidateTime(rawTime, text) {
    const normalized = this._normalizeMemorySentence(text)
    let hour = 9
    let minute = 0
    const hhmmMatch = String(rawTime || '').match(/^(\d{1,2})[:：](\d{1,2})$/)
    if (hhmmMatch) {
      hour = Math.min(23, Math.max(0, Number(hhmmMatch[1]) || 0))
      minute = Math.min(59, Math.max(0, Number(hhmmMatch[2]) || 0))
    } else {
      const textHhmmMatch = normalized.match(/(\d{1,2})[:：](\d{1,2})/)
      if (textHhmmMatch) {
        hour = Math.min(23, Math.max(0, Number(textHhmmMatch[1]) || 0))
        minute = Math.min(59, Math.max(0, Number(textHhmmMatch[2]) || 0))
      } else {
        const pointMatch = normalized.match(/(\d{1,2})点(半|[0-5]?\d分?)?/)
        if (pointMatch) {
          hour = Math.min(23, Math.max(0, Number(pointMatch[1]) || 0))
          if (pointMatch[2]) {
            if (pointMatch[2].includes('半')) {
              minute = 30
            } else {
              const minuteMatch = pointMatch[2].match(/(\d{1,2})分?/)
              minute = minuteMatch ? Math.min(59, Math.max(0, Number(minuteMatch[1]) || 0)) : 0
            }
          }
        } else if (/晚上|今晚/.test(normalized)) {
          hour = 20
          minute = 0
        } else if (/上午|早上/.test(normalized)) {
          hour = 9
          minute = 0
        } else if (/下午|中午/.test(normalized)) {
          hour = 14
          minute = 0
        }
      }
    }
    const adjustedHour = this._applyMeridiemToHour(hour, normalized)
    return `${String(adjustedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
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
    const given = String(rawDate || '').trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(given)) return given
    if (scheduleType !== 'once') return ''
    return this._resolveRelativeDate(text)
  },

  _resolveRelativeDate(text) {
    const normalized = this._normalizeMemorySentence(text)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    if (/后天/.test(normalized)) {
      return this._formatDateOffset(today, 2)
    }
    if (/明天/.test(normalized)) {
      return this._formatDateOffset(today, 1)
    }
    if (/今天|今晚/.test(normalized)) {
      return this._formatDateOffset(today, 0)
    }

    const match = normalized.match(/(\d{1,2})月(\d{1,2})[日号]?/)
    if (match) {
      const month = Math.min(12, Math.max(1, Number(match[1]) || 1))
      const day = Math.min(31, Math.max(1, Number(match[2]) || 1))
      const candidate = new Date(today.getFullYear(), month - 1, day)
      if (candidate.getTime() < today.getTime()) {
        candidate.setFullYear(candidate.getFullYear() + 1)
      }
      return this._formatDate(candidate)
    }
    return ''
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

  _buildMemoryAwareGreeting(title, memoryBundle, incomingReminder) {
    const elderMemory = memoryBundle && memoryBundle.elderMemory ? memoryBundle.elderMemory : {}
    const xiaolinMemory = memoryBundle && memoryBundle.xiaolinMemory ? memoryBundle.xiaolinMemory : {}
    const followUp = this._pickFirstNotCooling(xiaolinMemory.followUps || [])
    const recentEvent = this._pickFirstNotCooling(elderMemory.recentEvents || [])
    const interest = this._pickFirstNotCooling(elderMemory.interestTags || [])

    if (this.data.callMode === 'incoming') {
      if (incomingReminder && incomingReminder.title) {
        return {
          text: `${title}，是我小林呀！我记得您这件事：“${incomingReminder.title}”。我特地来提醒您一下，现在方便聊两句吗？`,
          usedMemoryText: '',
          usedReminderId: incomingReminder.id || '',
        }
      }
      if (followUp) {
        return {
          text: `${title}，是我小林呀！上次您提到“${followUp}”，我一直惦记着，今天来听听您这边进展怎么样？`,
          usedMemoryText: followUp,
          usedReminderId: '',
        }
      }
      if (recentEvent) {
        return {
          text: `${title}，是我小林呀！上次我们聊到“${recentEvent}”，这两天还顺利吗？要是有不方便的地方，我们可以一起想办法。`,
          usedMemoryText: recentEvent,
          usedReminderId: '',
        }
      }
      if (interest) {
        return {
          text: `${title}，是我小林呀！还记得您对“${interest}”挺感兴趣，最近有没有新发现呀？`,
          usedMemoryText: interest,
          usedReminderId: '',
        }
      }
      return {
        text: `${title}，是我小林呀！想您了就给您打个电话，您最近怎么样呀？`,
        usedMemoryText: '',
        usedReminderId: '',
      }
    }

    if (followUp) {
      return {
        text: `${title}，您好呀！我是小林。上次您说“${followUp}”，我一直记着，今天特地来和您聊聊近况。`,
        usedMemoryText: followUp,
        usedReminderId: '',
      }
    }
    if (recentEvent) {
      return {
        text: `${title}，您好呀！我是小林。上次您提到“${recentEvent}”，后来怎么样啦？`,
        usedMemoryText: recentEvent,
        usedReminderId: '',
      }
    }
    if (interest) {
      return {
        text: `${title}，您好呀！我是小林。之前您聊到“${interest}”，我想着今天再和您多聊几句。`,
        usedMemoryText: interest,
        usedReminderId: '',
      }
    }
    return {
      text: `${title}，您好呀！我是小林，今天过得怎么样？`,
      usedMemoryText: '',
      usedReminderId: '',
    }
  },

  _pickFirstNotCooling(candidates) {
    const list = (candidates || [])
      .map(text => this._normalizeMemorySentence(text))
      .filter(Boolean)
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
    const fromUser = (userMessages || [])
      .filter(text => /今天|昨天|最近|这周|这两天|刚刚|前几天/.test(text))
      .filter(text => /去|做|看|买|复查|复诊|散步|睡|见|聊/.test(text))
      .map(text => this._normalizeMemorySentence(text))
      .filter(text => !this._isLowInfoSentence(text))
      .slice(0, 3)
    const fromHighlights = (highlights || [])
      .map(text => this._normalizeMemorySentence(text))
      .filter(text => !this._isLowInfoSentence(text))
      .slice(0, 3)
    return [].concat(fromHighlights, fromUser).slice(0, 5)
  },

  _extractInterestTags(userMessages) {
    const interestDict = {
      太极拳: ['太极', '太极拳'],
      书法: ['书法'],
      烹饪: ['烹饪', '做饭'],
      广场舞: ['广场舞', '跳舞'],
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
      Object.keys(interestDict).forEach(tag => {
        const variants = interestDict[tag]
        if (variants.some(keyword => line.includes(keyword))) {
          tags.push(tag)
        }
      })
    })
    return Array.from(new Set(tags)).slice(0, 5)
  },

  _extractByKeywords(userMessages, keywords, limit) {
    const result = []
    ;(userMessages || []).forEach(text => {
      const line = this._normalizeMemorySentence(text)
      if (!line) return
      if (this._isLowInfoSentence(line)) return
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
    return false
  },

  // 更新 store 中的通话记录
  _updateCallRecord(callId, summaryData) {
    const updated = store.updateCallRecord(callId, {
      summary: summaryData.summary || '',
      topics: summaryData.topics || [],
      highlights: summaryData.highlights || [],
      mood: summaryData.moodEmoji || summaryData.mood || '😊',
      moodLabel: summaryData.mood || '开心',
      summaryStatus: summaryData.summaryStatus || 'done',
      summaryUpdatedAt: summaryData.summaryUpdatedAt || new Date().toISOString(),
      summaryError: summaryData.summaryError || '',
    })

    if (updated) {
      console.log('[Call] 摘要已更新:', callId)
    }
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
    if (this.subtitleFlushTimer) {
      clearTimeout(this.subtitleFlushTimer)
      this.subtitleFlushTimer = null
    }
    this._clearGreetingEchoGuardFailsafe()
    if (this.connectingFallbackTimer) {
      clearTimeout(this.connectingFallbackTimer)
      this.connectingFallbackTimer = null
    }
    this._stopTimer()
    this._stopUplinkKeepalive()
    this.recorder.stop()
    this.player.stop()
    this.player.destroy()
    if (this.client.connected) {
      this.client.finishSession()
      this.client.disconnect()
    }
  },
})
