const store = require('../../utils/store')
const permissions = require('../../utils/permissions')

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function getRepeatText(reminder) {
  if (reminder.scheduleType === 'once') return '不重复'
  if (reminder.scheduleType === 'weekly') {
    const days = (reminder.weekdays || [])
      .map(day => WEEKDAYS[Number(day)])
      .filter(Boolean)
      .join('、')
    return days ? `每周${days}` : '每周'
  }
  if (reminder.scheduleType === 'monthly') return '每月'
  return '每天'
}

function formatDate(dateText) {
  const match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return '日期待确认'
  return `${Number(match[2])}月${Number(match[3])}日`
}

function decorateReminder(reminder) {
  if (!reminder) return null
  const now = new Date()
  const date = store.getReminderNextDate(reminder, now)
  const time = store.getReminderNextTime(reminder, now)
  const statusText = reminder.status === 'candidate'
    ? '待确认'
    : (reminder.status === 'done'
      ? '已完成'
      : (reminder.status === 'triggered' ? '已提醒' : '待提醒'))
  return Object.assign({}, reminder, {
    dateText: formatDate(date),
    displayTime: time,
    repeatText: getRepeatText(reminder),
    statusText,
    canManage: reminder.status !== 'candidate',
    isDone: reminder.status === 'done',
  })
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
    reminder: null,
    isLoading: true,
    hasError: false,
    errorText: '',
    notFound: false,
    isSubmitting: false,
    showSnooze: false,
    snoozeDate: '',
    snoozeTime: '',
    snoozeError: '',
    notificationState: 'initial',
    isOffline: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
  },

  onLoad(options) {
    this.reminderId = options && options.id ? decodeURIComponent(options.id) : ''
    this._isUnloaded = false
    this.setData(getNavigationMetrics())
  },

  onShow() {
    this._isUnloaded = false
    this._loadReminder()
    this._refreshNotificationState()
    this._refreshNetworkState()
  },

  onUnload() {
    this._isUnloaded = true
  },

  _loadReminder() {
    this.setData({ isLoading: true, hasError: false, errorText: '' })
    try {
      const reminder = store.getReminderById(this.reminderId, store.getElderKey())
      this.setData({
        reminder: decorateReminder(reminder),
        notFound: !reminder,
        isLoading: false,
      })
    } catch (error) {
      this.setData({
        reminder: null,
        notFound: false,
        isLoading: false,
        hasError: true,
        errorText: '提醒详情暂时没有加载出来',
      })
    }
  },

  goBack() {
    wx.navigateBack()
  },

  onComplete() {
    if (this.data.isSubmitting || !this.data.reminder || !this.data.reminder.canManage) return
    this.setData({ isSubmitting: true })
    const updated = store.markReminderDone(this.reminderId, store.getElderKey())
    if (!updated) {
      this.setData({ isSubmitting: false })
      wx.showToast({ title: '没有更新成功，请再试一次', icon: 'none' })
      return
    }
    this.setData({
      isSubmitting: false,
      reminder: decorateReminder(updated),
    })
    wx.showToast({ title: '已完成', icon: 'success' })
  },

  openSnooze() {
    if (!this.data.reminder || !this.data.reminder.canManage) return
    this.setData({
      showSnooze: true,
      snoozeDate: '',
      snoozeTime: '',
      snoozeError: '',
    })
  },

  closeSnooze() {
    if (this.data.isSubmitting) return
    this.setData({ showSnooze: false, snoozeError: '' })
  },

  onSnoozePanelTap() {},

  onSnoozeDateChange(event) {
    this.setData({ snoozeDate: event.detail.value, snoozeError: '' })
  },

  onSnoozeTimeChange(event) {
    this.setData({ snoozeTime: event.detail.value, snoozeError: '' })
  },

  confirmSnooze() {
    if (this.data.isSubmitting) return
    if (!this.data.snoozeDate || !this.data.snoozeTime) {
      this.setData({ snoozeError: '请明确选择新的日期和时间' })
      return
    }
    const nextTimestamp = Date.parse(`${this.data.snoozeDate}T${this.data.snoozeTime}:00`)
    if (!Number.isFinite(nextTimestamp) || nextTimestamp <= Date.now()) {
      this.setData({ snoozeError: '请选择现在之后的时间' })
      return
    }
    this.setData({ isSubmitting: true, snoozeError: '' })
    const updated = store.snoozeReminder(this.reminderId, {
      remindDate: this.data.snoozeDate,
      timeOfDay: this.data.snoozeTime,
    }, store.getElderKey())
    if (!updated) {
      this.setData({
        isSubmitting: false,
        snoozeError: '没有更新成功，请再试一次',
      })
      return
    }
    this.setData({
      isSubmitting: false,
      showSnooze: false,
      reminder: decorateReminder(updated),
    })
    wx.showToast({ title: '已改到新时间', icon: 'success' })
  },

  onDelete() {
    if (!this.data.reminder || this.data.isSubmitting) return
    wx.showModal({
      title: '删除这条提醒？',
      content: '删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#C83F3F',
      cancelText: '取消',
      success: (result) => {
        if (!result.confirm) return
        const deleted = store.deleteReminder(this.reminderId, store.getElderKey())
        if (!deleted) {
          wx.showToast({ title: '没有删除成功，请再试一次', icon: 'none' })
          return
        }
        wx.showToast({ title: '已删除', icon: 'none' })
        wx.navigateBack()
      },
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

  async _refreshNotificationState() {
    const snapshot = await permissions.getPermissionSnapshot()
    if (this._isUnloaded) return
    this.setData({ notificationState: snapshot.notification })
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

  retryLoad() {
    this._loadReminder()
    this._refreshNetworkState()
  },
})

module.exports = {
  decorateReminder,
  formatDate,
  getRepeatText,
}
