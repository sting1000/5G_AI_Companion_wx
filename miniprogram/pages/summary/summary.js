const store = require('../../utils/store')
const { sanitizeTranscriptText } = require('../../utils/transcript-display')

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

function normalizeTranscript(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message, index) => {
      const content = sanitizeTranscriptText(message && message.content)
      if (!content) return null
      const role = String((message && message.role) || '')
      if (role !== 'user' && role !== 'assistant') return null
      return {
        id: `${role}_${index}`,
        role,
        speaker: role === 'user' ? '您' : '小林',
        content,
      }
    })
    .filter(Boolean)
}

function decorateRecord(record) {
  const summary = String((record && record.summary) || '').trim()
  const transcript = normalizeTranscript(record && record.messages)
  const rawStatus = String((record && record.summaryStatus) || '')
  let summaryState = 'success'
  let summaryStateText = summary ? '摘要已整理' : '通话内容已保存'
  let summaryMessage = summary || '本次通话较短，暂时没有摘要。'
  if (rawStatus === 'pending') {
    summaryState = 'pending'
    summaryStateText = '摘要整理中'
    summaryMessage = '通话内容已经保存，小林正在整理摘要。您可以稍后刷新查看。'
  } else if (rawStatus === 'failed') {
    summaryState = 'failed'
    summaryStateText = '摘要暂不可用'
    summaryMessage = '摘要这次没有整理好，已经保存的通话内容仍可在下方查看。'
  }
  return Object.assign({}, record, {
    durationText: String((record && record.duration) || '0秒'),
    summary,
    summaryState,
    summaryStateText,
    summaryMessage,
    transcript,
    hasTranscript: transcript.length > 0,
  })
}

Page({
  data: {
    record: null,
    notFound: false,
    loadError: false,
    callId: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
  },

  onLoad(options) {
    const callId = String((options && options.id) || '')
    this.setData(Object.assign({}, getNavigationMetrics(), { callId }))
    if (!callId) {
      this.setData({ notFound: true, loadError: false })
    }
  },

  onShow() {
    if (this.data.callId) this.loadRecord()
  },

  loadRecord() {
    try {
      const record = store.getCallHistory().find(item => item && item.id === this.data.callId)
      if (!record) {
        this.setData({ notFound: true, loadError: false, record: null })
        return
      }
      this.setData({
        record: decorateRecord(record),
        notFound: false,
        loadError: false,
      })
    } catch (err) {
      this.setData({ notFound: false, loadError: true, record: null })
    }
  },

  reloadRecord() {
    this.loadRecord()
  },

  goBack() {
    wx.navigateBack()
  },
})

module.exports = {
  decorateRecord,
  normalizeTranscript,
}
