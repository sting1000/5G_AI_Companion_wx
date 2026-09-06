const store = require('../../utils/store')
const permissions = require('../../utils/permissions')

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

function permissionLabel(state, type) {
  if (state === 'granted') return '已允许'
  if (state === 'denied' || state === 'blocked') return '需要去设置中恢复'
  if (state === 'unconfigured') return type === 'notification' ? '提醒服务尚未配置' : '暂不可用'
  if (state === 'failed') return '暂时没有设置成功'
  return '点击设置'
}

Page({
  data: {
    preferredAddress: '未设置',
    microphoneState: 'initial',
    microphoneText: '点击设置',
    notificationState: 'initial',
    notificationText: '点击设置',
    microphoneBusy: false,
    notificationBusy: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
  },

  onLoad() {
    this._isUnloaded = false
    this._settingsRequestId = 0
    this.setData(getNavigationMetrics())
  },

  onShow() {
    this._isUnloaded = false
    this.loadSettings()
  },

  onUnload() {
    this._isUnloaded = true
  },

  async loadSettings() {
    const requestId = (Number(this._settingsRequestId) || 0) + 1
    this._settingsRequestId = requestId
    const snapshot = await permissions.getPermissionSnapshot()
    if (this._isUnloaded || requestId !== this._settingsRequestId) return
    this.setData({
      preferredAddress: store.getElderTitle() || '未设置',
      microphoneState: snapshot.microphone,
      microphoneText: permissionLabel(snapshot.microphone, 'microphone'),
      notificationState: snapshot.notification,
      notificationText: permissionLabel(snapshot.notification, 'notification'),
    })
  },

  editPreferredAddress() {
    wx.navigateTo({
      url: '/pages/onboarding/onboarding?mode=edit&step=1',
    })
  },

  async recoverMicrophone() {
    if (this.data.microphoneBusy) return
    this.setData({ microphoneBusy: true })
    let state = this.data.microphoneState
    if (state === 'initial') {
      const result = await permissions.authorizeRecord()
      state = result.state
    } else {
      const settings = await permissions.openAppSettings()
      const authSetting = settings.authSetting || {}
      state = authSetting['scope.record'] === true ? 'granted' : 'denied'
    }
    if (this._isUnloaded) return
    this.setData({
      microphoneBusy: false,
      microphoneState: state,
      microphoneText: permissionLabel(state, 'microphone'),
    })
  },

  async recoverNotification() {
    if (this.data.notificationBusy) return
    this.setData({ notificationBusy: true })
    let state = this.data.notificationState
    if (state === 'blocked' || state === 'denied' || state === 'granted') {
      const settings = await permissions.openAppSettings()
      state = permissions.resolveNotificationState(
        settings,
        permissions.getReminderTemplateId()
      )
    } else {
      const result = await permissions.requestReminderSubscription()
      state = result.state
    }
    if (this._isUnloaded) return
    this.setData({
      notificationBusy: false,
      notificationState: state,
      notificationText: permissionLabel(state, 'notification'),
    })
    if (state === 'unconfigured') {
      wx.showModal({
        title: '提醒服务尚未配置',
        content: '当前版本暂时不能申请提醒通知，请稍后再试。',
        showCancel: false,
      })
    }
  },

  openAbout() {
    wx.showModal({
      title: '关于叮嘱',
      content: '叮嘱是一款面向长辈的语音陪伴小程序。您可以和小林聊聊天，也可以请小林记录提醒。',
      showCancel: false,
      confirmText: '知道了',
    })
  },

  openPrivacy() {
    if (!wx.openPrivacyContract) {
      this._showPrivacyUnavailable()
      return
    }
    wx.openPrivacyContract({
      fail: () => this._showPrivacyUnavailable(),
    })
  },

  _showPrivacyUnavailable() {
    wx.showModal({
      title: '暂时无法打开隐私说明',
      content: '微信隐私保护指引暂时不可用，请稍后再试。',
      showCancel: false,
      confirmText: '知道了',
    })
  },

  goBack() {
    wx.navigateBack()
  },
})

module.exports = {
  permissionLabel,
}
