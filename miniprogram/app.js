App({
  globalData: {
    // 老人配置信息
    elderConfig: null,
    // 当前对话的 dialog_id（跨通话记忆）
    dialogId: '',
    // 通话历史
    callHistory: [],
  },

  onLaunch() {
    // 从本地存储恢复数据
    const elderConfig = wx.getStorageSync('elderConfig')
    if (elderConfig) {
      this.globalData.elderConfig = elderConfig
    }
    const dialogId = wx.getStorageSync('dialogId')
    if (dialogId) {
      this.globalData.dialogId = dialogId
    }
    const callHistory = wx.getStorageSync('callHistory')
    if (callHistory) {
      this.globalData.callHistory = callHistory
    }
  },

  // 保存老人配置
  saveElderConfig(config) {
    this.globalData.elderConfig = config
    wx.setStorageSync('elderConfig', config)
  },

  // 保存 dialog_id
  saveDialogId(id) {
    this.globalData.dialogId = id
    wx.setStorageSync('dialogId', id)
  },

  // 添加通话记录
  addCallRecord(record) {
    this.globalData.callHistory.unshift(record)
    wx.setStorageSync('callHistory', this.globalData.callHistory)
  },
})
