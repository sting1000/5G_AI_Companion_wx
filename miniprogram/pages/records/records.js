const store = require('../../utils/store')

function getNavigationMetrics() {
  let statusBarHeight = 20
  let navigationBarHeight = 44
  try {
    const windowInfo = wx.getWindowInfo
      ? wx.getWindowInfo()
      : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {})
    statusBarHeight = Number(windowInfo.statusBarHeight || statusBarHeight)
    const menu = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : null
    if (menu && menu.height) {
      navigationBarHeight = menu.height + Math.max(0, menu.top - statusBarHeight) * 2
    }
  } catch (err) {}
  return { statusBarHeight, navigationBarHeight }
}

function formatRecordDate(value) {
  const text = String(value || '').trim()
  const chineseDate = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}))?/)
  if (chineseDate) {
    return {
      dateText: `${Number(chineseDate[2])}月${Number(chineseDate[3])}日`,
      timeText: chineseDate[4] ? `${chineseDate[4].padStart(2, '0')}:${chineseDate[5]}` : '',
    }
  }
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) {
    return {
      dateText: `${parsed.getMonth() + 1}月${parsed.getDate()}日`,
      timeText: `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`,
    }
  }
  return { dateText: text || '日期未知', timeText: '' }
}

function formatDuration(record) {
  if (record && record.duration) return String(record.duration)
  const seconds = Math.max(0, Number(record && record.durationSeconds) || 0)
  if (seconds < 60) return `${seconds}秒`
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}

function decorateRecord(record) {
  const date = formatRecordDate(record && record.date)
  const status = String((record && record.summaryStatus) || '')
  let summaryState = 'success'
  let summaryStatusText = record && record.summary ? '摘要已整理' : '通话内容已保存'
  if (record && record.missed) {
    summaryState = 'missed'
    summaryStatusText = '未接听'
  } else if (status === 'pending') {
    summaryState = 'pending'
    summaryStatusText = '摘要整理中'
  } else if (status === 'failed') {
    summaryState = 'failed'
    summaryStatusText = '摘要暂不可用，可查看通话内容'
  }
  return Object.assign({}, record, date, {
    durationText: formatDuration(record),
    summaryState,
    summaryStatusText,
  })
}

Page({
  data: {
    records: [],
    hasRecords: false,
    hasLoadError: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
  },

  onLoad() {
    this.setData(getNavigationMetrics())
  },

  onShow() {
    this.loadRecords()
  },

  loadRecords() {
    try {
      const records = store.getCallHistory().map(decorateRecord)
      this.setData({
        records,
        hasRecords: records.length > 0,
        hasLoadError: false,
      })
    } catch (err) {
      this.setData({
        records: [],
        hasRecords: false,
        hasLoadError: true,
      })
    }
  },

  goSummary(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    wx.navigateTo({
      url: `/pages/summary/summary?id=${encodeURIComponent(id)}`,
    })
  },

  goBack() {
    wx.navigateBack()
  },

  goToday() {
    wx.reLaunch({ url: '/pages/dashboard/dashboard' })
  },
})

module.exports = {
  decorateRecord,
  formatDuration,
  formatRecordDate,
}
