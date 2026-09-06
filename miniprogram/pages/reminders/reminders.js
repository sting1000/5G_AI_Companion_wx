const store = require('../../utils/store')

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function padNumber(value) {
  return String(value).padStart(2, '0')
}

function toDateKey(date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`
}

function getEffectiveDate(reminder, now) {
  return store.getReminderNextDate(reminder, now)
}

function getRepeatText(item) {
  if (item.scheduleType === 'once') return '单次提醒'
  if (item.scheduleType === 'weekly') {
    const days = (item.weekdays || [])
      .map(day => WEEKDAYS[Number(day)])
      .filter(Boolean)
      .join('、')
    return days ? `每周${days}` : '每周'
  }
  if (item.scheduleType === 'monthly') return '每月'
  return '每天'
}

function decorateReminder(item, now) {
  const effectiveDate = getEffectiveDate(item, now)
  const time = store.getReminderNextTime(item, now)
  const timestamp = Date.parse(`${effectiveDate || toDateKey(now)}T${time}:00`)
  const statusText = item.status === 'candidate'
    ? '待确认'
    : (item.status === 'done'
      ? '已完成'
      : (item.status === 'triggered' ? '已提醒' : '待提醒'))
  return Object.assign({}, item, {
    displayTime: time,
    effectiveDate,
    repeatText: getRepeatText(item),
    statusText,
    statusClass: `status-${item.status || 'pending'}`,
    timestamp: Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER,
  })
}

function groupReminders(reminders, now = new Date()) {
  const todayKey = toDateKey(now)
  const groups = {
    today: [],
    later: [],
    done: [],
  }
  ;(reminders || []).forEach((raw) => {
    const item = decorateReminder(raw, now)
    if (item.status === 'done') {
      groups.done.push(item)
    } else if (item.status === 'candidate' || item.effectiveDate !== todayKey) {
      groups.later.push(item)
    } else {
      groups.today.push(item)
    }
  })
  groups.today.sort((a, b) => a.timestamp - b.timestamp)
  groups.later.sort((a, b) => {
    if (a.status === 'candidate' && b.status !== 'candidate') return -1
    if (a.status !== 'candidate' && b.status === 'candidate') return 1
    return a.timestamp - b.timestamp
  })
  groups.done.sort((a, b) => Date.parse(b.completedAt || b.updatedAt || '') - Date.parse(a.completedAt || a.updatedAt || ''))
  return groups
}

function getNavigationMetrics() {
  let statusBarHeight = 20
  let navigationBarHeight = 44
  try {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : {}
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

Page({
  data: {
    todayReminders: [],
    laterReminders: [],
    doneReminders: [],
    reminderCount: 0,
    isLoading: true,
    hasError: false,
    errorText: '',
    isOffline: false,
    hasCachedContent: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
  },

  onLoad() {
    this.setData(getNavigationMetrics())
  },

  onShow() {
    this._loadReminders()
    this._refreshNetworkState()
  },

  retryLoad() {
    this._loadReminders()
  },

  _loadReminders() {
    this.setData({ isLoading: true, hasError: false, errorText: '' })
    try {
      const groups = groupReminders(store.getReminders(store.getElderKey()), new Date())
      const reminderCount = groups.today.length + groups.later.length + groups.done.length
      this.setData({
        todayReminders: groups.today,
        laterReminders: groups.later,
        doneReminders: groups.done,
        reminderCount,
        isLoading: false,
        hasCachedContent: reminderCount > 0,
      })
    } catch (error) {
      this.setData({
        isLoading: false,
        hasError: true,
        errorText: '提醒暂时没有加载出来',
      })
    }
  },

  _refreshNetworkState() {
    if (!wx.getNetworkType) return
    wx.getNetworkType({
      success: (result) => {
        this.setData({ isOffline: result.networkType === 'none' })
      },
      fail: () => this.setData({ isOffline: true }),
    })
  },

  goBack() {
    wx.navigateBack()
  },

  onTapReminder(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/reminder-detail/reminder-detail?id=${encodeURIComponent(id)}`,
    })
  },
})

module.exports = {
  decorateReminder,
  groupReminders,
  toDateKey,
}
