const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('reminders 页面离线关键分支', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/reminders/reminders.js')

  function loadPage() {
    jest.resetModules()
    return loadPageModule(pagePath)
  }

  test('待确认提醒会显示待确认状态，点击状态点后转为待提醒', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = store.getElderKey()
    const reminder = store.saveReminder({
      title: '医院复查',
      scheduleType: 'once',
      remindDate: '2026-04-29',
      timeOfDay: '09:00',
      status: 'candidate',
      needsConfirmation: true,
      missingFields: ['time'],
    }, elderKey)

    page._loadReminders()
    expect(page.data.reminders[0].statusText).toBe('待确认')
    expect(page.data.reminders[0].statusClass).toBe('status-candidate')

    page.onToggleDone({ currentTarget: { dataset: { id: reminder.id } } })

    const current = store.getReminders(elderKey).find(item => item.id === reminder.id)
    expect(current.status).toBe('pending')
    expect(current.needsConfirmation).toBe(false)
  })
})
