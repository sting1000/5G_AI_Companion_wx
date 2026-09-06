const fs = require('fs')
const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('call-ended 页面', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/call-ended/call-ended.js')

  function loadPage() {
    jest.resetModules()
    return loadPageModule(pagePath)
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
  })

  test('展示真实分钟数和本次成功提醒', () => {
    const store = require('../../miniprogram/utils/store')
    const reminder = store.saveReminder({
      title: '吃降压药',
      scheduleType: 'once',
      remindDate: '2026-04-16',
      timeOfDay: '09:00',
    }, store.getElderKey())
    const page = loadPage()

    page.onLoad({ durationSeconds: '492', reminderIds: reminder.id })

    expect(page.data.durationText).toBe('和小林聊了 8 分钟')
    expect(page.data.hasReminders).toBe(true)
    expect(page.data.reminders[0]).toEqual({
      reminderId: reminder.id,
      title: '吃降压药',
      scheduleText: '明天 09:00',
    })
  })

  test('无 recordId 时不显示查看通话内容', () => {
    const page = loadPage()

    page.onLoad({ durationSeconds: '20', recordId: '' })

    expect(page.data.durationText).toBe('和小林聊了不到 1 分钟')
    expect(page.data.canViewRecord).toBe(false)
    page.viewCallRecord()
    expect(wx.navigateTo).not.toHaveBeenCalled()
  })

  test('recordId 对应真实字幕记录时才能查看通话内容', () => {
    const store = require('../../miniprogram/utils/store')
    store.addCallRecord({
      id: 'call_saved_1',
      messages: [{ role: 'user', content: '您好' }],
    })
    const page = loadPage()

    page.onLoad({ recordId: 'call_saved_1', durationSeconds: '60' })
    page.viewCallRecord()

    expect(page.data.canViewRecord).toBe(true)
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/summary/summary?id=call_saved_1',
    })
  })

  test('回到今天会重建首页并触发提醒刷新', () => {
    const page = loadPage()

    page.backToToday()

    expect(wx.reLaunch).toHaveBeenCalledWith({
      url: '/pages/dashboard/dashboard?refresh=reminders',
    })
  })

  test('结束页不包含被禁止的信息分析或承诺', () => {
    const wxml = fs.readFileSync(
      path.resolve(__dirname, '../../miniprogram/pages/call-ended/call-ended.wxml'),
      'utf8'
    )
    expect(wxml).toContain('通话结束')
    expect(wxml).toContain('回到今天')
    expect(wxml).not.toMatch(/情绪|兴趣|健康信号|重点关注|已通知家人/)
  })
})
