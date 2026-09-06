const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('reminder-detail 提醒详情', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/reminder-detail/reminder-detail.js')

  function createStoreMock(reminderOverrides = {}) {
    const reminder = Object.assign({
      id: 'reminder-1',
      title: '吃降压药',
      scheduleType: 'daily',
      timeOfDay: '09:00',
      status: 'pending',
      weekdays: [],
    }, reminderOverrides)
    return {
      getElderKey: jest.fn(() => 'elder:test:0000'),
      getReminderById: jest.fn(() => reminder),
      getReminderNextDate: jest.fn((item) => item.snoozedDate || item.remindDate || '2026-09-04'),
      getReminderNextTime: jest.fn((item) => item.snoozedTime || item.timeOfDay || '09:00'),
      markReminderDone: jest.fn(() => Object.assign({}, reminder, {
        status: 'done',
        completedAt: new Date().toISOString(),
      })),
      snoozeReminder: jest.fn((id, schedule) => Object.assign({}, reminder, {
        status: 'pending',
        snoozedDate: schedule.remindDate,
        snoozedTime: schedule.timeOfDay,
      })),
      deleteReminder: jest.fn(() => true),
    }
  }

  function createPermissionsMock(state = 'granted') {
    return {
      getPermissionSnapshot: jest.fn(() => Promise.resolve({
        microphone: 'granted',
        notification: state,
        templateConfigured: true,
      })),
      openAppSettings: jest.fn(() => Promise.resolve({})),
      requestReminderSubscription: jest.fn(() => Promise.resolve({ state: 'granted' })),
    }
  }

  function loadPage(options = {}) {
    const storeMock = options.storeMock || createStoreMock()
    const permissionsMock = options.permissionsMock || createPermissionsMock()
    jest.resetModules()
    jest.doMock('../../miniprogram/utils/store', () => storeMock)
    jest.doMock('../../miniprogram/utils/permissions', () => permissionsMock)
    const page = loadPageModule(pagePath)
    page.onLoad({ id: 'reminder-1' })
    page.onShow()
    return { page, storeMock, permissionsMock }
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-04T08:00:00'))
  })

  test('展示事项、下一次时间和重复规则', () => {
    const { page } = loadPage()

    expect(page.data.reminder).toEqual(expect.objectContaining({
      title: '吃降压药',
      dateText: '9月4日',
      displayTime: '09:00',
      repeatText: '每天',
      statusText: '待提醒',
    }))
  })

  test('完成提醒后只在真实 store 成功时显示已完成', () => {
    const { page, storeMock } = loadPage()

    page.onComplete()

    expect(storeMock.markReminderDone).toHaveBeenCalledWith('reminder-1', 'elder:test:0000')
    expect(page.data.reminder.statusText).toBe('已完成')
    expect(wx.showToast).toHaveBeenCalledWith({ title: '已完成', icon: 'success' })
  })

  test('candidate 不能被错误标记为已完成', () => {
    const storeMock = createStoreMock({
      status: 'candidate',
      needsConfirmation: true,
    })
    const { page } = loadPage({ storeMock })

    page.onComplete()

    expect(page.data.reminder.statusText).toBe('待确认')
    expect(page.data.reminder.canManage).toBe(false)
    expect(storeMock.markReminderDone).not.toHaveBeenCalled()
  })

  test('稍后提醒必须明确选择未来日期和时间', () => {
    const { page, storeMock } = loadPage()
    page.openSnooze()

    page.confirmSnooze()
    expect(page.data.snoozeError).toBe('请明确选择新的日期和时间')
    expect(storeMock.snoozeReminder).not.toHaveBeenCalled()

    page.onSnoozeDateChange({ detail: { value: '2026-09-05' } })
    page.onSnoozeTimeChange({ detail: { value: '10:30' } })
    page.confirmSnooze()

    expect(storeMock.snoozeReminder).toHaveBeenCalledWith(
      'reminder-1',
      { remindDate: '2026-09-05', timeOfDay: '10:30' },
      'elder:test:0000'
    )
    expect(page.data.reminder).toEqual(expect.objectContaining({
      dateText: '9月5日',
      displayTime: '10:30',
    }))
  })

  test('删除提醒必须二次确认', () => {
    const { page, storeMock } = loadPage()
    wx.showModal.mockImplementationOnce(({ success }) => success({ confirm: false }))

    page.onDelete()
    expect(storeMock.deleteReminder).not.toHaveBeenCalled()

    wx.showModal.mockImplementationOnce(({ success }) => success({ confirm: true }))
    page.onDelete()

    expect(storeMock.deleteReminder).toHaveBeenCalledWith('reminder-1', 'elder:test:0000')
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('通知未开启时去设置并刷新状态', async () => {
    const permissionsMock = createPermissionsMock('blocked')
    permissionsMock.getPermissionSnapshot
      .mockResolvedValueOnce({
        microphone: 'granted',
        notification: 'blocked',
        templateConfigured: true,
      })
      .mockResolvedValueOnce({
        microphone: 'granted',
        notification: 'granted',
        templateConfigured: true,
      })
    const { page } = loadPage({ permissionsMock })
    await Promise.resolve()
    expect(page.data.notificationState).toBe('blocked')

    await page.recoverNotification()

    expect(permissionsMock.openAppSettings).toHaveBeenCalled()
    expect(page.data.notificationState).toBe('granted')
  })
})
