const store = require('../../utils/store')

Page({
  data: {
    recommendEnabled: true,
    isDevMode: false,
    memoryDebugText: '',
    currentElderTitle: '',
  },

  onLoad() {
    // 可以在这里从本地存储读取设置选项
    const settings = wx.getStorageSync('userSettings') || {}
    if (typeof settings.recommendEnabled !== 'undefined') {
      this.setData({ recommendEnabled: settings.recommendEnabled })
    }

    const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null
    const envVersion = accountInfo && accountInfo.miniProgram ? accountInfo.miniProgram.envVersion : 'release'
    const isDevMode = envVersion !== 'release'
    this.setData({ isDevMode })
    if (isDevMode) {
      this.refreshMemoryDebug()
    }
  },

  onShow() {
    if (this.data.isDevMode) {
      this.refreshMemoryDebug()
    }
  },

  onRecommendChange(e) {
    const isEnabled = e.detail.value
    this.setData({ recommendEnabled: isEnabled })
    
    const settings = wx.getStorageSync('userSettings') || {}
    settings.recommendEnabled = isEnabled
    wx.setStorageSync('userSettings', settings)
  },

  refreshMemoryDebug() {
    const snapshot = store.getMemoryDebugSnapshot()
    const elderConfig = store.getElderConfig()
    const elderTitle = elderConfig ? `${elderConfig.parentName || ''}${elderConfig.titleSuffix || ''}` : '未配置老人'
    this.setData({
      currentElderTitle: elderTitle,
      memoryDebugText: JSON.stringify(snapshot, null, 2),
    })
  },

  onResetCurrentMemory() {
    const elderKey = store.getElderKey()
    const elderConfig = store.getElderConfig()
    wx.showModal({
      title: '重置当前老人记忆',
      content: '将清空当前老人的双记忆与会话上下文，确定继续吗？',
      success: (res) => {
        if (!res.confirm) return
        store.clearMemoryBundle(elderKey)
        store.clearDialogId(elderKey)
        if (elderConfig) {
          store.initMemoryBundle(elderKey, {
            health: elderConfig.health,
            hobbies: elderConfig.hobbies || [],
            preferredAddress: store.getElderTitle(),
          })
        }
        this.refreshMemoryDebug()
        wx.showToast({
          title: '已重置当前老人记忆',
          icon: 'none',
        })
      },
    })
  },

  goOnboarding() {
    wx.navigateTo({
      url: '/pages/onboarding/onboarding'
    })
  },

  onClearAllTestData() {
    wx.showModal({
      title: '清空本地测试数据',
      content: '将清空老人配置、通话记录、记忆和会话上下文。确认继续吗？',
      success: (res) => {
        if (!res.confirm) return
        store.clearAllRuntimeData()
        wx.showToast({
          title: '已清空，正在跳转配置页',
          icon: 'none',
        })
        setTimeout(() => {
          wx.reLaunch({
            url: '/pages/onboarding/onboarding'
          })
        }, 300)
      },
    })
  },

  onLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success(res) {
        if (res.confirm) {
          // 清除相关数据跳转登录等
          wx.showToast({
            title: '已退出登录',
            icon: 'none'
          })
        }
      }
    })
  }
})
