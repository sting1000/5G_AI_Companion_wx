const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('records 老人侧通话记录', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/records/records.js')

  function loadPage() {
    jest.resetModules()
    return loadPageModule(pagePath)
  }

  test('只装饰日期、时间、时长和摘要状态，并整项进入 summary', () => {
    const store = require('../../miniprogram/utils/store')
    store.addCallRecord({
      id: 'call_record_1',
      date: '2026年9月5日 08:12',
      duration: '8分12秒',
      summaryStatus: 'failed',
      moodLabel: '焦虑',
      topics: ['健康'],
      messages: [{ role: 'user', content: '早上好' }],
    })
    const page = loadPage()

    page.onLoad()
    page.onShow()

    expect(page.data.records).toHaveLength(1)
    expect(page.data.records[0]).toEqual(expect.objectContaining({
      dateText: '9月5日',
      timeText: '08:12',
      durationText: '8分12秒',
      summaryState: 'failed',
      summaryStatusText: '摘要暂不可用，可查看通话内容',
    }))

    page.goSummary({ currentTarget: { dataset: { id: 'call_record_1' } } })
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/summary/summary?id=call_record_1',
    })
  })

  test('空状态和加载失败都可返回今天', () => {
    const emptyPage = loadPage()
    emptyPage.onShow()
    expect(emptyPage.data.hasRecords).toBe(false)
    emptyPage.goToday()
    expect(wx.reLaunch).toHaveBeenCalledWith({
      url: '/pages/dashboard/dashboard',
    })

    wx.getStorageSync.mockImplementation(() => {
      throw new Error('storage failed')
    })
    const failedPage = loadPage()
    failedPage.onShow()
    expect(failedPage.data.hasLoadError).toBe(true)
  })
})
