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
    totalInterests: 0,
    // 兴趣信号
    latestSignal: '',
    hasSignal: false,
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
    if (history.length > 0) {
      const latest = history[0]
      this.setData({
        hasCallHistory: true,
        lastCallTime: '上次通话：' + (latest.date || '未知'),
        lastMood: latest.mood || '😊',
        lastMoodLabel: latest.moodLabel || '开心',
        totalCalls: history.length,
      })
    } else {
      this.setData({
        hasCallHistory: false,
        lastCallTime: '还没有通话记录',
        lastMood: '',
        lastMoodLabel: '',
        totalCalls: 0,
      })
    }
  },

  // 加载档案信息（兴趣等）
  _loadProfile() {
    const profile = store.getProfile()
    const hobbies = profile.hobbies || []

    this.setData({
      totalInterests: hobbies.length,
    })

    // 如果有兴趣爱好，在信号卡片中展示最新的
    if (hobbies.length > 0) {
      const latest = hobbies[hobbies.length - 1]
      this.setData({
        hasSignal: true,
        latestSignal: latest,
      })
    } else {
      this.setData({ hasSignal: false })
    }
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
})
