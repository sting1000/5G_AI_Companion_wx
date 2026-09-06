const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('reminders 老人提醒列表', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/reminders/reminders.js')

  function loadPage() {
    jest.resetModules()
    return loadPageModule(pagePath)
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-04T08:00:00'))
  })

  test('按今天、稍后、已完成分组并显示文字状态', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = store.getElderKey()
    store.saveReminder({
      id: 'today',
      title: '吃药',
      scheduleType: 'daily',
      timeOfDay: '09:00',
      status: 'pending',
    }, elderKey)
    store.saveReminder({
      id: 'later',
      title: '医院复查',
      scheduleType: 'once',
      remindDate: '2026-09-10',
      timeOfDay: '10:00',
      status: 'pending',
    }, elderKey)
    store.saveReminder({
      id: 'done',
      title: '测血压',
      scheduleType: 'daily',
      timeOfDay: '07:00',
      status: 'done',
    }, elderKey)
    store.saveReminder({
      id: 'candidate',
      title: '给女儿打电话',
      scheduleType: 'once',
      remindDate: '',
      timeOfDay: '09:00',
      status: 'candidate',
      needsConfirmation: true,
    }, elderKey)

    page._loadReminders()

    expect(page.data.todayReminders.map(item => item.id)).toEqual(['today'])
    expect(page.data.laterReminders.map(item => item.id)).toEqual(['candidate', 'later'])
    expect(page.data.doneReminders.map(item => item.id)).toEqual(['done'])
    expect(page.data.laterReminders.find(item => item.id === 'candidate').statusText).toBe('待确认')
    expect(page.data.laterReminders.find(item => item.id === 'candidate').statusText).not.toBe('已完成')
  })

  test('旧提醒缺少状态与日期时仍兼容为今天待提醒', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = store.getElderKey()
    store.saveReminder({
      id: 'legacy',
      title: '老提醒',
      timeOfDay: '11:30',
    }, elderKey)

    page._loadReminders()

    expect(page.data.todayReminders).toHaveLength(1)
    expect(page.data.todayReminders[0]).toEqual(expect.objectContaining({
      id: 'legacy',
      status: 'pending',
      statusText: '待提醒',
      repeatText: '每天',
    }))
  })

  test('点击整项进入提醒详情', () => {
    const page = loadPage()

    page.onTapReminder({ currentTarget: { dataset: { id: 'rem 1' } } })

    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/reminder-detail/reminder-detail?id=rem%201',
    })
  })

  test('返回使用 navigateBack', () => {
    const page = loadPage()

    page.goBack()

    expect(wx.navigateBack).toHaveBeenCalled()
  })
})
