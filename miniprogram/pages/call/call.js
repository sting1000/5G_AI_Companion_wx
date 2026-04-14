const { RealtimeAPIClient } = require('../../utils/realtime-api')
const { AudioRecorder, AudioPlayer } = require('../../utils/audio')
const store = require('../../utils/store')

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
    debugInput: '', // 开发者工具文本调试
  },

  onLoad(options) {
    this.client = new RealtimeAPIClient()
    this.recorder = new AudioRecorder()
    this.player = new AudioPlayer()
    this.timer = null
    this.chatBuffer = ''
    this.messages = []

    // incoming 模式：先显示来电界面
    if (options.mode === 'incoming') {
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

    try {
      // 1. 请求麦克风权限
      await this._authorize()

      // 2. 连接 WebSocket
      await this.client.connect()

      const elderConfig = store.getElderConfig()
      const title = store.getElderTitle()
      const dialogId = store.getDialogId()

      const systemRole = `你是小林，一个温柔体贴的邻家女孩，在外地读大学。你热爱和老人聊天，性格耐心细致，说话自然亲切，偶尔俏皮。
你正在和${title}通电话。请用"您"称呼对方，语速适中偏慢，句式短、自然。
每次通话最多自然带出1-2个新话题，不要一次问太多。已知信息不重复询问。
如果对方说"叫我XXX"，立即切换称呼并记住。`

      // 3. 开始会话（默认 server_vad 模式，自动检测说话停顿）
      const returnedDialogId = await this.client.startSession({
        botName: '小林',
        systemRole,
        speakingStyle: '说话温柔自然，像邻家女孩一样亲切，语速偏慢',
        dialogId,
        speaker: 'saturn_zh_female_tiexinnvyou_tob',
      })

      if (returnedDialogId) {
        store.saveDialogId(returnedDialogId)
      }

      this.setData({ status: 'connected' })
      this._startTimer()

      // 4. 小林先打招呼
      const greeting = this.data.callMode === 'incoming'
        ? `${title}，是我小林呀！想您了就给您打个电话，您最近怎么样呀？`
        : `${title}，您好呀！我是小林，今天过得怎么样？`
      this.client.sayHello(greeting)

      // 5. 开始录音，持续流式发送（麦克风常开模式）
      console.log('[Call] 开始启动录音...')
      this.recorder.start()
      console.log('[Call] recorder.start() 已调用')

    } catch (err) {
      console.error('[Call] start failed:', err)
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
      this.client.sendAudio(pcmBuffer)
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
    }

    // AI 回复文本（流式）
    this.client.onChatText = (text) => {
      this.chatBuffer += text
      this.setData({ subtitle: this.chatBuffer })
    }

    // TTS 音频数据
    this.client.onAudioData = (audioData) => {
      this.player.appendChunk(audioData)
    }

    // AI 开始说新的一句
    this.client.onTTSStart = (text) => {
      this.chatBuffer = ''
      this.setData({ userText: '' })
    }

    // AI 这一轮说完
    this.client.onTTSEnd = () => {
      this.player.playBuffered()
      if (this.chatBuffer) {
        this.messages.push({ role: 'assistant', content: this.chatBuffer })
      }
      this.chatBuffer = ''
    }

    this.client.onError = (err) => {
      console.error('[Call] API error:', err)
    }

    // WebSocket 意外断开时自动结束通话
    this.client.onDisconnect = () => {
      console.log('[Call] WebSocket disconnected')
      if (this.data.status === 'connected') {
        this.setData({ status: 'ended', subtitle: '通话已结束' })
        this._stopTimer()
        this.recorder.stop()
        this.player.stop()
      }
    }
  },

  // ===== 开发者工具文本调试 =====
  onDebugInput(e) {
    this.setData({ debugInput: e.detail.value })
  },

  onDebugSend() {
    const text = this.data.debugInput.trim()
    if (!text || this.data.status !== 'connected') return
    console.log('[Call] 调试发送文本:', text)
    this.setData({ debugInput: '', userText: text })
    this.messages.push({ role: 'user', content: text })
    this.client.sendTextQuery(text)
  },

  // 挂断
  onHangup() {
    if (this.data.status === 'ended') return
    this.setData({ status: 'ended' })
    this.recorder.stop()
    this.player.stop()
    this.client.finishSession()
    this.client.disconnect()
    this._stopTimer()

    const duration = this.data.elapsed
    const minutes = Math.floor(duration / 60)
    const seconds = duration % 60
    const durationText = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`

    const now = new Date()
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const record = {
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
    }

    if (this.messages.length > 0 || duration > 5) {
      store.addCallRecord(record)
    }

    wx.navigateBack()
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
    this._stopTimer()
    this.recorder.stop()
    this.player.stop()
    this.player.destroy()
    if (this.client.connected) {
      this.client.finishSession()
      this.client.disconnect()
    }
  },
})
