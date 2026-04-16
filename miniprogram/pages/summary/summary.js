const store = require('../../utils/store')

Page({
  data: {
    record: null,
    notFound: false,
    callId: '',
  },

  onLoad(options) {
    const callId = options.id
    if (!callId) {
      this.setData({ notFound: true })
      return
    }

    this.setData({ callId })
    this._loadRecord()
  },

  onShow() {
    if (this.data.callId) {
      this._loadRecord()
    }
  },

  _loadRecord() {
    const history = store.getCallHistory()
    const record = history.find(r => r.id === this.data.callId)

    if (!record) {
      this.setData({ notFound: true, record: null })
      return
    }

    const moodLabel = String(record.moodLabel || '平静')
    const moodScoreMap = {
      开心: 5,
      平静: 3,
      低落: 2,
      焦虑: 1,
      分析中: 0,
    }
    const moodScore = moodScoreMap[moodLabel] || 3
    const moodStars = [1, 2, 3, 4, 5].map((value) => ({
      value,
      active: value <= moodScore,
    }))
    const topics = Array.isArray(record.topics) ? record.topics : []
    const hasHealthSignal = topics.some(tag => /(健康|心脏病|胸闷|胸痛|吃药|血压|血糖|失眠|复查|复诊)/.test(String(tag || '')))
    const signalTitle = hasHealthSignal ? '健康信号' : '兴趣信号'
    const signalIcon = hasHealthSignal ? '🩺' : '📡'
    const signalTip = hasHealthSignal
      ? '检测到健康风险相关线索，建议优先关注用药与就医安排。'
      : 'AI将适时为老人推荐相关内容，帮助丰富日常生活。'
    const decoratedRecord = Object.assign({}, record, {
      moodScore,
      moodStars,
      signalTitle,
      signalIcon,
      signalTip,
    })

    this.setData({
      record: decoratedRecord,
      notFound: false,
    })
  },

  goBack() {
    wx.navigateBack()
  },
})
