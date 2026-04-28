const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('call 页面离线关键分支', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/call/call.js')

  function loadPage() {
    jest.resetModules()
    return loadPageModule(pagePath)
  }

  test('onAccept 首次点击会设置接听态并触发 _startCall', () => {
    const page = loadPage()
    page._startCall = jest.fn()

    page.onAccept()

    expect(page.data.isIncomingAnswering).toBe(true)
    expect(page.data.connectionPhase).toBe('dialing')
    expect(page._startCall).toHaveBeenCalledTimes(1)
  })

  test('onAccept 在重复点击时会直接返回', () => {
    const page = loadPage()
    page._startCall = jest.fn()
    page.setData({ isIncomingAnswering: true })

    page.onAccept()
    expect(page._startCall).not.toHaveBeenCalled()
  })

  test('onDecline 在可拒接状态会返回上一页', () => {
    const page = loadPage()
    page.setData({ isIncomingAnswering: false })
    page.onDecline()
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('_setConnectionPhase 会根据呼叫模式写入提示语', () => {
    const page = loadPage()

    page.setData({ callMode: 'outgoing' })
    page._setConnectionPhase('dialing')
    expect(page.data.connectionHint).toBe('正在呼叫小林...')

    page.setData({ callMode: 'incoming' })
    page._setConnectionPhase('dialing')
    expect(page.data.connectionHint).toBe('正在接听，马上就好...')
  })

  test('_authorize 失败且用户取消时会 reject', async () => {
    const page = loadPage()
    wx.authorize.mockImplementation(({ fail }) => fail())
    wx.showModal.mockImplementation(({ success }) => success({ confirm: false }))

    await expect(page._authorize()).rejects.toThrow('用户拒绝麦克风权限')
  })

  test('首句仅走 SAY_HELLO/TTS 时也会落字幕和消息', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
    }
    page.messages = []
    page.chatBuffer = ''
    page.pendingAssistantDraft = '您好呀，我是小林。'
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 0
    page.isBoundaryRepairing = false
    page.currentLatencyTurn = null
    page.setData({
      currentAssistantDraft: '您好呀，我是小林。',
      transcriptItems: [],
    })

    page._setupCallbacks()
    page.client.onTTSStart('')
    page.client.onTTSEnd()

    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].role).toBe('assistant')
    expect(page.messages[0].content).toBe('您好呀，我是小林。')
    expect(page.data.transcriptItems).toHaveLength(1)
    expect(page.data.transcriptItems[0].role).toBe('assistant')
    expect(page.data.transcriptItems[0].content).toBe('您好呀，我是小林。')
  })

  test('_sendAudioIn20msFrames 会按 640 字节分片并缓存余量', () => {
    const page = loadPage()
    const sendAudio = jest.fn()
    page.client = { sendAudio }
    page.uplinkRemainder = new Uint8Array(0)

    page._sendAudioIn20msFrames(new Uint8Array(1000).buffer)
    expect(sendAudio).toHaveBeenCalledTimes(1)
    expect(sendAudio.mock.calls[0][0].byteLength).toBe(640)
    expect(page.uplinkRemainder.byteLength).toBe(360)

    page._sendAudioIn20msFrames(new Uint8Array(300).buffer)
    expect(sendAudio).toHaveBeenCalledTimes(2)
    expect(sendAudio.mock.calls[1][0].byteLength).toBe(640)
    expect(page.uplinkRemainder.byteLength).toBe(20)
  })

  test('_isLowInfoSentence 能识别泛化短答与否定短答', () => {
    const page = loadPage()
    expect(page._isLowInfoSentence('过得还行吧')).toBe(true)
    expect(page._isLowInfoSentence('没有呢，没有出去玩')).toBe(true)
    expect(page._isLowInfoSentence('明天去医院复查膝盖')).toBe(false)
  })

  test('_pickFirstNotCooling 会跳过低信息记忆', () => {
    const page = loadPage()
    page.currentElderKey = 'elder:test:0005'
    const picked = page._pickFirstNotCooling([
      '过得还行吧',
      '没有呢，没有出去玩',
      '明天去医院复查膝盖',
    ])
    expect(picked).toBe('明天去医院复查膝盖')
  })

  test('_extractTopicMemoryCandidates 会按主题片段选高信息句', () => {
    const page = loadPage()
    const picked = page._extractTopicMemoryCandidates([
      '过得还行吧',
      '最近睡眠不太好，晚上总醒',
      '明天要去医院复查膝盖',
      '没有呢，没有出去玩',
      '这周想去公园散步活动一下',
    ], {
      maxItems: 3,
      maxSegments: 5,
      preferFuture: false,
      requireAction: false,
    })
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.some(item => item.includes('复查') || item.includes('散步'))).toBe(true)
    expect(picked).not.toContain('过得还行吧')
    expect(picked).not.toContain('没有呢，没有出去玩')
  })

  test('_extractInterestTags 会归一动作前缀避免“打太极拳/太极拳”重复', () => {
    const page = loadPage()
    const tags = page._extractInterestTags([
      '我喜欢打太极拳',
      '我平时也喜欢太极拳',
    ])
    expect(tags).toContain('太极拳')
    expect(tags.filter(item => item === '太极拳')).toHaveLength(1)
    expect(tags).not.toContain('打太极拳')
  })

  test('_buildMemoryAwareGreeting 在有待确认记忆时优先发起确认', () => {
    const page = loadPage()
    page.setData({ callMode: 'incoming' })
    const payload = page._buildMemoryAwareGreeting('王阿姨', {
      elderMemory: { recentEvents: [] },
      xiaolinMemory: { followUps: [] },
    }, null, { id: 'mem_1', text: '最近睡眠不太好' })

    expect(payload.text).toContain('确认')
    expect(payload.text).toContain('最近睡眠不太好')
  })

  test('_buildMemoryAwareGreeting 会避免直接引用提醒指令句', () => {
    const page = loadPage()
    page.setData({ callMode: 'outgoing' })
    const payload = page._buildMemoryAwareGreeting('张叔叔', {
      elderMemory: { recentEvents: [] },
      xiaolinMemory: { followUps: ['提醒张叔叔吃药'] },
    }, null, null)
    expect(payload.text).toContain('找我有什么事')
    expect(payload.text).toContain('想聊聊天或者设置提醒都可以')
    expect(payload.text).not.toContain('提醒张叔叔吃药')
  })

  test('_buildMemoryAwareGreeting 在立即通话时使用用户主导开场，不说“特地聊近况”', () => {
    const page = loadPage()
    page.setData({ callMode: 'outgoing' })
    const payload = page._buildMemoryAwareGreeting('龚阿姨', {
      elderMemory: { recentEvents: [] },
      xiaolinMemory: { followUps: ['最近睡眠不太好'] },
    }, null, null)
    expect(payload.text).toContain('找我有什么事')
    expect(payload.text).not.toContain('特地来和您聊聊近况')
    expect(payload.text).not.toContain('最近睡眠不太好')
  })

  test('_isReminderCommandLike 能识别“提醒某人起床”这类提醒句', () => {
    const page = loadPage()
    expect(page._isReminderCommandLike('小林提醒龚阿姨起床')).toBe(true)
    expect(page._isReminderCommandLike('上次聊到起床后去公园散步')).toBe(false)
  })

  test('_extractFollowUps 会过滤提醒指令句', () => {
    const page = loadPage()
    const followUps = page._extractFollowUps({
      highlights: ['提醒张叔叔下午2点出门跳广场舞', '明天去医院复查膝盖']
    }, [])
    expect(followUps).toContain('明天去医院复查膝盖')
    expect(followUps.some(text => text.includes('提醒张叔叔'))).toBe(false)
  })

  test('_tryResolvePendingMemoryConfirmation 会按用户确认结果更新记忆状态', () => {
    const page = loadPage()
    page.currentElderKey = 'elder:test:0007'
    page.pendingMemoryConfirmation = { id: 'mem_pending_1', text: '最近睡眠不太好' }

    page._tryResolvePendingMemoryConfirmation('是的，这个情况一直有')
    expect(page.pendingMemoryConfirmation).toBe(null)

    page.pendingMemoryConfirmation = { id: 'mem_pending_2', text: '最近睡眠不太好' }
    page._tryResolvePendingMemoryConfirmation('不是，我没有这个问题')
    expect(page.pendingMemoryConfirmation).toBe(null)
  })

  test('ASR 最终识别在说出“提醒+时间”时会立刻入库提醒（P0/B）', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')

    const elderKey = 'elder:test:asr-reminder-1'
    page.currentElderKey = elderKey
    page._markCallConnectedIfNeeded = jest.fn()
    page._tryResolvePendingMemoryConfirmation = jest.fn()
    page.pendingMemoryConfirmation = null
    page.messages = []
    page.client = {}
    page.recorder = {}
    page.player = { appendChunk: jest.fn(), playBuffered: jest.fn(), stop: jest.fn(), playing: false }

    page._setupCallbacks()
    page.client.onASRText('提醒我明天早上九点钟吃药', true)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('吃药')
    expect(list[0].scheduleType).toBe('once')
    expect(list[0].timeOfDay).toBe('09:00')
    expect(list[0].status).toBe('pending')
  })

  test('ASR 最终识别支持中文数字时间“八点”并正确入库（P0/B）', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')

    const elderKey = 'elder:test:asr-reminder-cn-hour'
    page.currentElderKey = elderKey
    page._markCallConnectedIfNeeded = jest.fn()
    page._tryResolvePendingMemoryConfirmation = jest.fn()
    page.pendingMemoryConfirmation = null
    page.messages = []
    page.client = {}
    page.recorder = {}
    page.player = { appendChunk: jest.fn(), playBuffered: jest.fn(), stop: jest.fn(), playing: false }

    page._setupCallbacks()
    page.client.onASRText('每天早上八点提醒我关煤气', true)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('关煤气')
    expect(list[0].scheduleType).toBe('daily')
    expect(list[0].timeOfDay).toBe('08:00')
    expect(list[0].status).toBe('pending')
  })

  test('ASR 最终识别不会给“无时间的提醒”直接入库（P0/B）', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')

    const elderKey = 'elder:test:asr-reminder-2'
    page.currentElderKey = elderKey
    page._markCallConnectedIfNeeded = jest.fn()
    page._tryResolvePendingMemoryConfirmation = jest.fn()
    page.pendingMemoryConfirmation = null
    page.messages = []
    page.client = {}
    page.recorder = {}
    page.player = { appendChunk: jest.fn(), playBuffered: jest.fn(), stop: jest.fn(), playing: false }

    page._setupCallbacks()
    page.client.onASRText('提醒我怎么吃药', true)

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(0)
  })

  test('模拟呼入提醒回访后，不会重复新增同名提醒', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')

    const elderKey = 'elder:test:incoming-reminder-dedup'
    page.currentElderKey = elderKey

    store.saveReminder({
      title: '起床',
      scheduleType: 'daily',
      timeOfDay: '07:30',
      status: 'triggered',
    }, elderKey)

    const record = {
      id: 'call_incoming_1',
      messages: [
        { role: 'assistant', content: '我来提醒您“起床”。这件事完成了吗？' },
        { role: 'user', content: '完成了，谢谢你提醒我起床' },
      ],
    }

    page._evolveMemory(record, {
      summary: '本次为提醒回访电话',
      topics: ['日常提醒'],
      highlights: ['提醒回访起床'],
      reminderCandidates: [
        {
          title: '起床',
          scheduleType: 'daily',
          confidence: 0.9,
          evidence: '我来提醒您“起床”。这件事完成了吗？',
        },
      ],
      mood: '平静',
      moodEmoji: '😌',
    })

    const list = store.getReminders(elderKey)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('起床')
    expect(list[0].timeOfDay).toBe('07:30')
  })

  test('_evolveMemory 会优先使用 extractMemories 云函数返回的结构化记忆', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:cloud-memory'
    page.currentElderKey = elderKey
    wx.cloud = {
      callFunction: jest.fn(() => Promise.resolve({
        result: {
          success: true,
          data: {
            elderMemory: {
              interestTags: ['书法'],
            },
            xiaolinMemory: {
              followUps: ['下次问问书法班报名情况'],
            },
            memoryItems: [
              {
                type: 'interest',
                text: '最近在练书法',
                confidence: 0.88,
                evidence: '我最近在练书法',
                needsConfirmation: false,
              },
            ],
          },
        },
      })),
    }
    const record = {
      id: 'call_cloud_memory_1',
      messages: [
        { role: 'user', content: '我最近在练书法' },
        { role: 'assistant', content: '那很好呀，下次我再问问您练得怎么样。' },
      ],
    }

    await page._evolveMemory(record, {
      summary: '聊到书法练习',
      topics: ['书法'],
      highlights: ['老人最近在练书法'],
    })

    expect(wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: 'extractMemories',
    }))
    const bundle = store.getMemoryBundle(elderKey)
    const item = bundle.memoryItems.find(memory => memory.text === '最近在练书法')
    expect(item).toBeTruthy()
    expect(item.source).toBe('cloud_ark')
    expect(item.sourceCallId).toBe('call_cloud_memory_1')
    expect(item.evidence).toBe('我最近在练书法')
    expect(bundle.xiaolinMemory.followUps).toContain('下次问问书法班报名情况')
  })

  test('呼入回访已确认完成时，会抑制同提醒候选的二次入库', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T10:00:00.000Z'))
    const page = loadPage()
    const record = {
      id: 'call_incoming_done_1',
      messages: [
        { role: 'assistant', content: '我来提醒您“吃降压药”。这件事完成了吗？' },
        { role: 'user', content: '嗯，已经完成了' },
      ],
    }
    page.setData({ callMode: 'incoming' })
    page.incomingReminder = { id: 'rem_1', title: '吃降压药' }

    const candidates = page._extractReminderCandidates(record, {
      reminderCandidates: [
        {
          title: '每天九点吃降压药',
          scheduleType: 'daily',
          timeOfDay: '09:00',
          confidence: 0.9,
          evidence: '我来提醒您吃降压药，这件事完成了吗',
        },
      ],
    })
    expect(candidates).toHaveLength(0)
  })

  test('_handleIncomingReminderFollowup 在用户确认完成时会立即标记提醒完成', () => {
    const page = loadPage()
    const store = require('../../miniprogram/utils/store')
    const elderKey = 'elder:test:incoming-reminder-complete'
    page.currentElderKey = elderKey
    const reminder = store.saveReminder({
      title: '吃药',
      scheduleType: 'daily',
      timeOfDay: '08:00',
      status: 'triggered',
    }, elderKey)

    page.incomingReminder = { id: reminder.id, title: reminder.title }
    page.incomingFollowupState = {
      reminderCompleted: false,
      waitingNoMoreChatConfirm: false,
      shouldAutoEndAfterAssistant: false,
    }

    page._handleIncomingReminderFollowup('嗯，今天已经做完了')
    const list = store.getReminders(elderKey)
    const current = list.find(item => item.id === reminder.id)
    expect(current.status).toBe('done')
    expect(page.incomingFollowupState.waitingNoMoreChatConfirm).toBe(true)
  })

  test('_handleIncomingReminderFollowup 在“没别的想聊”时会触发收尾结束标记', () => {
    const page = loadPage()
    page.incomingReminder = { id: 'rem_1', title: '复查' }
    page.incomingFollowupState = {
      reminderCompleted: true,
      waitingNoMoreChatConfirm: true,
      shouldAutoEndAfterAssistant: false,
    }

    page._handleIncomingReminderFollowup('没有了，就先这样吧')
    expect(page.incomingFollowupState.shouldAutoEndAfterAssistant).toBe(true)
  })

  test('_maybeInjectOutgoingSmallTalkSteer 在“想聊聊”且无明确诉求时会注入兜底引导', () => {
    const page = loadPage()
    page.setData({ callMode: 'outgoing' })
    page.assistantTurnCount = 1
    page.currentElderKey = 'elder:test:small-talk'
    page.client = {
      sessionActive: true,
      sendTextQuery: jest.fn(),
    }
    page._buildSmallTalkSteerPrompt = jest.fn(() => '用户想聊聊，请从兴趣继续')

    page._maybeInjectOutgoingSmallTalkSteer('没啥事，就想和你聊聊天')
    expect(page.client.sendTextQuery).toHaveBeenCalledTimes(1)
    expect(page.client.sendTextQuery.mock.calls[0][0]).toContain('想聊聊')
  })

  test('_maybeInjectOutgoingSmallTalkSteer 在有明确诉求时不会注入兜底引导', () => {
    const page = loadPage()
    page.setData({ callMode: 'outgoing' })
    page.assistantTurnCount = 1
    page.client = {
      sessionActive: true,
      sendTextQuery: jest.fn(),
    }

    page._maybeInjectOutgoingSmallTalkSteer('我胸闷不舒服，想问问怎么办')
    expect(page.client.sendTextQuery).not.toHaveBeenCalled()
  })

  test('自动收尾会等待最后一句播放完成后再结束通话', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page._endCall = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: true,
    }
    page.messages = []
    page.chatBuffer = ''
    page.pendingAssistantDraft = '那我们今天就先聊到这里，您早点休息。'
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 1
    page.isBoundaryRepairing = false
    page.currentLatencyTurn = null
    page.incomingFollowupState = {
      reminderCompleted: true,
      waitingNoMoreChatConfirm: true,
      shouldAutoEndAfterAssistant: true,
      pendingAutoEndAfterPlayback: false,
    }
    page.setData({
      currentAssistantDraft: '那我们今天就先聊到这里，您早点休息。',
      transcriptItems: [],
    })

    page._setupCallbacks()
    page.client.onTTSEnd()
    expect(page._endCall).not.toHaveBeenCalled()
    expect(page.incomingFollowupState.pendingAutoEndAfterPlayback).toBe(true)

    page.player.onPlayEnd()
    expect(page._endCall).toHaveBeenCalledTimes(1)
  })

  test('自动收尾在播放器未进入播放态时会延迟兜底挂断', () => {
    jest.useFakeTimers()
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page._endCall = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
    }
    page.messages = []
    page.chatBuffer = ''
    page.pendingAssistantDraft = '那我们今天就先聊到这里，您早点休息。'
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 1
    page.isBoundaryRepairing = false
    page.currentLatencyTurn = null
    page.incomingFollowupState = {
      reminderCompleted: true,
      waitingNoMoreChatConfirm: true,
      shouldAutoEndAfterAssistant: true,
      pendingAutoEndAfterPlayback: false,
    }
    page.setData({
      currentAssistantDraft: '那我们今天就先聊到这里，您早点休息。',
      transcriptItems: [],
    })

    page._setupCallbacks()
    page.client.onTTSEnd()
    expect(page._endCall).not.toHaveBeenCalled()
    expect(page.incomingFollowupState.pendingAutoEndAfterPlayback).toBe(true)

    jest.advanceTimersByTime(1800)
    expect(page._endCall).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })
})
