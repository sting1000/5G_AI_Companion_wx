describe('store 离线规则', () => {
  function loadStore() {
    jest.resetModules()
    return require('../../miniprogram/utils/store')
  }

  test('getElderKey 会按姓名和手机号后4位归一化', () => {
    const store = loadStore()
    const key = store.getElderKey({
      parentName: ' 王 阿姨 ',
      phone: '138-0000-5678',
    })
    expect(key).toBe('elder:王阿姨:5678')
  })

  test('dialogId 支持按老人隔离并可清除', () => {
    const store = loadStore()
    store.saveDialogId('dlg_a', 'elder:a:1111')
    store.saveDialogId('dlg_b', 'elder:b:2222')

    expect(store.getDialogId('elder:a:1111')).toBe('dlg_a')
    expect(store.getDialogId('elder:b:2222')).toBe('dlg_b')

    store.clearDialogId('elder:a:1111')
    expect(store.getDialogId('elder:a:1111')).toBe('dlg_b')
  })

  test('提醒候选 upsert 会跳过低置信并合并重复项', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:0001'

    const result = store.upsertExtractedReminderCandidates([
      { title: '吃降压药', confidence: 0.5 },
      { title: '吃降压药', confidence: 0.86, scheduleType: 'daily', timeOfDay: '09:00', evidence: '语音提到早上吃药' },
      { title: '吃降压药', confidence: 0.9, scheduleType: 'daily', timeOfDay: '09:00', evidence: '再次确认' },
    ], elderKey)

    expect(result.skippedLowConfidence).toBe(1)
    expect(result.inserted).toBe(1)
    expect(result.updated).toBe(1)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('吃降压药')
    expect(list[0].confidence).toBe(0.9)
    expect(list[0].source).toBe('call_extract')
  })

  test('提醒状态流转: triggered -> done', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:0002'
    const reminder = store.saveReminder({
      title: '下午散步',
      scheduleType: 'daily',
      timeOfDay: '16:00',
    }, elderKey)

    const triggered = store.markReminderTriggered(reminder.id, elderKey)
    expect(triggered.status).toBe('triggered')
    expect(triggered.triggerCount).toBe(1)
    expect(triggered.lastTriggeredAt).toBeTruthy()

    const done = store.markReminderDone(reminder.id, elderKey)
    expect(done.status).toBe('done')
    expect(done.completedAt).toBeTruthy()
  })

  test('问候记忆冷却窗口生效', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:0003'
    store.markGreetingMemoryUsed(elderKey, '最近天气转凉')

    expect(store.isGreetingMemoryCooling(elderKey, '最近天气转凉', 60 * 60 * 1000)).toBe(true)

    jest.setSystemTime(new Date('2026-04-15T12:30:00.000Z'))
    expect(store.isGreetingMemoryCooling(elderKey, '最近天气转凉', 60 * 60 * 1000)).toBe(false)
  })

  test('mergeMemoryBundle + buildMemoryPrompt 能输出高价值记忆', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:0004'

    store.initMemoryBundle(elderKey, {
      health: '血压偏高',
      hobbies: ['太极', '书法'],
      preferredAddress: '王阿姨',
    })
    store.mergeMemoryBundle(elderKey, {
      elderMemory: {
        recentEvents: ['昨天去复诊', '昨天去复诊'],
        interestTags: ['太极'],
      },
      xiaolinMemory: {
        followUps: ['提醒按时复诊'],
      },
    }, 'call_001')

    const prompt = store.buildMemoryPrompt(elderKey, {
      maxItems: 2,
      minConfidence: 0.6,
      typeBudget: {
        followUp: 1,
        recentEvent: 1,
        interest: 1,
      },
    })
    expect(prompt).toContain('上次承诺跟进')
    expect(prompt).toContain('老人近期事件')
  })

  test('buildMemoryPrompt 会过滤低信息记忆句', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:0005'
    store.initMemoryBundle(elderKey, {
      health: '血压偏高',
      hobbies: ['太极'],
      preferredAddress: '王阿姨',
    })
    store.mergeMemoryBundle(elderKey, {
      elderMemory: {
        recentEvents: ['过得还行吧', '昨天去公园散步'],
      },
      xiaolinMemory: {
        followUps: ['没有呢，没有出去玩', '明天去医院复查膝盖'],
      },
    }, 'call_002')

    const prompt = store.buildMemoryPrompt(elderKey, {
      maxItems: 3,
      minConfidence: 0.6,
      typeBudget: {
        followUp: 2,
        recentEvent: 2,
        interest: 1,
      },
    })
    expect(prompt).toContain('明天去医院复查膝盖')
    expect(prompt).toContain('昨天去公园散步')
    expect(prompt).not.toContain('过得还行吧')
    expect(prompt).not.toContain('没有呢，没有出去玩')
  })
})
