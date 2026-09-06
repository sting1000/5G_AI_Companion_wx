const store = require('../../utils/store')

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

function parseReminderIds(rawValue) {
  if (!rawValue) return []
  let value = String(rawValue)
  try {
    value = decodeURIComponent(value)
  } catch (err) {}
  return Array.from(new Set(value.split(',').map(item => item.trim()).filter(Boolean))).slice(0, 5)
}

function formatDuration(durationSeconds) {
  const seconds = Math.max(0, Number(durationSeconds) || 0)
  if (seconds < 60) return '和小林聊了不到 1 分钟'
  return `和小林聊了 ${Math.floor(seconds / 60)} 分钟`
}

function formatReminderSchedule(reminder) {
  const item = reminder || {}
  const time = String(store.getReminderNextTime(item, new Date()) || '').trim()
  const scheduleType = String(item.scheduleType || '')
  if (scheduleType === 'daily') return time ? `每天 ${time}` : '每天'
  if (scheduleType === 'weekly') return time ? `每周 ${time}` : '每周'
  if (scheduleType === 'monthly') return time ? `每月 ${time}` : '每月'

  const date = String(store.getReminderNextDate(item, new Date()) || '').trim()
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  let dateText = date
  if (date === todayKey) dateText = '今天'
  else if (date === tomorrowKey) dateText = '明天'
  else if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parts = date.split('-')
    dateText = `${Number(parts[1])}月${Number(parts[2])}日`
  }
  return [dateText, time].filter(Boolean).join(' ')
}

Page({
  data: {
    durationText: '和小林聊了不到 1 分钟',
    reminders: [],
    hasReminders: false,
    recordId: '',
    canViewRecord: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
  },

  onLoad(options) {
    const params = options || {}
    const recordId = String(params.recordId || '')
    const reminderIds = parseReminderIds(params.reminderIds)
    const reminderMap = {}
    const allReminders = reminderIds.length > 0 ? store.getReminders() : []
    allReminders.forEach((reminder) => {
      reminderMap[reminder.id] = reminder
    })
    const reminders = reminderIds
      .map(reminderId => reminderMap[reminderId])
      .filter(reminder => reminder && reminder.title)
      .map(reminder => ({
        reminderId: reminder.id,
        title: reminder.title,
        scheduleText: formatReminderSchedule(reminder),
      }))
    const savedRecord = recordId
      ? store.getCallHistory().find(item => {
        return item
          && item.id === recordId
          && Array.isArray(item.messages)
          && item.messages.length > 0
      })
      : null
    this.setData(Object.assign({}, getNavigationMetrics(), {
      durationText: formatDuration(params.durationSeconds),
      reminders,
      hasReminders: reminders.length > 0,
      recordId: savedRecord ? recordId : '',
      canViewRecord: Boolean(savedRecord),
    }))
  },

  viewCallRecord() {
    if (!this.data.canViewRecord || !this.data.recordId) return
    wx.navigateTo({
      url: `/pages/summary/summary?id=${encodeURIComponent(this.data.recordId)}`,
    })
  },

  backToToday() {
    wx.reLaunch({
      url: '/pages/dashboard/dashboard?refresh=reminders',
    })
  },
})

module.exports = {
  formatDuration,
  formatReminderSchedule,
  parseReminderIds,
}
