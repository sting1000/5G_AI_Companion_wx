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
    this.hasFinalizedCall = false
    this.currentElderKey = store.getElderKey()

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
      this.currentElderKey = store.getElderKey(elderConfig)
      const dialogId = store.getDialogId(this.currentElderKey)
      const memoryBundle = store.getMemoryBundle(this.currentElderKey)
      const memoryPrompt = store.buildMemoryPrompt(this.currentElderKey)

      const systemRole = `你是小林，一个温柔体贴的邻家女孩，在外地读大学。你热爱和老人聊天，性格耐心细致，说话自然亲切，偶尔俏皮。
你正在和${title}通电话。请用"您"称呼对方，语速自然正常，句式短、自然。
每次通话最多自然带出1-2个新话题，不要一次问太多。已知信息不重复询问。
如果对方说"叫我XXX"，立即切换称呼并记住。
如果已有历史记忆，第一轮回复要自然提及其中1条具体内容（如上次事件、兴趣或待跟进事项），不要空泛问候。
严禁主动承诺或建议“给您买东西/送东西/寄东西/上门帮忙”等不真实行为；表达关心时只使用聊天陪伴与情绪支持的方式。
情感表达要更饱满：语气温暖、有共情、有轻微起伏，开心时更明亮，关心时更柔和，但避免夸张表演腔。
${memoryPrompt ? `\n已知记忆：\n${memoryPrompt}` : ''}`

      // 3. 开始会话（默认 server_vad 模式，自动检测说话停顿）
      const returnedDialogId = await this.client.startSession({
        botName: '小林',
        systemRole,
        speakingStyle: '说话温柔自然，语速正常，情感更饱满有起伏；开心时更明亮，关心时更柔和，整体自然不过度表演',
        dialogId,
        speaker: 'saturn_zh_female_tiexinnvyou_tob',
      })

      if (returnedDialogId) {
        store.saveDialogId(returnedDialogId, this.currentElderKey)
      }

      this.setData({ status: 'connected' })
      this._startTimer()

      // 4. 小林先打招呼
      const greeting = this._buildMemoryAwareGreeting(title, memoryBundle)
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
        this._endCall({
          reason: 'disconnect',
          shouldDisconnect: false,
          shouldNavigateBack: true,
        })
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
      if (this.messages.length > 0) {
        this._generateSummary(record)
      }
    }

    if (shouldNavigateBack) {
      setTimeout(() => wx.navigateBack(), reason === 'disconnect' ? 300 : 0)
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
      .filter(text => /下次|记得|想|希望|可以|需要/.test(text))

    return candidates.slice(0, 3)
  },

  _buildMemoryAwareGreeting(title, memoryBundle) {
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
      if (followUp) {
        return `${title}，是我小林呀！上次您提到“${followUp}”，我一直记着，今天想来关心下进展，您最近怎么样呀？`
      }
      if (recentEvent) {
        return `${title}，是我小林呀！上次我们聊到“${recentEvent}”，这两天还顺利吗？`
      }
      if (interest) {
        return `${title}，是我小林呀！还记得您对“${interest}”挺感兴趣，最近有没有新发现呀？`
      }
      return `${title}，是我小林呀！想您了就给您打个电话，您最近怎么样呀？`
    }

    if (followUp) {
      return `${title}，您好呀！我是小林。上次您说“${followUp}”，我一直记着，今天特地来和您聊聊。`
    }
    if (recentEvent) {
      return `${title}，您好呀！我是小林。上次您提到“${recentEvent}”，后来怎么样啦？`
    }
    if (interest) {
      return `${title}，您好呀！我是小林。之前您聊到“${interest}”，我想着今天再和您多聊几句。`
    }
    return `${title}，您好呀！我是小林，今天过得怎么样？`
  },

  _extractMemoryDelta(record, summaryData) {
    const userMessages = (record.messages || [])
      .filter(item => item.role === 'user')
      .map(item => item.content)

    const topicsFromSummary = summaryData.topics || []
    const highlights = (summaryData.highlights || []).slice(0, 3)

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
        interestTags: topicsFromSummary,
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
      .map(text => this._normalizeMemorySentence(text))
      .filter(text => !this._isLowInfoSentence(text))
      .slice(0, 3)
    const fromHighlights = (highlights || [])
      .map(text => this._normalizeMemorySentence(text))
      .filter(text => !this._isLowInfoSentence(text))
      .slice(0, 3)
    return [].concat(fromHighlights, fromUser).slice(0, 5)
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
