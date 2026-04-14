const store = require('../../utils/store')

Page({
  data: {
    parentName: '',
    phone: '',
    titleSuffix: '阿姨',
    titleOptions: ['阿姨', '叔'],
    titleIndex: 0,
  },

  onInputName(e) {
    this.setData({ parentName: e.detail.value })
  },

  onInputPhone(e) {
    this.setData({ phone: e.detail.value })
  },

  onTitleChange(e) {
    const idx = Number(e.detail.value)
    this.setData({
      titleIndex: idx,
      titleSuffix: this.data.titleOptions[idx],
    })
  },

  onSubmit() {
    const { parentName, phone, titleSuffix } = this.data
    if (!parentName.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    if (!phone.trim()) {
      wx.showToast({ title: '请输入手机号', icon: 'none' })
      return
    }

    store.saveElderConfig({
      parentName: parentName.trim(),
      phone: phone.trim(),
      titleSuffix,
      role: '小林',
    })

    wx.reLaunch({ url: '/pages/dashboard/dashboard' })
  },
})
