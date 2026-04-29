const store = require('../../utils/store')
const QUICK_PREFS_KEY = 'reminderQuickPrefs'
const SWIPE_ACTION_WIDTH = 140

Page({
  data: {
    reminders: [],
    showEditor: false,
    editingId: '',
    titleInput: '',
    scheduleType: 'daily',
    timeOfDay: '09:00',
    remindDate: '',
    scheduleOptions: [
      { id: 'daily', label: '每天' },
      { id: 'weekly', label: '每周' },
      { id: 'monthly', label: '每月' },
      { id: 'once', label: '单次' },
    ],
  },

  onLoad() {
    this._loadQuickPrefs()
  },

  onShow() {
    this._loadReminders()
  },

  _loadQuickPrefs() {
    const prefs = wx.getStorageSync(QUICK_PREFS_KEY) || {}
    const scheduleType = prefs.scheduleType || 'daily'
    const timeOfDay = prefs.timeOfDay || '09:00'
    this.setData({ scheduleType, timeOfDay })
  },

  _loadReminders() {
    const elderKey = store.getElderKey()
    const list = store.getReminders(elderKey).map(item => Object.assign({}, item, {
      statusText: this._statusText(item.status),
      statusClass: this._statusClass(item.status),
      statusIcon: this._statusIcon(item.status),
      scheduleText: this._scheduleText(item),
      swipeX: 0,
    }))
    this.setData({ reminders: list })
  },

  _statusText(status) {
    if (status === 'candidate') return '待确认'
    if (status === 'done') return '已完成'
    if (status === 'triggered') return '已触发'
    return '待提醒'
  },

  _statusClass(status) {
    if (status === 'candidate') return 'status-candidate'
    if (status === 'done') return 'status-done'
    if (status === 'triggered') return 'status-triggered'
    return 'status-pending'
  },

  _statusIcon(status) {
    if (status === 'candidate') return '?'
    if (status === 'done') return '✓'
    if (status === 'triggered') return '↗'
    return ''
  },

  _scheduleText(item) {
    if (item.scheduleType === 'once') {
      return `${item.remindDate || '未设日期'} ${item.timeOfDay || '09:00'}`
    }
    if (item.scheduleType === 'weekly') {
      const weekdayMap = ['日', '一', '二', '三', '四', '五', '六']
      const weekdays = Array.isArray(item.weekdays) && item.weekdays.length > 0
        ? item.weekdays.map(day => weekdayMap[Number(day)]).filter(Boolean).join('、')
        : ''
      return `每周${weekdays || ''} ${item.timeOfDay || '09:00'}`
    }
    if (item.scheduleType === 'monthly') return `每月 ${item.timeOfDay || '09:00'}`
    return `每天 ${item.timeOfDay || '09:00'}`
  },

  onOpenCreate() {
    const prefs = wx.getStorageSync(QUICK_PREFS_KEY) || {}
    this.setData({
      showEditor: true,
      editingId: '',
      titleInput: '',
      scheduleType: prefs.scheduleType || 'daily',
      timeOfDay: prefs.timeOfDay || '09:00',
      remindDate: '',
    })
  },

  onCloseEditor() {
    this.setData({ showEditor: false })
  },

  onEditorTap() {
    // 阻止点击编辑面板内容时触发遮罩关闭
  },

  onEditReminder(e) {
    const id = e.currentTarget.dataset.id
    const reminder = this.data.reminders.find(item => item.id === id)
    if (!reminder) return
    this.setData({
      showEditor: true,
      editingId: id,
      titleInput: reminder.title || '',
      scheduleType: reminder.scheduleType || 'daily',
      timeOfDay: reminder.timeOfDay || '09:00',
      remindDate: reminder.remindDate || '',
    })
  },

  onTapReminder(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const reminder = this.data.reminders.find(item => item.id === id)
    if (!reminder) return
    if (reminder.swipeX !== 0) {
      this._setSwipeX(id, 0)
      return
    }
    this.onEditReminder({ currentTarget: { dataset: { id } } })
  },

  onTitleInput(e) {
    this.setData({ titleInput: e.detail.value })
  },

  onTitleConfirm() {
    if (!this.data.showEditor) return
    this.onSaveReminder()
  },

  onPickTime(e) {
    this.setData({ timeOfDay: e.detail.value })
  },

  onPickDate(e) {
    this.setData({ remindDate: e.detail.value })
  },

  onPickSchedule(e) {
    const scheduleType = e.currentTarget.dataset.type
    if (!scheduleType) return
    this.setData({ scheduleType })
  },

  onSaveReminder() {
    const title = String(this.data.titleInput || '').trim()
    if (!title) {
      wx.showToast({ title: '请输入提醒内容', icon: 'none' })
      return
    }

    const elderKey = store.getElderKey()
    const payload = {
      title,
      scheduleType: this.data.scheduleType,
      timeOfDay: this.data.timeOfDay || '09:00',
      remindDate: this.data.scheduleType === 'once' ? (this.data.remindDate || '') : '',
      source: 'manual',
    }

    if (this.data.editingId) {
      store.updateReminder(this.data.editingId, payload, elderKey)
    } else {
      store.saveReminder(payload, elderKey)
    }
    wx.setStorageSync(QUICK_PREFS_KEY, {
      scheduleType: this.data.scheduleType,
      timeOfDay: this.data.timeOfDay || '09:00',
    })

    this.setData({ showEditor: false })
    this._loadReminders()
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  onDeleteReminder(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    store.deleteReminder(id, store.getElderKey())
    this._loadReminders()
    wx.showToast({ title: '已删除', icon: 'none' })
  },

  onToggleDone(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const elderKey = store.getElderKey()
    const reminder = this.data.reminders.find(item => item.id === id)
    if (!reminder) return

    if (reminder.status === 'candidate') {
      store.updateReminder(id, {
        status: 'pending',
        needsConfirmation: false,
        missingFields: [],
      }, elderKey)
      wx.showToast({ title: '已确认提醒', icon: 'success' })
    } else if (reminder.status === 'done') {
      store.updateReminder(id, {
        status: 'pending',
        completedAt: '',
      }, elderKey)
      wx.showToast({ title: '已恢复待提醒', icon: 'none' })
    } else {
      store.markReminderDone(id, elderKey)
      wx.showToast({ title: '已标记完成', icon: 'none' })
    }
    this._loadReminders()
  },

  onTriggerIncoming(e) {
    const id = e.currentTarget.dataset.id
    const reminder = this.data.reminders.find(item => item.id === id)
    if (!reminder) return
    if (reminder.status === 'candidate') {
      wx.showToast({ title: '请先确认提醒', icon: 'none' })
      return
    }
    const title = encodeURIComponent(reminder.title || '')
    wx.navigateTo({
      url: `/pages/call/call?mode=incoming&reminderId=${reminder.id}&reminderText=${title}&triggerSource=manual`,
    })
  },

  onItemTouchStart(e) {
    this._touchStartX = e.touches[0].clientX
    this._touchingId = e.currentTarget.dataset.id
  },

  onItemTouchMove(e) {
    const id = e.currentTarget.dataset.id
    if (!id || id !== this._touchingId) return
    const moveX = e.touches[0].clientX
    const deltaX = moveX - this._touchStartX
    const swipeX = Math.max(-SWIPE_ACTION_WIDTH, Math.min(SWIPE_ACTION_WIDTH, deltaX))
    this._setSwipeX(id, swipeX)
  },

  onItemTouchEnd(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const item = this.data.reminders.find(row => row.id === id)
    if (!item) return
    let targetSwipeX = 0
    if (item.swipeX <= -70) {
      targetSwipeX = -SWIPE_ACTION_WIDTH
    } else if (item.swipeX >= 70) {
      targetSwipeX = SWIPE_ACTION_WIDTH
    }
    this._setSwipeX(id, targetSwipeX)
    this._touchingId = ''
  },

  _setSwipeX(id, swipeX) {
    const next = (this.data.reminders || []).map(item => {
      if (item.id === id) return Object.assign({}, item, { swipeX })
      if (swipeX !== 0) return Object.assign({}, item, { swipeX: 0 })
      return item
    })
    this.setData({ reminders: next })
  },
})
