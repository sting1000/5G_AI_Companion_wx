const { applyLocalSummary, generateSummary } = require('../../miniprogram/utils/call-finalizer')
const cloudFunctions = require('../../miniprogram/utils/cloud-functions')

describe('call-finalizer', () => {
  beforeEach(() => {
    cloudFunctions._resetUnavailableFunctionsForTest()
  })

  test('applyLocalSummary 会更新摘要并触发记忆演进', () => {
    const updateCallRecord = jest.fn()
    const evolveMemory = jest.fn()
    const normalizeSummaryPayload = jest.fn((payload) => ({
      summary: payload.summary,
      topics: payload.topics,
      highlights: payload.highlights,
      mood: '😌',
      moodLabel: '平静',
      summarySource: 'local_rule',
      summaryModel: '',
    }))

    const record = {
      id: 'call_1',
      messages: [
        { role: 'user', content: '我今天去公园散步了' },
        { role: 'assistant', content: '挺好的' },
      ],
    }

    applyLocalSummary(record, {
      elderName: '王阿姨',
      normalizeSummaryPayload,
      updateCallRecord,
      evolveMemory,
    })

    expect(updateCallRecord).toHaveBeenCalledTimes(1)
    expect(evolveMemory).toHaveBeenCalledTimes(1)
    expect(normalizeSummaryPayload).toHaveBeenCalled()
  })

  test('generateSummary 在云函数未部署时会本地降级并缓存不可用状态', async () => {
    wx.cloud = {
      callFunction: jest.fn(() => Promise.reject({
        message: 'cloud.callFunction:fail Error: errCode: -501000 | errMsg: the reource is not found',
      })),
    }
    const updateCallRecord = jest.fn()
    const evolveMemory = jest.fn()
    const normalizeSummaryPayload = jest.fn((payload) => ({
      summary: payload.summary,
      topics: payload.topics,
      highlights: payload.highlights,
      mood: '😌',
      moodLabel: '平静',
      summarySource: payload.summarySource || 'local_rule',
      summaryModel: '',
    }))
    const options = {
      elderName: '王阿姨',
      normalizeSummaryPayload,
      updateCallRecord,
      evolveMemory,
    }

    await generateSummary({
      id: 'call_1',
      messages: [
        { role: 'user', content: '我今天去公园散步了' },
        { role: 'assistant', content: '挺好的' },
      ],
    }, options)

    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(updateCallRecord).toHaveBeenCalledWith('call_1', expect.objectContaining({
      summaryStatus: 'done',
      summaryError: '',
      summarySource: 'local_rule',
    }))

    await generateSummary({
      id: 'call_2',
      messages: [
        { role: 'user', content: '我今天练了书法' },
      ],
    }, options)

    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(updateCallRecord).toHaveBeenCalledWith('call_2', expect.objectContaining({
      summaryStatus: 'done',
      summaryError: '',
      summarySource: 'local_rule',
    }))
  })
})
