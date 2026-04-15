const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('dashboard 页面离线流程', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/dashboard/dashboard.js')

  function createStoreMock(overrides = {}) {
    return Object.assign({
      getElderConfig: jest.fn(() => ({
        parentName: '王阿姨',
        phone: '13800138000',
      })),
      getCallHistory: jest.fn(() => []),
      getProfile: jest.fn(() => ({ hobbies: [] })),
      getElderKey: jest.fn(() => 'elder:wangayi:0000'),
      pickNextIncomingReminder: jest.fn(() => null),
    }, overrides)
  }

  function loadPageWithStore(storeMock) {
    jest.resetModules()
    jest.doMock('../../miniprogram/utils/store', () => storeMock)
    return loadPageModule(pagePath)
  }

  test('未配置时 onShow 会跳 onboarding', () => {
    const storeMock = createStoreMock({
      getElderConfig: jest.fn(() => null),
    })
    const page = loadPageWithStore(storeMock)

    page.onShow()
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/onboarding/onboarding',
    })
  })

  test('有历史记录时会展示最近通话信息', () => {
    const storeMock = createStoreMock({
      getCallHistory: jest.fn(() => [{
        id: 'call_1',
        date: '2026-04-15 10:00',
        mood: '🙂',
        moodLabel: '平静',
      }]),
      getProfile: jest.fn(() => ({
        hobbies: ['太极', '书法'],
      })),
    })
    const page = loadPageWithStore(storeMock)

    page.onShow()
    expect(page.data.configured).toBe(true)
    expect(page.data.hasCallHistory).toBe(true)
    expect(page.data.totalCalls).toBe(1)
    expect(page.data.totalDurationText).toBe('0秒')
    expect(page.data.hasSignal).toBe(true)
    expect(page.data.interestTags).toEqual(['太极', '书法'])
    expect(page.data.hasHealthSignal).toBe(false)
  })

  test('goSimulatedIncoming 会拼接 reminder query', () => {
    const storeMock = createStoreMock({
      pickNextIncomingReminder: jest.fn(() => ({
        id: 'rem_1',
        title: '记得吃药',
      })),
    })
    const page = loadPageWithStore(storeMock)

    page.goSimulatedIncoming()
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/call/call?mode=incoming&triggerSource=manual&reminderId=rem_1&reminderText=%E8%AE%B0%E5%BE%97%E5%90%83%E8%8D%AF',
    })
  })
})
