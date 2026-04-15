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
      if (item.missed) return item

      let summaryStatusText = '查看摘要 ›'
      let summaryStatusClass = 'status-summary'

      if (item.summaryStatus === 'pending') {
        summaryStatusText = '摘要生成中'
        summaryStatusClass = 'status-pending'
      } else if (item.summaryStatus === 'failed') {
        summaryStatusText = '摘要生成失败'
        summaryStatusClass = 'status-failed'
      }

      return Object.assign({}, item, {
        summaryStatusText,
        summaryStatusClass,
      })
    })

    this.setData({
      allRecords: decoratedRecords,
      hasRecords: history.length > 0,
    })
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
