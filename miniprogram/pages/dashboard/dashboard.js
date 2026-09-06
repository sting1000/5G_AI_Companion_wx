const store = require('../../utils/store')
const permissions = require('../../utils/permissions')

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const SHORT_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function padNumber(value) {
  return String(value).padStart(2, '0')
}

function toDateKey(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`
}

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

function getGreeting(hour) {
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

function getEffectiveDate(reminder, now) {
  return store.getReminderNextDate(reminder, now)
}

function getEffectiveTime(reminder, now) {
  return store.getReminderNextTime(reminder, now)
}

function getReminderTimestamp(reminder, now) {
  const date = getEffectiveDate(reminder, now)
  const time = getEffectiveTime(reminder, now)
  const timestamp = Date.parse(`${date || toDateKey(now)}T${time}:00`)
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER
}

function dateLabel(effectiveDate, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(`${effectiveDate}T00:00:00`)
  if (!Number.isFinite(target.getTime())) return ''
  const days = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
  if (days === 0) return '今天'
  if (days === 1) return '明天'
  return `${target.getMonth() + 1}月${target.getDate()}日`
}

function scheduleLabel(reminder, effectiveDate) {
  if (reminder.snoozedDate && reminder.snoozedDate === effectiveDate) return '已改期'
  if (reminder.scheduleType === 'once') return '单次'
  if (reminder.scheduleType === 'weekly') {
    const days = (reminder.weekdays || [])
      .map(day => SHORT_WEEKDAYS[Number(day)])
      .filter(Boolean)
      .join('、')
    return days ? `每周${days}` : '每周'
  }
  if (reminder.scheduleType === 'monthly') return '每月'
  return '每天'
}

function decorateReminder(reminder, now) {
  const effectiveDate = getEffectiveDate(reminder, now)
  return Object.assign({}, reminder, {
    displayTime: getEffectiveTime(reminder, now),
    scheduleLabel: scheduleLabel(reminder, effectiveDate),
    dateLabel: dateLabel(effectiveDate, now),
    effectiveDate,
    timestamp: getReminderTimestamp(reminder, now),
    statusText: reminder.status === 'candidate'
      ? '待确认'
      : (reminder.status === 'triggered' ? '已提醒' : '待提醒'),
  })
}

function buildDashboardReminders(reminders, now = new Date()) {
  const todayKey = toDateKey(now)
  return (reminders || [])
    .filter(item => item && item.status !== 'done')
    .filter(item => item.status !== 'candidate')
    .map(item => decorateReminder(item, now))
    .filter(item => item.effectiveDate >= todayKey)
    .sort((a, b) => a.timestamp - b.timestamp)
}

Page({
  data: {
    configured: false,
    greetingText: '',
    dateText: '',
    isLoading: true,
    hasLoadError: false,
    loadErrorText: '',
    isOffline: false,
    hasCachedContent: false,
    notificationState: 'initial',
    nextReminder: null,
    otherReminders: [],
    hasMoreToday: false,
    todayReminderCount: 0,
    statusBarHeight: 20,
    navigationBarHeight: 44,
  },

  onLoad() {
    this._isUnloaded = false
    this.setData(getNavigationMetrics())
  },

  onShow() {
    this._isUnloaded = false
    const config = store.getElderConfig()
    if (!config) {
      wx.navigateTo({ url: '/pages/onboarding/onboarding' })
      return
    }
    this.setData({ configured: true })
    this._loadDashboard(config)
    this._refreshNetworkState()
    this._refreshNotificationState()
  },

  onUnload() {
    this._isUnloaded = true
  },

  retryLoad() {
    const config = store.getElderConfig()
    if (!config) {
      wx.navigateTo({ url: '/pages/onboarding/onboarding' })
      return
    }
    this._loadDashboard(config)
    this._refreshNetworkState()
  },

  _loadDashboard(config) {
    this.setData({
      isLoading: true,
      hasLoadError: false,
      loadErrorText: '',
    })
    const now = new Date()
    const address = store.getElderTitle()
      || config.preferredAddress
      || config.parentName
      || '您好'
    this.setData({
      greetingText: `${getGreeting(now.getHours())}，${address}`,
      dateText: `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]}`,
    })

    try {
      const elderKey = store.getElderKey(config)
      const todayReminders = buildDashboardReminders(store.getReminders(elderKey), now)
      this._applyReminderList(todayReminders, now)
    } catch (error) {
      this.setData({
        isLoading: false,
        hasLoadError: true,
        loadErrorText: '今天的提醒暂时没有加载出来',
        nextReminder: null,
        otherReminders: [],
        todayReminderCount: 0,
      })
    }
  },

  _applyReminderList(reminders, now = new Date()) {
    const list = reminders || []
    const todayKey = toDateKey(now)
    const todayReminders = list.filter(item => item.effectiveDate === todayKey)
    const futureReminders = list.filter(item => item.effectiveDate > todayKey)
    const nextReminder = todayReminders[0] || futureReminders[0] || null
    const otherReminders = nextReminder && nextReminder.effectiveDate === todayKey
      ? todayReminders.slice(1)
      : todayReminders
    this.setData({
      isLoading: false,
      hasLoadError: false,
      hasCachedContent: list.length > 0,
      nextReminder,
      otherReminders: otherReminders.slice(0, 2),
      hasMoreToday: otherReminders.length > 2,
      todayReminderCount: todayReminders.length,
    })
  },

  _refreshNetworkState() {
    if (!wx.getNetworkType) return
    wx.getNetworkType({
      success: (result) => {
        if (this._isUnloaded) return
        this.setData({ isOffline: result.networkType === 'none' })
      },
      fail: () => {
        if (this._isUnloaded) return
        this.setData({ isOffline: true })
      },
    })
  },

  async _refreshNotificationState() {
    const snapshot = await permissions.getPermissionSnapshot()
    if (this._isUnloaded) return
    this.setData({ notificationState: snapshot.notification })
  },

  goCall() {
    wx.navigateTo({ url: '/pages/call/call' })
  },

  goRecords() {
    wx.navigateTo({ url: '/pages/records/records' })
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  goReminders() {
    wx.navigateTo({ url: '/pages/reminders/reminders' })
  },

  goReminderDetail(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/reminder-detail/reminder-detail?id=${encodeURIComponent(id)}`,
    })
  },

  async recoverNotification() {
    if (this.data.notificationState === 'blocked') {
      await permissions.openAppSettings()
    } else {
      await permissions.requestReminderSubscription()
    }
    if (this._isUnloaded) return
    await this._refreshNotificationState()
  },
})

module.exports = {
  buildDashboardReminders,
  dateLabel,
  decorateReminder,
  getGreeting,
  toDateKey,
}
