const store = require('../../utils/store')

Page({
  data: {
    currentTab: 'all',
    allRecords: [],
    hasRecords: false,
  },

  onShow() {
    this._loadRecords()
  },

  _loadRecords() {
    const history = store.getCallHistory()
    const decoratedRecords = history.map(item => {
      if (item.missed) {
        return Object.assign({}, item, {
          moodStampText: '未',
          moodStampClass: 'mood-stamp-missed',
        })
      }

      let summaryStatusText = '查看摘要 ›'
      let summaryStatusClass = 'status-summary'
      let moodLabel = item.moodLabel || '平静'

      if (item.summaryStatus === 'pending') {
        summaryStatusText = '摘要生成中'
        summaryStatusClass = 'status-pending'
        moodLabel = '分析中'
      } else if (item.summaryStatus === 'failed') {
        summaryStatusText = '摘要生成失败'
        summaryStatusClass = 'status-failed'
      }
      const moodStamp = this._getMoodStamp(moodLabel)

      return Object.assign({}, item, {
        moodStampText: moodStamp.text,
        moodStampClass: moodStamp.className,
        summaryStatusText,
        summaryStatusClass,
      })
    })

    this.setData({
      allRecords: decoratedRecords,
      hasRecords: history.length > 0,
    })
  },

  _getMoodStamp(moodLabel) {
    const map = {
      开心: { text: '喜', className: 'mood-stamp-happy' },
      平静: { text: '平', className: 'mood-stamp-calm' },
      低落: { text: '忧', className: 'mood-stamp-low' },
      焦虑: { text: '焦', className: 'mood-stamp-anxious' },
      分析中: { text: '析', className: 'mood-stamp-pending' },
    }
    return map[moodLabel] || map['平静']
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ currentTab: tab })
  },

  goSummary(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/summary/summary?id=${id}`
    })
  },
})
