const fs = require('fs')
const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('summary 老人侧通话内容', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/summary/summary.js')

  function loadPage() {
    jest.resetModules()
    return loadPageModule(pagePath)
  }

  test('pending 状态仍展示真实保存的字幕', () => {
    const store = require('../../miniprogram/utils/store')
    store.addCallRecord({
      id: 'call_pending_1',
      date: '2026年9月5日 08:12',
      duration: '2分5秒',
      summaryStatus: 'pending',
      summary: '',
      messages: [
        { role: 'system', content: '内部提示词' },
        { role: 'user', content: '今天睡得不错' },
        { role: 'assistant', content: '（温柔地说）听起来精神很好' },
      ],
    })
    const page = loadPage()

    page.onLoad({ id: 'call_pending_1' })
    page.onShow()

    expect(page.data.record.summaryState).toBe('pending')
    expect(page.data.record.hasTranscript).toBe(true)
    expect(page.data.record.transcript.map(item => item.speaker)).toEqual(['您', '小林'])
    expect(page.data.record.transcript[0].content).toBe('今天睡得不错')
    expect(page.data.record.transcript[1].content).toBe('听起来精神很好')
  })

  test('success 和 failed 状态只使用真实摘要及记录内容', () => {
    const store = require('../../miniprogram/utils/store')
    store.addCallRecord({
      id: 'call_summary_1',
      date: '2026年9月5日 08:12',
      duration: '3分',
      summaryStatus: 'done',
      summary: '聊了今天散步的安排。',
      messages: [{ role: 'user', content: '我下午去散步' }],
    })
    const page = loadPage()
    page.onLoad({ id: 'call_summary_1' })
    page.onShow()

    expect(page.data.record.summaryState).toBe('success')
    expect(page.data.record.summaryMessage).toBe('聊了今天散步的安排。')

    store.updateCallRecord('call_summary_1', {
      summaryStatus: 'failed',
      summary: '',
    })
    page.reloadRecord()
    expect(page.data.record.summaryState).toBe('failed')
    expect(page.data.record.summaryMessage).toContain('通话内容仍可在下方查看')
  })

  test('字幕保留正常括号内容，只移除明确舞台指令', () => {
    const store = require('../../miniprogram/utils/store')
    store.addCallRecord({
      id: 'call_parentheses_1',
      date: '2026年9月5日 08:12',
      duration: '1分',
      summaryStatus: 'done',
      summary: '约好了就医时间。',
      messages: [
        { role: 'user', content: '周三（9月9日）去医院' },
        { role: 'assistant', content: '好的（轻声笑）我记住了' },
      ],
    })
    const page = loadPage()
    page.onLoad({ id: 'call_parentheses_1' })
    page.onShow()

    expect(page.data.record.transcript.map(item => item.content)).toEqual([
      '周三（9月9日）去医院',
      '好的我记住了',
    ])
  })

  test('不存在的记录显示明确返回状态', () => {
    const page = loadPage()
    page.onLoad({ id: 'missing' })
    page.onShow()
    expect(page.data.notFound).toBe(true)
    page.goBack()
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('读取失败与记录不存在分开显示，并可重试', () => {
    wx.getStorageSync.mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    const page = loadPage()

    page.onLoad({ id: 'call_storage_error' })
    page.onShow()

    expect(page.data.loadError).toBe(true)
    expect(page.data.notFound).toBe(false)

    page.reloadRecord()
    expect(page.data.loadError).toBe(false)
    expect(page.data.notFound).toBe(true)
  })

  test('正式 WXML 不包含画像、风险或无来源分析', () => {
    const wxml = fs.readFileSync(
      path.resolve(__dirname, '../../miniprogram/pages/summary/summary.wxml'),
      'utf8'
    )
    expect(wxml).toContain('通话字幕')
    expect(wxml).not.toMatch(/情绪|健康风险|兴趣|重点关注|AI SUMMARY|可转发给家人/)
  })
})
