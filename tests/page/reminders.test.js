const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('reminders 页面离线关键分支', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/reminders/reminders.js')

  function loadPage() {
    jest.resetModules()
    return loadPageModule(pagePath)
  }

  function createCandidateReminder(store, elderKey, overrides = {}) {
    return store.saveReminder(Object.assign({
      title: '医院复查',
      scheduleType: 'once',
      remindDate: '2026-04-29',
      timeOfDay: '09:00',
      status: 'candidate',
      needsConfirmation: true,
      missingFields: ['time'],
    }, overrides), elderKey)
  }

  test('待确认提醒会显示待确认状态，点击显式确认后转为待提醒', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = store.getElderKey()
    const reminder = createCandidateReminder(store, elderKey)

    page._loadReminders()
    expect(page.data.reminders[0].statusText).toBe('待确认')
    expect(page.data.reminders[0].statusClass).toBe('status-candidate')
    expect(page.data.reminders[0].isCandidate).toBe(true)

    page.onConfirmCandidate({ currentTarget: { dataset: { id: reminder.id } } })

    const current = store.getReminders(elderKey).find(item => item.id === reminder.id)
    expect(current.status).toBe('pending')
    expect(current.needsConfirmation).toBe(false)
    expect(current.missingFields).toEqual([])
    expect(wx.showToast).toHaveBeenCalledWith({ title: '已确认提醒', icon: 'success' })
  })

  test('待确认提醒点击状态点也复用确认逻辑', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = store.getElderKey()
    const reminder = createCandidateReminder(store, elderKey)

    page._loadReminders()
    page.onToggleDone({ currentTarget: { dataset: { id: reminder.id } } })

    const current = store.getReminders(elderKey).find(item => item.id === reminder.id)
    expect(current.status).toBe('pending')
    expect(current.needsConfirmation).toBe(false)
    expect(current.missingFields).toEqual([])
  })

  test('编辑待确认提醒并保存后会转为待提醒', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = store.getElderKey()
    const reminder = createCandidateReminder(store, elderKey, {
      title: '去医院复查',
    })

    page._loadReminders()
    page.onEditReminder({ currentTarget: { dataset: { id: reminder.id } } })
    page.onTitleInput({ detail: { value: '医院复查膝盖' } })
    page.onSaveReminder()

    const current = store.getReminders(elderKey).find(item => item.id === reminder.id)
    expect(current.title).toBe('医院复查膝盖')
    expect(current.status).toBe('pending')
    expect(current.needsConfirmation).toBe(false)
    expect(current.missingFields).toEqual([])
  })

  test('待确认提醒不能直接触发呼入', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = store.getElderKey()
    const reminder = createCandidateReminder(store, elderKey)

    page._loadReminders()
    page.onTriggerIncoming({ currentTarget: { dataset: { id: reminder.id } } })

    expect(wx.navigateTo).not.toHaveBeenCalled()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '请先确认提醒', icon: 'none' })
  })
})
