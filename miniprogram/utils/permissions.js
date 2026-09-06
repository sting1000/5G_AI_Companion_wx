let localConfig = {}
try {
  localConfig = require('../config.local')
} catch (err) {
  localConfig = {}
}

const RECORD_SCOPE = 'scope.record'
const TEMPLATE_PLACEHOLDER_PATTERN = /^(YOUR_|PLACEHOLDER|请填写|待配置)/i

function getReminderTemplateId() {
  const subscriptionMessages = localConfig.subscriptionMessages || {}
  const templateId = String(subscriptionMessages.reminderTemplateId || '').trim()
  if (!templateId || TEMPLATE_PLACEHOLDER_PATTERN.test(templateId)) return ''
  return templateId
}

function getSetting() {
  return new Promise((resolve) => {
    if (!wx.getSetting) {
      resolve({})
      return
    }
    wx.getSetting({
      withSubscriptions: true,
      success: resolve,
      fail: () => resolve({}),
    })
  })
}

function authorizeRecord() {
  return new Promise((resolve) => {
    wx.authorize({
      scope: RECORD_SCOPE,
      success: () => resolve({ state: 'granted' }),
      fail: (error) => resolve({ state: 'denied', error }),
    })
  })
}

function openAppSettings() {
  return new Promise((resolve) => {
    if (!wx.openSetting) {
      resolve({})
      return
    }
    wx.openSetting({
      success: resolve,
      fail: () => resolve({}),
    })
  })
}

function confirmRecordSettings() {
  return new Promise((resolve) => {
    if (!wx.showModal) {
      resolve({ state: 'failed' })
      return
    }
    wx.showModal({
      title: '需要麦克风权限',
      content: '请在设置中允许使用麦克风',
      success: result => resolve({
        state: result && result.confirm ? 'confirmed' : 'denied',
      }),
      fail: error => resolve({ state: 'failed', error }),
    })
  })
}

async function ensureRecordPermission() {
  const authorization = await authorizeRecord()
  if (authorization.state === 'granted') return authorization

  const confirmation = await confirmRecordSettings()
  if (confirmation.state !== 'confirmed') return confirmation

  const settings = await openAppSettings()
  const authSetting = settings.authSetting || {}
  return {
    state: authSetting[RECORD_SCOPE] === true ? 'granted' : 'denied',
  }
}

function resolveNotificationState(settings, templateId) {
  if (!templateId) return 'unconfigured'
  const subscriptions = settings && settings.subscriptionsSetting
  if (subscriptions && subscriptions.mainSwitch === false) return 'blocked'
  const itemSettings = subscriptions && subscriptions.itemSettings
  const value = itemSettings && itemSettings[templateId]
  if (value === 'accept') return 'granted'
  if (value === 'ban') return 'blocked'
  if (value === 'reject') return 'denied'
  return 'initial'
}

async function getPermissionSnapshot() {
  const templateId = getReminderTemplateId()
  const settings = await getSetting()
  const authSetting = settings.authSetting || {}
  return {
    microphone: authSetting[RECORD_SCOPE] === true
      ? 'granted'
      : (authSetting[RECORD_SCOPE] === false ? 'denied' : 'initial'),
    notification: resolveNotificationState(settings, templateId),
    templateConfigured: Boolean(templateId),
  }
}

function requestReminderSubscription() {
  const templateId = getReminderTemplateId()
  if (!templateId) {
    return Promise.resolve({
      state: 'unconfigured',
      templateConfigured: false,
    })
  }
  if (!wx.requestSubscribeMessage) {
    return Promise.resolve({
      state: 'failed',
      templateConfigured: true,
    })
  }
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (result) => {
        const value = result && result[templateId]
        const state = value === 'accept'
          ? 'granted'
          : (value === 'ban' ? 'blocked' : 'denied')
        resolve({ state, templateConfigured: true })
      },
      fail: (error) => resolve({
        state: 'failed',
        templateConfigured: true,
        error,
      }),
    })
  })
}

module.exports = {
  authorizeRecord,
  ensureRecordPermission,
  getPermissionSnapshot,
  getReminderTemplateId,
  openAppSettings,
  requestReminderSubscription,
  resolveNotificationState,
}
