let localConfig = {}
try {
  localConfig = require('./config.local')
} catch (err) {
  localConfig = {}
}
const store = require('./utils/store')

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
    // 初始化云开发
    if (wx.cloud) {
      wx.cloud.init({
        env: localConfig.cloudEnvId || wx.cloud.DYNAMIC_CURRENT_ENV,
        traceUser: true,
      })
    }

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
    store.saveElderConfig(config)
  },

  // 保存 dialog_id
  saveDialogId(id) {
    store.saveDialogId(id)
  },

  // 添加通话记录
  addCallRecord(record) {
    store.addCallRecord(record)
  },
})
