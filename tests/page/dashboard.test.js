const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('dashboard 老人首页', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/dashboard/dashboard.js')

  function createStoreMock(overrides = {}) {
    const config = {
      parentName: '王秀兰',
      preferredAddress: '李叔叔',
      phone: '13800138000',
    }
    return Object.assign({
      getElderConfig: jest.fn(() => config),
      getElderTitle: jest.fn(() => config.preferredAddress),
      getElderKey: jest.fn(() => 'elder:wang:0000'),
      getReminders: jest.fn(() => []),
      getReminderNextDate: jest.fn((reminder, now) => {
        if (reminder.snoozedDate) return reminder.snoozedDate
        if (reminder.scheduleType === 'once') return reminder.remindDate || ''
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }),
      getReminderNextTime: jest.fn((reminder) => reminder.snoozedTime || reminder.timeOfDay || '09:00'),
    }, overrides)
  }

  function createPermissionsMock(state = 'granted') {
    return {
      getPermissionSnapshot: jest.fn(() => Promise.resolve({
        microphone: 'granted',
        notification: state,
        templateConfigured: state !== 'unconfigured',
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
    return {
      page: loadPageModule(pagePath),
      storeMock,
      permissionsMock,
    }
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-04T08:10:00'))
  })

  test('动态显示称呼、问候和日期', () => {
    const { page } = loadPage()

    page.onShow()

    expect(page.data.greetingText).toBe('早上好，李叔叔')
    expect(page.data.dateText).toBe('9月4日 星期五')
    expect(page.data.greetingText).not.toContain('王阿姨')
  })

  test('下一件事按时间排序，今天其余最多显示两条', () => {
    const reminders = [
      { id: 'r4', title: '给女儿打电话', scheduleType: 'daily', timeOfDay: '20:30', status: 'pending' },
      { id: 'r2', title: '吃早餐', scheduleType: 'daily', timeOfDay: '09:00', status: 'pending' },
      { id: 'r1', title: '测血压', scheduleType: 'daily', timeOfDay: '08:30', status: 'pending' },
      { id: 'r3', title: '散步', scheduleType: 'daily', timeOfDay: '15:00', status: 'pending' },
      { id: 'candidate', title: '时间待确认', scheduleType: 'daily', timeOfDay: '10:00', status: 'candidate' },
      { id: 'done', title: '已完成事项', scheduleType: 'daily', timeOfDay: '07:00', status: 'done' },
    ]
    const storeMock = createStoreMock({
      getReminders: jest.fn(() => reminders),
    })
    const { page } = loadPage({ storeMock })

    page.onShow()

    expect(page.data.nextReminder.id).toBe('r1')
    expect(page.data.otherReminders.map(item => item.id)).toEqual(['r2', 'r3'])
    expect(page.data.otherReminders).toHaveLength(2)
    expect(page.data.todayReminderCount).toBe(4)
    expect(page.data.hasMoreToday).toBe(true)
  })

  test('没有提醒时显示空状态数据', () => {
    const { page } = loadPage()

    page.onShow()

    expect(page.data.isLoading).toBe(false)
    expect(page.data.nextReminder).toBeNull()
    expect(page.data.otherReminders).toEqual([])
    expect(page.data.todayReminderCount).toBe(0)
  })

  test('今天无事项时，下一件事展示最近的未来提醒', () => {
    const reminders = [
      {
        id: 'tomorrow-medicine',
        title: '吃药',
        scheduleType: 'once',
        remindDate: '2026-09-05',
        timeOfDay: '09:00',
        status: 'pending',
      },
      {
        id: 'later-checkup',
        title: '医院复查',
        scheduleType: 'once',
        remindDate: '2026-09-10',
        timeOfDay: '10:00',
        status: 'pending',
      },
    ]
    const storeMock = createStoreMock({
      getReminders: jest.fn(() => reminders),
    })
    const { page } = loadPage({ storeMock })

    page.onShow()

    expect(page.data.nextReminder).toEqual(expect.objectContaining({
      id: 'tomorrow-medicine',
      title: '吃药',
      dateLabel: '明天',
    }))
    expect(page.data.otherReminders).toEqual([])
    expect(page.data.todayReminderCount).toBe(0)
  })

  test('提醒读取失败且无缓存时提供失败状态', () => {
    const storeMock = createStoreMock({
      getReminders: jest.fn(() => {
        throw new Error('storage unavailable')
      }),
    })
    const { page } = loadPage({ storeMock })

    page.onShow()

    expect(page.data.isLoading).toBe(false)
    expect(page.data.hasLoadError).toBe(true)
    expect(page.data.loadErrorText).toContain('没有加载出来')
  })

  test('离线时保留本地提醒并显示离线状态', () => {
    wx.getNetworkType.mockImplementationOnce(({ success }) => success({ networkType: 'none' }))
    const storeMock = createStoreMock({
      getReminders: jest.fn(() => [
        { id: 'r1', title: '吃药', scheduleType: 'daily', timeOfDay: '09:00', status: 'pending' },
      ]),
    })
    const { page } = loadPage({ storeMock })

    page.onShow()

    expect(page.data.isOffline).toBe(true)
    expect(page.data.hasCachedContent).toBe(true)
    expect(page.data.nextReminder.title).toBe('吃药')
  })

  test('通知未开启状态可通过真实设置入口恢复', async () => {
    const permissionsMock = createPermissionsMock('denied')
    permissionsMock.getPermissionSnapshot
      .mockResolvedValueOnce({
        microphone: 'granted',
        notification: 'denied',
        templateConfigured: true,
      })
      .mockResolvedValueOnce({
        microphone: 'granted',
        notification: 'granted',
        templateConfigured: true,
      })
    const { page } = loadPage({ permissionsMock })
    page.onShow()
    await Promise.resolve()

    expect(page.data.notificationState).toBe('denied')
    await page.recoverNotification()

    expect(permissionsMock.requestReminderSubscription).toHaveBeenCalled()
    expect(page.data.notificationState).toBe('granted')
  })

  test('未配置时进入 onboarding', () => {
    const storeMock = createStoreMock({
      getElderConfig: jest.fn(() => null),
    })
    const { page } = loadPage({ storeMock })

    page.onShow()

    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/onboarding/onboarding',
    })
  })

  test('call、records、settings、reminders 均使用无 TabBar 路由', () => {
    const { page } = loadPage()

    page.goCall()
    page.goRecords()
    page.goSettings()
    page.goReminders()

    expect(wx.navigateTo.mock.calls.map(call => call[0].url)).toEqual([
      '/pages/call/call',
      '/pages/records/records',
      '/pages/settings/settings',
      '/pages/reminders/reminders',
    ])
    expect(wx.switchTab).not.toHaveBeenCalled()
  })

  test('提醒卡进入详情页', () => {
    const { page } = loadPage()

    page.goReminderDetail({ currentTarget: { dataset: { id: 'reminder 1' } } })

    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/reminder-detail/reminder-detail?id=reminder%201',
    })
  })
})
