const extractor = require('../../miniprogram/utils/reminder-extractor')

describe('reminder-extractor 提醒抽取规则', () => {
  const now = new Date('2026-04-28T10:00:00.000+08:00')

  test('明确提醒意图和完整时间会生成高置信候选', () => {
    const candidate = extractor.buildReminderCandidateFromText('提醒我明天早上九点钟吃药', { now })

    expect(candidate).toBeTruthy()
    expect(candidate.title).toBe('吃药')
    expect(candidate.scheduleType).toBe('once')
    expect(candidate.remindDate).toBe('2026-04-29')
    expect(candidate.timeOfDay).toBe('09:00')
    expect(candidate.needsConfirmation).toBe(false)
    expect(candidate.confidence).toBeGreaterThanOrEqual(0.78)
  })

  test('明确提醒支持“明早9点”这类口语日期', () => {
    const candidate = extractor.buildReminderCandidateFromText('明早9点提醒我吃药', { now })
    const eveningCandidate = extractor.buildReminderCandidateFromText('明晚9点提醒我关煤气', { now })

    expect(candidate).toBeTruthy()
    expect(candidate.title).toBe('吃药')
    expect(candidate.remindDate).toBe('2026-04-29')
    expect(candidate.timeOfDay).toBe('09:00')
    expect(candidate.needsConfirmation).toBe(false)
    expect(eveningCandidate).toBeTruthy()
    expect(eveningCandidate.remindDate).toBe('2026-04-29')
    expect(eveningCandidate.timeOfDay).toBe('21:00')
  })

  test('明确提醒会去掉句末口语语气词', () => {
    const candidate = extractor.buildReminderCandidateFromText('提醒我明天九点出门吧', { now })

    expect(candidate).toBeTruthy()
    expect(candidate.title).toBe('出门')
    expect(candidate.scheduleType).toBe('once')
    expect(candidate.remindDate).toBe('2026-04-29')
    expect(candidate.timeOfDay).toBe('09:00')
    expect(candidate.needsConfirmation).toBe(false)
  })

  test('未来计划陈述只生成待确认候选', () => {
    const candidate = extractor.buildReminderCandidateFromText('我明天去医院复查', { now })

    expect(candidate).toBeTruthy()
    expect(candidate.title).toBe('医院复查')
    expect(candidate.scheduleType).toBe('once')
    expect(candidate.remindDate).toBe('2026-04-29')
    expect(candidate.needsConfirmation).toBe(true)
    expect(candidate.missingFields).toContain('time')
    expect(candidate.confidence).toBeLessThan(0.78)
  })

  test('过滤问询、感谢、完成确认和取消提醒', () => {
    expect(extractor.buildReminderCandidateFromText('提醒我怎么吃药', { now })).toBe(null)
    expect(extractor.buildReminderCandidateFromText('谢谢你提醒我吃药', { now })).toBe(null)
    expect(extractor.buildReminderCandidateFromText('已经完成了，谢谢提醒', { now })).toBe(null)
    expect(extractor.buildReminderCandidateFromText('不用提醒我吃药了', { now })).toBe(null)
  })

  test('相对日期和周期星期解析稳定', () => {
    const tomorrow = extractor.buildReminderCandidateFromText('提醒我明天上午十点复查', { now })
    const nextMonday = extractor.buildReminderCandidateFromText('提醒我下周一上午十点复查', { now })
    const weekly = extractor.buildReminderCandidateFromText('每周一上午十点提醒我测血压', { now })

    expect(tomorrow.remindDate).toBe('2026-04-29')
    expect(nextMonday.remindDate).toBe('2026-05-04')
    expect(weekly.scheduleType).toBe('weekly')
    expect(weekly.weekdays).toEqual([1])
    expect(weekly.timeOfDay).toBe('10:00')
  })
})
