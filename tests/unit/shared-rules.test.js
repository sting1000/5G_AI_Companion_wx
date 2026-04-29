const rules = require('../../miniprogram/utils/shared-rules')

describe('shared-rules', () => {
  test('extractHealthTags 会优先保留高血压标签', () => {
    const tags = rules.extractHealthTags('最近高血压有点波动，偶尔头晕')
    expect(tags).toContain('高血压')
    expect(tags).not.toContain('血压波动')
  })

  test('extractHealthTags 不把提醒句前的语气词展示成健康线索', () => {
    const tags = rules.extractHealthTags('哦，你提醒我明天九点吃药')

    expect(tags).toContain('用药')
    expect(tags).not.toContain('哦')
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

  test('normalizeSummaryPayload 会校正本地摘要默认平静情绪', () => {
    const payload = rules.normalizeSummaryPayload({
      summary: '聊到身体不适',
      topics: ['健康关注'],
      highlights: ['最近胸闷，晚上睡不着，有点担心'],
      mood: '平静',
      moodEmoji: '😌',
      summarySource: 'local_rule',
    }, {
      messages: [{ role: 'user', content: '我最近胸闷，晚上睡不着，有点担心' }],
    }, { preferSource: 'local_rule' })

    expect(payload.moodLabel).toBe('焦虑')
    expect(payload.mood).toBe('😟')
  })
})
