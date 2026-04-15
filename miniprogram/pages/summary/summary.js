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

    this.setData({
      record,
      notFound: false,
    })
  },

  goBack() {
    wx.navigateBack()
  },
})
