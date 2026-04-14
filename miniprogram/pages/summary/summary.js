const store = require('../../utils/store')

Page({
  data: {
    record: null,
    notFound: false,
  },

  onLoad(options) {
    const { id } = options
    if (!id) {
      this.setData({ notFound: true })
      return
    }

    const history = store.getCallHistory()
    const record = history.find((r) => r.id === id)

    if (record) {
      this.setData({ record })
    } else {
      this.setData({ notFound: true })
    }
  },

  goBack() {
    wx.navigateBack()
  },
})
