const store = require('../../utils/store')

Page({
  data: {
    elderConfig: null,
    elderTitle: '',
    callHistory: [],
    hasConfig: false,
  },

  onShow() {
    const elderConfig = store.getElderConfig()
    this.setData({
      elderConfig,
      elderTitle: store.getElderTitle(),
      callHistory: store.getCallHistory(),
      hasConfig: !!elderConfig,
    })
  },

  goOnboarding() {
    wx.navigateTo({ url: '/pages/onboarding/onboarding' })
  },

  goCall() {
    wx.navigateTo({ url: '/pages/call/call?mode=outgoing' })
  },

  goIncomingCall() {
    wx.navigateTo({ url: '/pages/call/call?mode=incoming' })
  },

  goSummary(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/summary/summary?id=${id}` })
  },
})
