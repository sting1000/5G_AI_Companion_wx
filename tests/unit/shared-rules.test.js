const rules = require('../../miniprogram/utils/shared-rules')

describe('shared-rules', () => {
  test('extractHealthTags 会优先保留高血压标签', () => {
    const tags = rules.extractHealthTags('最近高血压有点波动，偶尔头晕')
    expect(tags).toContain('高血压')
    expect(tags).not.toContain('血压波动')
  })

  test('normalizeSummaryPayload 会回退情绪并去重话题', () => {
    const payload = rules.normalizeSummaryPayload({
      summary: '聊了日常',
      topics: ['散步', '散步', '买菜'],
      highlights: ['今天去了公园'],
      mood: '',
      moodEmoji: '',
    }, {
      messages: [{ role: 'user', content: '我今天挺开心的' }],
    }, { preferSource: 'local_rule' })

    expect(payload.moodLabel).toBe('开心')
    expect(payload.mood).toBe('😊')
    expect(payload.topics).toEqual(['散步', '买菜'])
  })
})
