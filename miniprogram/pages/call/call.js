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

Page({
  data: {
    status: 'connecting', // connecting | connected | ended
    elapsed: 0,
    elapsedText: '00:00',
    subtitle: '',
    userText: '',
    isSpeaking: false,
    showIncoming: false, // 是否展示来电界面
    callMode: 'outgoing', // outgoing | incoming
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
    this.setData({ showIncoming: false })
    this._startCall()
  },

  onDecline() {
    wx.navigateBack()
  },

  // ===== 通话核心逻辑 =====
  async _startCall() {
    this._setupCallbacks()
    console.log(FLOW_LOG_PREFIX, '开始通话初始化')

    try {
      // 1. 请求麦克风权限
      await this._authorize()
      console.log(FLOW_LOG_PREFIX, '麦克风权限已授权')

      // 2. 连接 WebSocket
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

      const systemRole = `你是小林，一个温柔体贴的邻家女孩，在外地读大学。你热爱和老人聊天，性格耐心细致，说话自然亲切，偶尔俏皮。
你正在和${title}通电话。请用"您"称呼对方，语速自然正常，句式短、自然。
每次通话最多自然带出1-2个新话题，不要一次问太多。已知信息不重复询问。
如果对方说"叫我XXX"，立即切换称呼并记住。
如果已有历史记忆，第一轮回复要自然提及其中1条具体内容（如上次事件、兴趣或待跟进事项），不要空泛问候。
严禁主动承诺或建议“给您买东西/送东西/寄东西/上门帮忙”等不真实行为；表达关心时只使用聊天陪伴与情绪支持的方式。
情感表达要更饱满：语气温暖、有共情、有轻微起伏，开心时更明亮，关心时更柔和，但避免夸张表演腔。
${memoryPrompt ? `\n已知记忆：\n${memoryPrompt}` : ''}${contextPrompt}`

      // 3. 开始会话（默认 server_vad 模式，自动检测说话停顿）
      this.sessionOptions = {
        botName: '小林',
        systemRole,
        speakingStyle: '说话温柔自然，语速正常，情感更饱满有起伏；开心时更明亮，关心时更柔和，整体自然不过度表演',
        dialogId,
        speaker: 'saturn_zh_female_tiexinnvyou_tob',
      }
      const returnedDialogId = await this.client.startSession(this.sessionOptions)
      console.log(FLOW_LOG_PREFIX, '会话已启动', {
        dialogId: returnedDialogId || '',
      })

      if (returnedDialogId) {
        store.saveDialogId(returnedDialogId, this.currentElderKey)
      }

      this.setData({ status: 'connected' })
      this._startTimer()
      console.log(FLOW_LOG_PREFIX, '状态切换为 connected')
      this._startUplinkKeepalive()
      this._armGreetingEchoGuardFailsafe()

      // 4. 小林先打招呼
      this.client.sayHello(greetingPayload.text)
      if (greetingPayload.usedMemoryText) {
        store.markMemoryItemsUsed(this.currentElderKey, [greetingPayload.usedMemoryText])
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
      this.setData({ subtitle: '连接失败，请重试' })
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
      this.chatBuffer += text
      this.pendingSubtitle = this.chatBuffer
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
      this.player.appendChunk(audioData)
      if (this.currentLatencyTurn && !this.currentLatencyTurn.firstTTSAt) {
        this.currentLatencyTurn.firstTTSAt = Date.now()
        console.log(FLOW_LOG_PREFIX, '收到首个 TTS 音频分片')
      }
    }

    // AI 开始说新的一句
    this.client.onTTSStart = (text) => {
      this.chatBuffer = ''
      this.pendingSubtitle = ''
      this.setData({ userText: '', isSpeaking: false })
    }

    // AI 这一轮说完
    this.client.onTTSEnd = () => {
      const isFirstAssistantTurn = this.assistantTurnCount === 0 && !!this.chatBuffer
      this._flushSubtitle(true)
      this.player.playBuffered()
      if (this.chatBuffer) {
        this.messages.push({ role: 'assistant', content: this.chatBuffer })
        this.assistantTurnCount += 1
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
    memoryDelta.xiaolinMemory.preferredAddress = title
    memoryDelta.xiaolinMemory.careStrategies = ['语速自然正常，语句简短，多确认，情绪表达更有温度']

    if (elderConfig && elderConfig.health) {
      memoryDelta.elderMemory.healthNotes = [elderConfig.health]
    }

    store.mergeMemoryBundle(elderKey, memoryDelta, record.id)
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
    const recentEvent = elderMemory.recentEvents && elderMemory.recentEvents.length > 0
      ? elderMemory.recentEvents[0]
      : ''
    const interest = elderMemory.interestTags && elderMemory.interestTags.length > 0
      ? elderMemory.interestTags[0]
      : ''
    const followUp = xiaolinMemory.followUps && xiaolinMemory.followUps.length > 0
      ? xiaolinMemory.followUps[0]
      : ''

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
          text: `${title}，是我小林呀！上次您提到“${followUp}”，我一直记着，今天想来关心下进展，您最近怎么样呀？`,
          usedMemoryText: followUp,
          usedReminderId: '',
        }
      }
      if (recentEvent) {
        return {
          text: `${title}，是我小林呀！上次我们聊到“${recentEvent}”，这两天还顺利吗？`,
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
        text: `${title}，您好呀！我是小林。上次您说“${followUp}”，我一直记着，今天特地来和您聊聊。`,
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
