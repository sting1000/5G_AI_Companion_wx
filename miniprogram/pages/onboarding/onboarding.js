const store = require('../../utils/store')
const permissions = require('../../utils/permissions')
const { OnboardingSpeechRecognizer } = require('../../utils/onboarding-speech')

const ADDRESS_MAX_LENGTH = 10
const ADDRESS_PATTERN = /^[\u3400-\u4dbf\u4e00-\u9fff]+$/u

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

function validateAddress(value) {
  const address = String(value || '').trim()
  if (!address) return '请告诉小林怎么称呼您'
  if (!ADDRESS_PATTERN.test(address)) return '称呼请只使用中文'
  if (Array.from(address).length > ADDRESS_MAX_LENGTH) return '称呼最多 10 个中文字符'
  return ''
}

Page({
  data: {
    step: 1,
    isEditMode: false,
    address: '',
    suggestions: ['王阿姨', '李叔叔', '老张'],
    validationError: '',
    isSaving: false,
    speechState: 'idle',
    speechHint: '',
    microphoneState: 'initial',
    microphoneBusy: false,
    notificationState: 'initial',
    notificationBusy: false,
    templateConfigured: false,
    permissionImpactText: '',
    isEntering: false,
    enterError: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
  },

  onLoad(options) {
    this._isUnloaded = false
    const metrics = getNavigationMetrics()
    const isEditMode = Boolean(options && options.mode === 'edit')
    const config = store.getElderConfig() || {}
    const address = String(
      config.preferredAddress
      || (config.parentName && config.titleSuffix
        ? `${String(config.parentName).trim().charAt(0)}${config.titleSuffix}`
        : config.parentName)
      || ''
    ).trim()
    this.setData(Object.assign({ address, isEditMode, step: 1 }, metrics))
    this._refreshPermissions()
  },

  onUnload() {
    this._isUnloaded = true
    this._destroySpeechRecognizer()
  },

  onAddressInput(event) {
    this._destroySpeechRecognizer()
    this.setData({
      address: event.detail.value,
      validationError: '',
      speechState: 'idle',
      speechHint: '',
    })
  },

  onSuggestionTap(event) {
    this._destroySpeechRecognizer()
    this.setData({
      address: event.currentTarget.dataset.value,
      validationError: '',
      speechState: 'idle',
      speechHint: '',
    })
  },

  async onVoiceTap() {
    if (this.data.speechState === 'connecting' || this.data.speechState === 'recognizing') return
    if (this.data.speechState === 'listening') {
      if (this.speechRecognizer) this.speechRecognizer.stop()
      this.setData({
        speechState: 'recognizing',
        speechHint: '正在识别，请稍候…',
      })
      return
    }

    const permission = await permissions.authorizeRecord()
    if (this._isUnloaded) return
    if (permission.state !== 'granted') {
      this.setData({
        microphoneState: 'denied',
        speechState: 'failed',
        speechHint: '没有麦克风权限，您也可以键盘输入，或稍后去设置中恢复。',
      })
      this._updatePermissionImpactText()
      return
    }

    this.setData({
      microphoneState: 'granted',
      speechState: 'connecting',
      speechHint: '正在准备语音识别…',
    })
    this._updatePermissionImpactText()
    this._destroySpeechRecognizer()
    this.speechRecognizer = new OnboardingSpeechRecognizer()
    try {
      await this.speechRecognizer.start({
        onListening: () => {
          if (this._isUnloaded) return
          this.setData({
            speechState: 'listening',
            speechHint: '正在听，请说出您希望的称呼。说完后再点一下。',
          })
        },
        onInterim: (text) => {
          if (this._isUnloaded) return
          this.setData({ address: text, validationError: '' })
        },
        onResult: (text) => {
          this.speechRecognizer = null
          if (this._isUnloaded) return
          this.setData({
            address: text,
            speechState: 'idle',
            speechHint: '已识别，您还可以继续修改。',
            validationError: '',
          })
        },
        onError: () => {
          this.speechRecognizer = null
          if (this._isUnloaded) return
          this.setData({
            speechState: 'failed',
            speechHint: '没有听清，请再试一次，或使用键盘输入。',
          })
        },
      })
    } catch (error) {
      this.speechRecognizer = null
      if (this._isUnloaded) return
      this.setData({
        speechState: 'failed',
        speechHint: '语音识别暂时不可用，请再试一次，或使用键盘输入。',
      })
    }
  },

  async onSaveAddress() {
    if (this.data.isSaving) return
    this._destroySpeechRecognizer()
    const validationError = validateAddress(this.data.address)
    if (validationError) {
      this.setData({ validationError })
      return
    }

    this.setData({ isSaving: true, validationError: '' })
    const address = this.data.address.trim()
    try {
      this.pendingConfig = this._buildNextConfig(address)
      if (this.data.isEditMode) {
        this._persistConfig(this.pendingConfig)
        this.setData({ isSaving: false })
        wx.showToast({ title: '称呼已保存', icon: 'success' })
        wx.navigateBack()
        return
      }
      this.setData({
        step: 2,
        isSaving: false,
      })
      await this._refreshPermissions()
    } catch (error) {
      this.setData({
        isSaving: false,
        validationError: '没有保存成功，请再试一次',
      })
    }
  },

  async onMicrophonePermissionTap() {
    if (this.data.microphoneBusy || this.data.microphoneState === 'granted') return
    this.setData({ microphoneBusy: true })
    let result
    if (this.data.microphoneState === 'denied') {
      const settings = await permissions.openAppSettings()
      const authSetting = settings.authSetting || {}
      result = {
        state: authSetting['scope.record'] === true ? 'granted' : 'denied',
      }
    } else {
      result = await permissions.authorizeRecord()
    }
    if (this._isUnloaded) return
    this.setData({
      microphoneBusy: false,
      microphoneState: result.state,
    })
    this._updatePermissionImpactText()
  },

  async onNotificationPermissionTap() {
    if (this.data.notificationBusy || this.data.notificationState === 'granted') return
    this.setData({ notificationBusy: true })
    let state = this.data.notificationState
    if (state === 'blocked') {
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
      templateConfigured: Boolean(permissions.getReminderTemplateId()),
    })
    this._updatePermissionImpactText()
  },

  enterToday() {
    if (this.data.isEntering) return
    this.setData({ isEntering: true, enterError: '' })
    try {
      const nextConfig = this.pendingConfig || this._buildNextConfig(this.data.address.trim())
      this._persistConfig(nextConfig)
      wx.reLaunch({
        url: '/pages/dashboard/dashboard',
      })
    } catch (error) {
      this.setData({
        isEntering: false,
        enterError: '没有保存成功，请再试一次',
      })
    }
  },

  async _refreshPermissions() {
    const snapshot = await permissions.getPermissionSnapshot()
    if (this._isUnloaded) return
    this.setData({
      microphoneState: snapshot.microphone,
      notificationState: snapshot.notification,
      templateConfigured: snapshot.templateConfigured,
    })
    this._updatePermissionImpactText()
  },

  _updatePermissionImpactText() {
    const impacts = []
    if (this.data.microphoneState !== 'granted') {
      impacts.push('未允许麦克风时，暂时不能和小林通话')
    }
    if (!this.data.templateConfigured) {
      impacts.push('当前版本尚未配置通知模板，到点提醒不会通过微信通知出现')
    } else if (this.data.notificationState !== 'granted') {
      impacts.push('未允许通知时，到点提醒不会通过微信通知出现')
    }
    this.setData({
      permissionImpactText: impacts.length > 0
        ? `${impacts.join('；')}。您仍可进入今天，之后可在设置中恢复。`
        : '麦克风和本次提醒通知均已允许。',
    })
  },

  _destroySpeechRecognizer() {
    if (!this.speechRecognizer) return
    this.speechRecognizer.destroy()
    this.speechRecognizer = null
  },

  _buildNextConfig(address) {
    const previousConfig = store.getElderConfig() || null
    const now = new Date().toISOString()
    const nextConfig = Object.assign({}, previousConfig || {}, {
      parentName: previousConfig && previousConfig.parentName
        ? previousConfig.parentName
        : address,
      preferredAddress: address,
      role: previousConfig && previousConfig.role ? previousConfig.role : '小林',
      updatedAt: now,
    })
    if (!nextConfig.createdAt) nextConfig.createdAt = now
    return nextConfig
  },

  _persistConfig(nextConfig) {
    const previousConfig = store.getElderConfig() || null
    const previousElderKey = previousConfig ? store.getElderKey(previousConfig) : ''
    const nextElderKey = store.getElderKey(nextConfig)
    store.saveElderConfig(nextConfig)
    store.initMemoryBundle(nextElderKey, {
      health: nextConfig.health || '',
      hobbies: nextConfig.hobbies || [],
      preferredAddress: nextConfig.preferredAddress,
    })
    if (previousElderKey && previousElderKey !== nextElderKey) {
      store.clearDialogId(nextElderKey)
    }
  },

  goBack() {
    wx.navigateBack()
  },
})

module.exports = {
  ADDRESS_MAX_LENGTH,
  validateAddress,
}
