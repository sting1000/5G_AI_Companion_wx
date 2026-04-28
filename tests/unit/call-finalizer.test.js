const { applyLocalSummary } = require('../../miniprogram/utils/call-finalizer')

describe('call-finalizer', () => {
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
})
