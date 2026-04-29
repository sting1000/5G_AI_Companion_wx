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
    expect(store.getDialogId('elder:a:1111')).toBe('')
  })

  test('提醒候选 upsert 会把低置信候选设为待确认并合并重复项', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:0001'

    const result = store.upsertExtractedReminderCandidates([
      { title: '吃降压药', confidence: 0.5 },
      { title: '吃降压药', confidence: 0.86, scheduleType: 'daily', timeOfDay: '09:00', evidence: '语音提到早上吃药' },
      { title: '吃降压药', confidence: 0.9, scheduleType: 'daily', timeOfDay: '09:00', evidence: '再次确认' },
    ], elderKey)

    expect(result.skippedLowConfidence).toBe(0)
    expect(result.inserted).toBe(1)
    expect(result.updated).toBe(2)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('吃降压药')
    expect(list[0].confidence).toBe(0.9)
    expect(list[0].source).toBe('call_extract')
    expect(list[0].status).toBe('pending')
  })

  test('待确认提醒不会参与主动呼入调度', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:candidate-reminder'

    const result = store.upsertExtractedReminderCandidates([
      {
        title: '医院复查',
        confidence: 0.66,
        scheduleType: 'once',
        remindDate: '2026-04-16',
        timeOfDay: '09:00',
        needsConfirmation: true,
        missingFields: ['time'],
      },
    ], elderKey)

    expect(result.inserted).toBe(1)
    expect(result.insertedCandidates).toBe(1)
    const list = store.getReminders(elderKey)
    expect(list[0].status).toBe('candidate')
    expect(list[0].needsConfirmation).toBe(true)
    expect(store.pickNextIncomingReminder(elderKey)).toBe(null)
  })

  test('提醒候选会归一化“提醒张叔叔吃药/吃药”为同一条', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:dedup-reminder'
    store.upsertExtractedReminderCandidates([
      { title: '提醒张叔叔吃药', confidence: 0.9, scheduleType: 'daily', timeOfDay: '09:00' },
      { title: '吃药', confidence: 0.92, scheduleType: 'daily', timeOfDay: '09:00' },
    ], elderKey)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('吃药')
    expect(list[0].confidence).toBe(0.92)
  })

  test('提醒标题会去掉“九点钟”时间词', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:dedup-reminder-clock'
    store.upsertExtractedReminderCandidates([
      {
        title: '叫我明天早上九点钟吃药',
        confidence: 0.9,
        scheduleType: 'once',
        timeOfDay: '09:00',
      },
      {
        title: '吃药',
        confidence: 0.92,
        scheduleType: 'once',
        timeOfDay: '09:00',
      },
    ], elderKey)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('吃药')
    expect(list[0].confidence).toBe(0.92)
  })

  test('提醒候选会归一化“后天早上九点去看电影/看电影”为同一条', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:dedup-reminder-movie'
    store.upsertExtractedReminderCandidates([
      {
        title: '提醒我后天早上九点去看电影',
        confidence: 0.9,
        scheduleType: 'once',
        timeOfDay: '09:00',
      },
      {
        title: '看电影',
        confidence: 0.92,
        scheduleType: 'once',
        timeOfDay: '09:00',
      },
    ], elderKey)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('看电影')
    expect(list[0].confidence).toBe(0.92)
  })

  test('提醒候选缺少时间线索时，会按标题+周期合并避免回访重复新增', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:dedup-reminder-no-time-cue'
    store.saveReminder({
      title: '起床',
      scheduleType: 'daily',
      timeOfDay: '07:30',
    }, elderKey)

    const result = store.upsertExtractedReminderCandidates([
      {
        title: '起床',
        confidence: 0.9,
        scheduleType: 'daily',
        evidence: '我来提醒您起床，这件事完成了吗',
      },
    ], elderKey)

    expect(result.inserted).toBe(0)
    expect(result.updated).toBe(1)
    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('起床')
    expect(list[0].timeOfDay).toBe('07:30')
  })

  test('提醒候选会忽略提醒前的口语前缀，只保留提醒后内容', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:dedup-reminder-prefix'
    store.upsertExtractedReminderCandidates([
      {
        title: '嗯那个再提醒我后天早上九点去看电影',
        confidence: 0.91,
        scheduleType: 'once',
        timeOfDay: '09:00',
      },
      {
        title: '看电影',
        confidence: 0.89,
        scheduleType: 'once',
        timeOfDay: '09:00',
      },
    ], elderKey)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('看电影')
    expect(list[0].confidence).toBe(0.91)
  })

  test('提醒候选在整句更口语化时也会只取提醒后正文', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:dedup-reminder-spoken'
    store.upsertExtractedReminderCandidates([
      {
        title: '就是那个，到时候记得提醒我明天上午九点去医院复查',
        confidence: 0.9,
        scheduleType: 'once',
        timeOfDay: '09:00',
      },
      {
        title: '医院复查',
        confidence: 0.88,
        scheduleType: 'once',
        timeOfDay: '09:00',
      },
    ], elderKey)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('医院复查')
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

  test('摘要候选更新命中已完成提醒时，不会把 done 改回 pending', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:done-preserve'
    const reminder = store.saveReminder({
      title: '吃降压药',
      scheduleType: 'daily',
      timeOfDay: '09:00',
      status: 'done',
    }, elderKey)

    const result = store.upsertExtractedReminderCandidates([
      {
        title: '每天九点吃降压药',
        confidence: 0.91,
        scheduleType: 'daily',
        timeOfDay: '09:00',
        evidence: '提醒回访',
      },
    ], elderKey)

    expect(result.inserted).toBe(0)
    expect(result.updated).toBe(1)
    const list = store.getReminders(elderKey)
    const current = list.find(item => item.id === reminder.id)
    expect(current).toBeTruthy()
    expect(current.status).toBe('done')
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

  test('敏感记忆默认进入 pending，确认后才参与记忆提示', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:0006'
    store.initMemoryBundle(elderKey, {
      health: '高血压',
      hobbies: ['太极'],
      preferredAddress: '王阿姨',
    })

    store.mergeMemoryBundle(elderKey, {
      elderMemory: {
        healthNotes: ['最近血压有点波动'],
      },
    }, 'call_003')

    const pendingItems = store.getPendingMemoryConfirmations(elderKey, { maxCount: 5 })
    const pendingHealth = pendingItems.find(item => item.text === '最近血压有点波动')
    expect(pendingHealth).toBeTruthy()
    expect(pendingHealth.status).toBe('pending')

    const promptBeforeConfirm = store.buildMemoryPrompt(elderKey, {
      maxItems: 3,
      minConfidence: 0.6,
      typeBudget: { followUp: 1, recentEvent: 1, interest: 1 },
    })
    expect(promptBeforeConfirm).not.toContain('最近血压有点波动')

    store.confirmMemoryItem(elderKey, pendingHealth.id, true)
    const pendingAfterConfirm = store.getPendingMemoryConfirmations(elderKey, { maxCount: 5 })
    expect(pendingAfterConfirm.find(item => item.id === pendingHealth.id)).toBeFalsy()

    const bundle = store.getMemoryBundle(elderKey)
    const confirmedItem = (bundle.memoryItems || []).find(item => item.id === pendingHealth.id)
    expect(confirmedItem).toBeTruthy()
    expect(confirmedItem.status).toBe('confirmed')
  })

  test('memoryItems 会保留来源、证据、有效期和可见性元数据', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:memory-meta'

    store.mergeMemoryBundle(elderKey, {
      memorySource: 'cloud_ark',
      elderMemory: {
        recentEvents: ['周五要去社区量血压'],
      },
      memoryItems: [
        {
          type: 'healthNote',
          text: '最近血压有点波动',
          confidence: 0.86,
          evidence: '老人说最近血压有点波动',
          validFrom: '2026-04-15',
          expiresAt: '2026-07-15',
          sensitivity: 'sensitive',
          needsConfirmation: true,
        },
      ],
    }, 'call_meta_001')

    const bundle = store.getMemoryBundle(elderKey)
    const health = bundle.memoryItems.find(item => item.text === '最近血压有点波动')
    const event = bundle.memoryItems.find(item => item.text === '周五要去社区量血压')

    expect(health.sourceCallId).toBe('call_meta_001')
    expect(health.evidence).toBe('老人说最近血压有点波动')
    expect(health.validFrom).toBe('2026-04-15')
    expect(health.expiresAt).toBe('2026-07-15')
    expect(health.visibility).toBe('guardian_review')
    expect(health.status).toBe('pending')
    expect(event.source).toBe('cloud_ark')
    expect(event.sourceCallId).toBe('call_meta_001')
  })

  test('buildMemoryContext 会按意图召回记忆并过滤未确认健康信息', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:memory-context'

    store.mergeMemoryBundle(elderKey, {
      elderMemory: {
        interestTags: ['太极拳'],
        healthNotes: ['最近血压有点波动'],
      },
      xiaolinMemory: {
        tabooTopics: ['不想聊住院经历'],
      },
    }, 'call_context_001')

    const smallTalk = store.buildMemoryContext(elderKey, {
      intent: 'smallTalk',
      maxItems: 3,
      minConfidence: 0.6,
    })
    expect(smallTalk.prompt).toContain('老人兴趣：太极拳')
    expect(smallTalk.prompt).not.toContain('最近血压有点波动')

    const pending = store.getPendingMemoryConfirmations(elderKey, { maxCount: 5 })
    const health = pending.find(item => item.text === '最近血压有点波动')
    store.confirmMemoryItem(elderKey, health.id, true)

    const healthContext = store.buildMemoryContext(elderKey, {
      intent: 'healthConcern',
      maxItems: 3,
      minConfidence: 0.6,
    })
    expect(healthContext.prompt).toContain('健康背景')
    expect(healthContext.prompt).toContain('最近血压有点波动')
    expect(healthContext.prompt).toContain('慎提话题')
  })

  test('updateMemoryItem/deleteMemoryItem 可编辑和删除长期记忆', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const store = loadStore()
    const elderKey = 'elder:test:memory-edit'
    store.mergeMemoryBundle(elderKey, {
      elderMemory: {
        interestTags: ['太极'],
      },
    }, 'call_edit_001')

    const item = store.getMemoryBundle(elderKey).memoryItems.find(row => row.text === '太极')
    const updated = store.updateMemoryItem(elderKey, item.id, {
      text: '太极拳',
      status: 'confirmed',
      needsConfirmation: false,
    })
    expect(updated.text).toBe('太极拳')
    expect(store.getMemoryBundle(elderKey).elderMemory.interestTags).toContain('太极拳')
    expect(store.getMemoryBundle(elderKey).elderMemory.interestTags).not.toContain('太极')

    expect(store.deleteMemoryItem(elderKey, item.id)).toBe(true)
    expect(store.getMemoryBundle(elderKey).memoryItems.find(row => row.id === item.id)).toBeFalsy()
    expect(store.getMemoryBundle(elderKey).elderMemory.interestTags).not.toContain('太极拳')
  })
})
