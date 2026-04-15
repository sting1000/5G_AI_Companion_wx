const store = require('../../utils/store')

Page({
  data: {
    // 老人信息
    elderName: '',
    elderEmoji: '👩',
    // 最近通话
    lastCallTime: '',
    lastMood: '',
    lastMoodLabel: '',
    hasCallHistory: false,
    // 统计
    totalCalls: 0,
    totalDurationText: '0秒',
    // 兴趣信号
    interestTags: [],
    hasSignal: false,
    // 健康信号
    healthTags: [],
    hasHealthSignal: false,
    // 预警
    hasWarning: false,
    // 是否已配置
    configured: false,
  },

  onShow() {
    const config = store.getElderConfig()
    if (!config) {
      wx.navigateTo({
        url: '/pages/onboarding/onboarding'
      })
      return
    }

    this.setData({ configured: true })
    this._loadElderInfo(config)
    this._loadCallHistory()
    this._loadProfile()
  },

  // 加载老人基本信息
  _loadElderInfo(config) {
    this.setData({
      elderName: config.parentName || '未设置',
    })
  },

  // 加载通话记录相关数据
  _loadCallHistory() {
    const history = store.getCallHistory()
    const totalDurationSeconds = history.reduce((sum, item) => {
      if (typeof item.durationSeconds === 'number' && item.durationSeconds >= 0) {
        return sum + item.durationSeconds
      }
      return sum + this._parseDurationToSeconds(item.duration)
    }, 0)
    if (history.length > 0) {
      const latest = history[0]
      this.setData({
        hasCallHistory: true,
        lastCallTime: '上次通话：' + (latest.date || '未知'),
        lastMood: latest.mood || '😊',
        lastMoodLabel: latest.moodLabel || '开心',
        totalCalls: history.length,
        totalDurationText: this._formatDuration(totalDurationSeconds),
      })
    } else {
      this.setData({
        hasCallHistory: false,
        lastCallTime: '还没有通话记录',
        lastMood: '',
        lastMoodLabel: '',
        totalCalls: 0,
        totalDurationText: '0秒',
      })
    }
  },

  // 加载档案信息（兴趣等）
  _loadProfile() {
    const config = store.getElderConfig() || {}
    const profile = store.getProfile()
    const hobbies = profile.hobbies || []
    const healthSource = config.health || profile.health || ''
    const extractedHealthTags = this._extractHealthTags(healthSource)

    const interestTags = this._uniqTags(hobbies).slice(0, 6)
    const healthTags = this._uniqTags(extractedHealthTags).slice(0, 6)

    this.setData({
      hasSignal: interestTags.length > 0,
      interestTags,
      hasHealthSignal: healthTags.length > 0,
      healthTags,
    })
  },

  goCall() {
    wx.navigateTo({
      url: '/pages/call/call'
    })
  },

  goReminders() {
    wx.switchTab({
      url: '/pages/reminders/reminders',
    })
  },

  goSimulatedIncoming() {
    const elderKey = store.getElderKey()
    const picked = store.pickNextIncomingReminder(elderKey)
    const query = ['mode=incoming', 'triggerSource=manual']
    if (picked) {
      query.push(`reminderId=${encodeURIComponent(picked.id)}`)
      query.push(`reminderText=${encodeURIComponent(picked.title || '')}`)
    }
    wx.navigateTo({
      url: `/pages/call/call?${query.join('&')}`,
    })
  },

  _parseDurationToSeconds(durationText) {
    if (!durationText) return 0
    const text = String(durationText)
    const hourMatch = text.match(/(\d+)\s*小时/)
    const minuteMatch = text.match(/(\d+)\s*分/)
    const secondMatch = text.match(/(\d+)\s*秒/)
    const hours = hourMatch ? Number(hourMatch[1]) : 0
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0
    const seconds = secondMatch ? Number(secondMatch[1]) : 0
    const total = hours * 3600 + minutes * 60 + seconds
    return Number.isFinite(total) ? total : 0
  },

  _formatDuration(totalSeconds) {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0)
    const hours = Math.floor(safeSeconds / 3600)
    const minutes = Math.floor((safeSeconds % 3600) / 60)
    const seconds = safeSeconds % 60
    if (hours > 0) return `${hours}时${minutes}分`
    if (minutes > 0) return `${minutes}分${seconds}秒`
    return `${seconds}秒`
  },

  _extractHealthTags(healthText) {
    const text = String(healthText || '').trim()
    if (!text) return []
    const compact = text.replace(/\s+/g, '')
    const keywordDict = [
      ['睡眠问题', ['失眠', '睡眠', '睡不着', '早醒', '入睡困难']],
      ['高血压', ['高血压', '血压', '头晕']],
      ['血糖异常', ['血糖', '糖尿病']],
      ['心脏不适', ['心脏', '心悸', '胸闷', '胸痛']],
      ['关节疼痛', ['关节', '膝盖', '腰痛', '腰酸', '腿疼', '疼痛']],
      ['胃口与消化', ['胃口', '食欲', '消化', '胃痛', '腹胀']],
      ['用药管理', ['吃药', '药', '按时服药', '漏服']],
    ]
    const matchedMeta = keywordDict
      .map(([tag, keywords]) => ({
        tag,
        keywords,
        matchedKeywords: keywords.filter(keyword => compact.includes(keyword)),
      }))
      .filter(item => item.matchedKeywords.length > 0)
    const matched = matchedMeta.map(item => item.tag)
    const matchedKeywordList = matchedMeta.reduce((all, item) => all.concat(item.matchedKeywords), [])

    const fallbackTags = text
      .split(/[，。,、；;！!？?\n]/)
      .map(item => item.trim())
      .filter(Boolean)
      .filter(item => !matchedKeywordList.some(keyword => item.includes(keyword)))
      .map(item => (item.length > 8 ? `${item.slice(0, 8)}...` : item))

    return this._uniqTags([].concat(matched, fallbackTags))
  },

  _uniqTags(tags) {
    return (tags || []).filter((tag, index, list) => {
      const text = String(tag || '').trim()
      if (!text) return false
      return list.findIndex(item => String(item || '').trim() === text) === index
    }).map(tag => String(tag).trim())
  },
})
