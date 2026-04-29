const store = require('../../utils/store')
const sharedRules = (() => {
  const LOW_INFO_SPEECH_PARTICLES = new Set([
    '嗯', '嗯嗯', '哦', '噢', '喔', '呃', '额', '啊', '呀', '呢', '好', '好的', '行', '可以',
  ])

  function stripLeadingSpeechParticles(text) {
    let result = String(text || '').trim()
    let changed = true
    while (changed) {
      const before = result
      result = result
        .replace(/^[，。,、；;！!？?\s]+/, '')
        .replace(/^(嗯嗯|嗯|哦|噢|喔|呃|额|啊|呀|好的|好|行|可以)[，。,、；;！!？?\s]*/u, '')
        .trim()
      changed = result !== before
    }
    return result
  }

  function isLowInfoSpeechParticle(text) {
    const normalized = String(text || '').trim().replace(/\s+/g, '')
    return !normalized || normalized.length <= 1 || LOW_INFO_SPEECH_PARTICLES.has(normalized)
  }

  function uniqTags(items) {
    const seen = {}
    const result = []
    ;(items || []).forEach((item) => {
      const text = String(item || '').trim()
      if (!text || seen[text]) return
      seen[text] = true
      result.push(text)
    })
    return result
  }
  function normalizeInterestTags(tags) {
    return uniqTags(tags).filter(tag => tag.length > 0 && tag.length <= 10)
  }
  function extractHealthTags(healthText) {
    const text = String(healthText || '').trim()
    if (!text) return []
    const compact = text.replace(/\s+/g, '')
    const keywordDict = [
      ['失眠', ['失眠']],
      ['睡不着', ['睡不着', '入睡困难', '早醒']],
      ['睡眠问题', ['睡眠']],
      ['高血压', ['高血压']],
      ['血压波动', ['血压', '头晕']],
      ['糖尿病', ['糖尿病']],
      ['血糖偏高', ['血糖']],
      ['心脏病', ['心脏病']],
      ['心悸', ['心悸']],
      ['胸闷', ['胸闷']],
      ['胸痛', ['胸痛']],
      ['心脏问题', ['心脏']],
      ['关节疼痛', ['关节', '膝盖', '腰痛', '腰酸', '腿疼', '疼痛']],
      ['食欲下降', ['胃口', '食欲']],
      ['消化不适', ['消化', '胃痛', '腹胀']],
      ['按时吃药', ['按时服药']],
      ['漏服药', ['漏服']],
      ['用药', ['吃药', '药']],
    ]
    const matchedMeta = keywordDict
      .map(([tag, keywords]) => ({
        tag,
        matchedKeywords: keywords.filter(keyword => compact.includes(keyword)),
      }))
      .filter(item => item.matchedKeywords.length > 0)
    const hasHypertension = matchedMeta.some(item => item.tag === '高血压')
    const filtered = matchedMeta.filter(item => !(hasHypertension && item.tag === '血压波动'))
    const matched = filtered.map(item => item.tag)
    const matchedKeywordList = filtered.reduce((all, item) => all.concat(item.matchedKeywords), [])
    const fallbackTags = text
      .split(/[，。,、；;！!？?\n]/)
      .map(item => stripLeadingSpeechParticles(item))
      .filter(Boolean)
      .filter(item => !isLowInfoSpeechParticle(item))
      .filter(item => !matchedKeywordList.some(keyword => item.includes(keyword)))
      .map(item => (item.length > 8 ? `${item.slice(0, 8)}...` : item))
    return uniqTags([].concat(matched, fallbackTags))
  }
  try {
    return require('../../utils/shared-rules')
  } catch (err) {
    return { extractHealthTags, normalizeInterestTags, uniqTags }
  }
})()
const { extractHealthTags, normalizeInterestTags, uniqTags } = sharedRules

Page({
  data: {
    // 老人信息
    elderName: '',
    elderEmoji: '👩',
    elderInitial: '亲',
    // 最近通话
    lastCallTime: '',
    lastMood: '',
    lastMoodLabel: '',
    lastMoodClass: 'mood-calm',
    hasCallHistory: false,
    // 统计
    totalCalls: 0,
    totalDurationText: '0秒',
    // 兴趣信号
    interestTags: [],
    hasSignal: false,
    // 健康信号
    healthTags: [],
    hasHealthSignal: false,
    // 预警
    hasWarning: false,
    // 是否已配置
    configured: false,
  },

  onShow() {
    const config = store.getElderConfig()
    if (!config) {
      wx.navigateTo({
        url: '/pages/onboarding/onboarding'
      })
      return
    }

    this.setData({ configured: true })
    this._loadElderInfo(config)
    this._loadCallHistory()
    this._loadProfile()
    this._armSummaryRefreshIfNeeded()
  },

  onHide() {
    this._clearSummaryRefreshTimer()
  },

  onUnload() {
    this._clearSummaryRefreshTimer()
  },

  // 加载老人基本信息
  _loadElderInfo(config) {
    const elderName = config.parentName || '未设置'
    this.setData({
      elderName,
      elderInitial: elderName && elderName !== '未设置' ? elderName.slice(0, 1) : '亲',
    })
  },

  // 加载通话记录相关数据
  _loadCallHistory() {
    const history = store.getCallHistory()
    const totalDurationSeconds = history.reduce((sum, item) => {
      if (typeof item.durationSeconds === 'number' && item.durationSeconds >= 0) {
        return sum + item.durationSeconds
      }
      return sum + this._parseDurationToSeconds(item.duration)
    }, 0)
    if (history.length > 0) {
      const latest = history[0]
      const moodLabel = latest.summaryStatus === 'pending'
        ? '分析中'
        : (latest.moodLabel || '平静')
      const mood = latest.summaryStatus === 'pending'
        ? '⏳'
        : (latest.mood || '😌')
      const moodClassMap = {
        开心: 'mood-happy',
        平静: 'mood-calm',
        低落: 'mood-low',
        焦虑: 'mood-anxious',
        分析中: 'mood-pending',
      }
      this.setData({
        hasCallHistory: true,
        lastCallTime: '上次通话：' + (latest.date || '未知'),
        lastMood: mood,
        lastMoodLabel: moodLabel,
        lastMoodClass: moodClassMap[moodLabel] || 'mood-calm',
        totalCalls: history.length,
        totalDurationText: this._formatDuration(totalDurationSeconds),
      })
    } else {
      this.setData({
        hasCallHistory: false,
        lastCallTime: '还没有通话记录',
        lastMood: '',
        lastMoodLabel: '',
        lastMoodClass: 'mood-calm',
        totalCalls: 0,
        totalDurationText: '0秒',
      })
    }
  },

  _armSummaryRefreshIfNeeded() {
    this._clearSummaryRefreshTimer()
    const history = store.getCallHistory()
    const latest = history[0]
    if (!latest || latest.summaryStatus !== 'pending') return
    let tickCount = 0
    this.summaryRefreshTimer = setInterval(() => {
      tickCount += 1
      this._loadCallHistory()
      const refreshed = store.getCallHistory()[0]
      if (!refreshed || refreshed.summaryStatus !== 'pending' || tickCount >= 10) {
        this._clearSummaryRefreshTimer()
      }
    }, 2000)
  },

  _clearSummaryRefreshTimer() {
    if (this.summaryRefreshTimer) {
      clearInterval(this.summaryRefreshTimer)
      this.summaryRefreshTimer = null
    }
  },

  // 加载档案信息（兴趣等）
  _loadProfile() {
    const config = store.getElderConfig() || {}
    const profile = store.getProfile()
    const elderKey = store.getElderKey ? store.getElderKey(config) : ''
    const memoryBundle = store.getMemoryBundle ? store.getMemoryBundle(elderKey) : null
    const elderMemory = memoryBundle && memoryBundle.elderMemory
      ? memoryBundle.elderMemory
      : {}
    const memoryItems = memoryBundle && Array.isArray(memoryBundle.memoryItems)
      ? memoryBundle.memoryItems
      : []
    const memoryHealthNotes = elderMemory.healthNotes || []
    const memoryInterestTags = elderMemory.interestTags || []
    const memoryItemInterestTags = memoryItems
      .filter(item => item && item.type === 'interest')
      .map(item => item.text)
    const memoryItemHealthNotes = memoryItems
      .filter(item => item && item.type === 'healthNote')
      .map(item => item.text)
    const hobbies = []
      .concat(profile.hobbies || [])
      .concat(memoryInterestTags)
      .concat(memoryItemInterestTags)
    const healthSources = []
      .concat(config.health || '')
      .concat(profile.health || '')
      .concat(memoryHealthNotes)
      .concat(memoryItemHealthNotes)
      .filter(Boolean)
    const extractedHealthTags = healthSources.reduce((all, source) => all.concat(extractHealthTags(source)), [])

    const interestTags = this._normalizeInterestTags(hobbies).slice(0, 6)
    const healthTags = uniqTags(extractedHealthTags).slice(0, 6)

    this.setData({
      hasSignal: interestTags.length > 0,
      interestTags,
      hasHealthSignal: healthTags.length > 0,
      healthTags,
    })
  },

  goCall() {
    wx.navigateTo({
      url: '/pages/call/call'
    })
  },

  goReminders() {
    wx.switchTab({
      url: '/pages/reminders/reminders',
    })
  },

  goSimulatedIncoming() {
    const elderKey = store.getElderKey()
    const picked = store.pickNextIncomingReminder(elderKey)
    const query = ['mode=incoming', 'triggerSource=manual']
    if (picked) {
      query.push(`reminderId=${encodeURIComponent(picked.id)}`)
      query.push(`reminderText=${encodeURIComponent(picked.title || '')}`)
    }
    wx.navigateTo({
      url: `/pages/call/call?${query.join('&')}`,
    })
  },

  _parseDurationToSeconds(durationText) {
    if (!durationText) return 0
    const text = String(durationText)
    const hourMatch = text.match(/(\d+)\s*小时/)
    const minuteMatch = text.match(/(\d+)\s*分/)
    const secondMatch = text.match(/(\d+)\s*秒/)
    const hours = hourMatch ? Number(hourMatch[1]) : 0
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0
    const seconds = secondMatch ? Number(secondMatch[1]) : 0
    const total = hours * 3600 + minutes * 60 + seconds
    return Number.isFinite(total) ? total : 0
  },

  _formatDuration(totalSeconds) {
    const safeSeconds = Math.max(0, Number(totalSeconds) || 0)
    const hours = Math.floor(safeSeconds / 3600)
    const minutes = Math.floor((safeSeconds % 3600) / 60)
    const seconds = safeSeconds % 60
    if (hours > 0) return `${hours}时${minutes}分`
    if (minutes > 0) return `${minutes}分${seconds}秒`
    return `${seconds}秒`
  },

  _extractHealthTags(healthText) {
    return extractHealthTags(healthText)
  },

  _normalizeInterestTags(tags) {
    const source = []
      .concat(tags || [])
      .map(tag => String(tag || '').trim())
      .filter(Boolean)
    const normalized = []

    source.forEach(text => {
      const compact = text.replace(/\s+/g, '')
      if (!compact) return

      // 更贴近原话：提到“广场舞”时统一展示“广场舞”，否则“跳舞/舞蹈”展示“跳舞”
      if (compact.includes('广场舞')) {
        normalized.push('广场舞')
      } else if (compact.includes('跳舞') || compact.includes('舞蹈')) {
        normalized.push('跳舞')
      } else {
        normalized.push(text)
      }
    })

    return normalizeInterestTags(normalized)
  },

  _uniqTags(tags) {
    return uniqTags(tags)
  },
})
