/**
 * 本地数据管理
 * MVP 阶段使用 wx.getStorageSync，后续迁移到云数据库
 */

const KEYS = {
  ELDER_CONFIG: 'elderConfig',
  DIALOG_ID: 'dialogId',
  DIALOG_ID_MAP: 'dialogIdMap',
  CALL_HISTORY: 'callHistory',
  PROFILE: 'elderProfile',
  MEMORY_MAP: 'elderMemoryMap',
  REMINDER_MAP: 'elderReminderMap',
  GREETING_COOLDOWN_MAP: 'greetingCooldownMap',
}

const REMINDER_STATUS = {
  CANDIDATE: 'candidate',
  PENDING: 'pending',
  TRIGGERED: 'triggered',
  DONE: 'done',
}

const MEMORY_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
}

const MEMORY_VISIBILITY = {
  ASSISTANT: 'assistant',
  GUARDIAN_REVIEW: 'guardian_review',
  PRIVATE: 'private',
}

const DEFAULT_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000
const DEFAULT_GREETING_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

function _safeGetApp() {
  try {
    return getApp()
  } catch (err) {
    return null
  }
}

function _normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function _uniqList(items, maxCount) {
  const seen = new Set()
  const result = []
  ;(items || []).forEach(item => {
    const text = String(item || '').trim()
    if (!text || seen.has(text)) return
    seen.add(text)
    result.push(text)
  })
  if (typeof maxCount === 'number' && maxCount > 0) {
    return result.slice(0, maxCount)
  }
  return result
}

function getDefaultMemoryBundle() {
  return {
    elderMemory: {
      healthNotes: [],
      interestTags: [],
      routineNotes: [],
      recentEvents: [],
      moodTrend: 'stable',
      lastUpdatedAt: '',
    },
    xiaolinMemory: {
      preferredAddress: '',
      tabooTopics: [],
      followUps: [],
      responseStyle: '',
      careStrategies: [],
      lastUpdatedAt: '',
      memoryUpdatedAt: '',
    },
    memoryMeta: {
      version: 2,
      updatedFromCallId: '',
      memoryUpdatedAt: '',
      usageLog: [],
    },
    memoryItems: [],
  }
}

const MEMORY_TYPE_LIMIT = {
  followUp: 10,
  recentEvent: 12,
  routineNote: 10,
  interest: 20,
  healthNote: 10,
  tabooTopic: 10,
}

const MEMORY_TYPE_CONFIDENCE = {
  followUp: 0.75,
  recentEvent: 0.7,
  routineNote: 0.7,
  interest: 0.72,
  healthNote: 0.8,
  tabooTopic: 0.85,
}

function _normalizeMemoryText(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[。！？!?,，、；;]+$/g, '')
}

function _isLowInfoMemoryText(text) {
  const line = _normalizeMemoryText(text)
  if (!line) return true
  if (line.length <= 3) return true

  const lowInfoSet = new Set([
    '还不错', '挺好', '很好', '还好', '一般', '就那样', '可以', '行', '嗯', '嗯嗯', '哦', '好的',
    '没事', '没什么', '都好', '还行', '可以的', '还可以', '是的', '对', '对的', '好'
  ])
  if (lowInfoSet.has(line)) return true
  if (/^(挺|还|就)?(好|行|可以|不错)$/.test(line)) return true
  if (/^(过得|日子|最近)?(还|挺|就)?(行|还行|一般|凑合|那样)(吧|呢|呀)?$/.test(line)) return true
  if (/^(没有|没)(呢|呀|啊)?([，,、]?)(没有|没)?(出去|出门|外出)?(玩|逛|活动)?$/.test(line)) return true
  if (/^(没有|没)(什么|啥)?(特别|安排|计划|进展)?(的)?$/.test(line)) return true
  return false
}

function _memoryItemId(type, text) {
  const base = `${type}:${_normalizeMemoryText(text)}`
  return `mem_${Date.now()}_${base.slice(0, 24)}`
}

function _normalizeMemoryType(type) {
  const raw = String(type || '').trim()
  const aliasMap = {
    health: 'healthNote',
    health_note: 'healthNote',
    healthNote: 'healthNote',
    interest: 'interest',
    hobby: 'interest',
    recent_event: 'recentEvent',
    recentEvent: 'recentEvent',
    event: 'recentEvent',
    routine: 'routineNote',
    routine_note: 'routineNote',
    routineNote: 'routineNote',
    follow_up: 'followUp',
    followUp: 'followUp',
    taboo: 'tabooTopic',
    taboo_topic: 'tabooTopic',
    tabooTopic: 'tabooTopic',
  }
  return aliasMap[raw] || 'recentEvent'
}

function _normalizeMemoryStringList(items, maxCount) {
  return _uniqList([].concat(items || []), maxCount)
}

function _normalizeMemorySourceMeta(source, now) {
  const isObject = source && typeof source === 'object'
  const meta = isObject ? source : { source }
  const sourceName = String(meta.source || (isObject ? 'summary' : source) || 'summary').trim() || 'summary'
  return {
    source: sourceName,
    sourceCallId: String(meta.sourceCallId || meta.callId || '').trim(),
    sourceTurnId: String(meta.sourceTurnId || meta.turnId || '').trim(),
    observedAt: String(meta.observedAt || now || '').trim(),
    validFrom: String(meta.validFrom || '').trim(),
    validTo: String(meta.validTo || '').trim(),
    expiresAt: String(meta.expiresAt || '').trim(),
    visibility: String(meta.visibility || '').trim(),
    contradicts: _normalizeMemoryStringList(meta.contradicts || [], 8),
  }
}

function _resolveMemoryVisibility(type, sensitivity, visibility) {
  const explicit = String(visibility || '').trim()
  if (explicit === MEMORY_VISIBILITY.ASSISTANT
    || explicit === MEMORY_VISIBILITY.GUARDIAN_REVIEW
    || explicit === MEMORY_VISIBILITY.PRIVATE) {
    return explicit
  }
  if (sensitivity === 'sensitive' || type === 'healthNote') {
    return MEMORY_VISIBILITY.GUARDIAN_REVIEW
  }
  return MEMORY_VISIBILITY.ASSISTANT
}

function _normalizeMemoryStatus(item, type, confidence, sensitivity, source) {
  const rawStatus = String(item && item.status || '').trim()
  if (rawStatus === MEMORY_STATUS.PENDING
    || rawStatus === MEMORY_STATUS.CONFIRMED
    || rawStatus === MEMORY_STATUS.REJECTED) {
    return rawStatus
  }
  return _shouldMemoryPendingConfirm(type, confidence, sensitivity, source)
    ? MEMORY_STATUS.PENDING
    : MEMORY_STATUS.CONFIRMED
}

function _buildMemoryItem(type, text, source, confidence, now, evidence) {
  const cleanText = _normalizeMemoryText(text)
  if (!cleanText) return null
  const normalizedType = _normalizeMemoryType(type)
  const meta = _normalizeMemorySourceMeta(source, now)
  const safeConfidence = Math.max(0, Math.min(1, Number(confidence || 0.6)))
  const nowTs = Date.parse(now || '') || Date.now()
  const sensitivity = _resolveMemorySensitivity(normalizedType, safeConfidence)
  const shouldPendingConfirm = _shouldMemoryPendingConfirm(normalizedType, safeConfidence, sensitivity, meta.source)
  return {
    id: _memoryItemId(type, cleanText),
    type: normalizedType,
    text: cleanText,
    source: meta.source,
    sourceCallId: meta.sourceCallId,
    sourceTurnId: meta.sourceTurnId,
    observedAt: meta.observedAt || now,
    validFrom: meta.validFrom,
    validTo: meta.validTo,
    expiresAt: meta.expiresAt,
    confidence: safeConfidence,
    layer: _resolveMemoryLayer(normalizedType),
    stability: normalizedType === 'interest' || normalizedType === 'healthNote' ? 'stable' : 'semi_stable',
    sensitivity: sensitivity,
    visibility: _resolveMemoryVisibility(normalizedType, sensitivity, meta.visibility),
    status: shouldPendingConfirm ? MEMORY_STATUS.PENDING : MEMORY_STATUS.CONFIRMED,
    needsConfirmation: shouldPendingConfirm,
    confirmedAt: shouldPendingConfirm ? '' : now,
    lastConfirmedAt: '',
    createdAt: now,
    updatedAt: now,
    lastUsedAt: '',
    triggerCount: 0,
    score: _computeMemoryScore({
      confidence: safeConfidence,
      createdAt: now,
      lastUsedAt: '',
      triggerCount: 0,
    }, nowTs),
    evidence: evidence || cleanText,
    contradicts: meta.contradicts,
  }
}

function _isRecent(iso, days) {
  if (!iso) return false
  const ts = Date.parse(iso)
  if (!ts) return false
  const ageMs = Date.now() - ts
  return ageMs <= days * 24 * 60 * 60 * 1000
}

function _resolveMemoryLayer(type) {
  if (type === 'healthNote') return 'health'
  if (type === 'followUp' || type === 'recentEvent') return 'event'
  if (type === 'routineNote') return 'routine'
  if (type === 'interest') return 'persona'
  if (type === 'tabooTopic') return 'ai_strategy'
  return 'event'
}

function _resolveMemorySensitivity(type, confidence) {
  if (type !== 'healthNote') return 'normal'
  return Number(confidence || 0) >= 0.85 ? 'sensitive' : 'normal'
}

function _shouldMemoryPendingConfirm(type, confidence, sensitivity, source) {
  if (source === 'onboarding') return false
  if (type === 'healthNote') return true
  if (sensitivity === 'sensitive') return true
  return Number(confidence || 0) < 0.7
}

function _computeRecencyWeight(createdAt, nowTs) {
  const createdTs = Date.parse(createdAt || '')
  if (!createdTs) return 0.8
  const ageDays = Math.max(0, (nowTs - createdTs) / (24 * 60 * 60 * 1000))
  if (ageDays <= 3) return 1
  if (ageDays <= 14) return 0.85
  if (ageDays <= 45) return 0.65
  return 0.45
}

function _computeReuseWeight(lastUsedAt, triggerCount, nowTs) {
  const usedTs = Date.parse(lastUsedAt || '')
  let base = 0.9
  if (usedTs) {
    const ageDays = Math.max(0, (nowTs - usedTs) / (24 * 60 * 60 * 1000))
    if (ageDays <= 2) base = 1
    else if (ageDays <= 14) base = 0.9
    else base = 0.75
  }
  const countBoost = Math.min(0.12, (Number(triggerCount || 0) || 0) * 0.02)
  return Math.min(1.15, base + countBoost)
}

function _computeMemoryScore(item, nowTs) {
  const confidence = Math.max(0.2, Math.min(1, Number(item.confidence || 0.6)))
  const recencyWeight = _computeRecencyWeight(item.createdAt, nowTs)
  const reuseWeight = _computeReuseWeight(item.lastUsedAt, item.triggerCount, nowTs)
  const score = confidence * recencyWeight * reuseWeight
  return Number(score.toFixed(4))
}

function _isTrustedDialogueMemory(item) {
  if (!item || !item.text) return false
  if (item.status !== MEMORY_STATUS.CONFIRMED) return false
  if (item.needsConfirmation === true) return false
  const visibility = String(item.visibility || '').trim()
  if (visibility === MEMORY_VISIBILITY.PRIVATE) return false
  if (visibility
    && visibility !== MEMORY_VISIBILITY.ASSISTANT
    && visibility !== MEMORY_VISIBILITY.GUARDIAN_REVIEW) {
    return false
  }
  return true
}

function _normalizeMemoryPurpose(purpose) {
  const raw = String(purpose || '').trim()
  if (raw === 'rag' || raw === 'greeting' || raw === 'constraint' || raw === 'steer') return raw
  return 'dialogue'
}

function _extractRecallTokens(text) {
  const normalized = _normalizeMemoryText(text)
  if (!normalized) return []
  const tokens = []
  if (normalized.length <= 4) tokens.push(normalized)
  for (let i = 0; i < normalized.length - 1; i++) {
    tokens.push(normalized.slice(i, i + 2))
  }
  for (let i = 0; i < normalized.length - 2; i++) {
    tokens.push(normalized.slice(i, i + 3))
  }
  return tokens
}

function _computeLexicalRelevance(queryText, item) {
  const query = _normalizeMemoryText(queryText)
  const target = _normalizeMemoryText(`${(item && item.text) || ''} ${(item && item.evidence) || ''}`)
  if (!query || !target) return 0
  if (query.includes(target) || target.includes(query)) return 1
  const queryTokens = new Set(_extractRecallTokens(query))
  const targetTokens = _extractRecallTokens(target)
  if (queryTokens.size === 0 || targetTokens.length === 0) return 0
  const seen = new Set()
  let hit = 0
  targetTokens.forEach(token => {
    if (seen.has(token)) return
    seen.add(token)
    if (queryTokens.has(token)) hit += 1
  })
  return hit / Math.max(seen.size, 1)
}

function _shouldRequireTopicMatch(intent, currentUserText, purpose) {
  if (purpose === 'constraint' || purpose === 'greeting') return false
  if (!currentUserText) return false
  return intent === 'general'
}

function _isMemoryCurrentlyValid(item, nowTs) {
  const validFromTs = Date.parse(item && item.validFrom || '')
  if (validFromTs && validFromTs > nowTs) return false
  const validToTs = Date.parse(item && item.validTo || '')
  if (validToTs && validToTs < nowTs) return false
  const expiresTs = Date.parse(item && item.expiresAt || '')
  if (expiresTs && expiresTs < nowTs) return false
  return true
}

function _formatMemoryItemForPrompt(item) {
  if (!item || !item.text) return ''
  if (item.type === 'followUp') {
    return `上次承诺跟进：${item.text}`
  }
  if (item.type === 'recentEvent') {
    return `老人近期事件：${item.text}`
  }
  if (item.type === 'routineNote') {
    return `老人日常习惯：${item.text}`
  }
  if (item.type === 'interest') {
    return `老人兴趣：${item.text}`
  }
  if (item.type === 'healthNote') {
    return `健康背景（已确认，仅相关时提及）：${item.text}`
  }
  if (item.type === 'tabooTopic') {
    return `慎提话题：${item.text}`
  }
  return `记忆：${item.text}`
}

function _inferMemoryContextIntent(options) {
  const opts = options || {}
  if (opts.intent) return String(opts.intent)
  const text = _normalizeMemoryText(opts.currentUserText || '')
  if (/(胸闷|胸痛|头晕|不舒服|难受|血压|血糖|吃药|复查|复诊|医院|医生|睡眠|失眠)/.test(text)) {
    return 'healthConcern'
  }
  if (/(提醒|记得|别忘|完成了吗|办好了吗|起床|测血压)/.test(text)) {
    return 'reminderFollowup'
  }
  if (/(聊聊|聊天|说说话|没啥事|没什么事)/.test(text)) {
    return 'smallTalk'
  }
  return 'general'
}

function _resolveMemoryContextBudget(intent, typeBudget) {
  const base = {
    followUp: 1,
    recentEvent: 1,
    routineNote: 0,
    interest: 1,
    healthNote: 0,
    tabooTopic: 0,
  }
  const intentName = String(intent || 'general')
  if (intentName === 'healthConcern') {
    Object.assign(base, {
      followUp: 1,
      recentEvent: 1,
      routineNote: 1,
      interest: 0,
      healthNote: 2,
      tabooTopic: 1,
    })
  } else if (intentName === 'smallTalk') {
    Object.assign(base, {
      followUp: 1,
      recentEvent: 1,
      routineNote: 1,
      interest: 2,
      healthNote: 0,
      tabooTopic: 1,
    })
  } else if (intentName === 'reminderFollowup') {
    Object.assign(base, {
      followUp: 0,
      recentEvent: 0,
      routineNote: 0,
      interest: 0,
      healthNote: 0,
      tabooTopic: 1,
    })
  } else if (intentName === 'profileReview') {
    Object.assign(base, {
      followUp: 2,
      recentEvent: 3,
      routineNote: 3,
      interest: 4,
      healthNote: 3,
      tabooTopic: 3,
    })
  } else if (intentName === 'opening' || intentName === 'outgoingNeed' || intentName === 'greeting') {
    Object.assign(base, {
      followUp: 1,
      recentEvent: 1,
      routineNote: 0,
      interest: 1,
      healthNote: 0,
      tabooTopic: 0,
    })
  }
  return Object.assign(base, typeBudget || {})
}

function _selectMemoryItemsForContext(bundle, options) {
  const opts = options || {}
  const purpose = _normalizeMemoryPurpose(opts.purpose)
  const excludeSet = new Set((opts.excludeTexts || []).map(_normalizeMemoryText).filter(Boolean))
  const maxItems = typeof opts.maxItems === 'number' ? opts.maxItems : 2
  const minConfidence = typeof opts.minConfidence === 'number' ? opts.minConfidence : 0.6
  const cooldownMs = typeof opts.cooldownMs === 'number' ? opts.cooldownMs : 12 * 60 * 60 * 1000
  const intent = _inferMemoryContextIntent(opts)
  const currentUserText = opts.currentUserText || ''
  let typeBudget = _resolveMemoryContextBudget(intent, opts.typeBudget)
  if (purpose === 'constraint') {
    typeBudget = Object.assign({
      followUp: 0,
      recentEvent: 0,
      routineNote: 0,
      interest: 0,
      healthNote: 0,
      tabooTopic: 2,
    }, opts.typeBudget || {})
  } else if (purpose === 'rag' || purpose === 'steer' || purpose === 'greeting') {
    typeBudget = Object.assign({}, typeBudget, { tabooTopic: 0 }, opts.typeBudget || {})
  }
  if (purpose === 'greeting') {
    typeBudget = Object.assign({}, typeBudget, { healthNote: 0, tabooTopic: 0 }, opts.typeBudget || {})
  }
  const requireTopicMatch = typeof opts.requireTopicMatch === 'boolean'
    ? opts.requireTopicMatch
    : _shouldRequireTopicMatch(intent, currentUserText, purpose)
  const nowTs = Date.now()
  const pickedTypes = {}
  const typeRank = { tabooTopic: 6, followUp: 5, recentEvent: 4, routineNote: 3, interest: 2, healthNote: 1 }

  return (bundle.memoryItems || [])
    .filter(_isTrustedDialogueMemory)
    .filter(item => item.type === 'interest' || item.type === 'tabooTopic' || !_isLowInfoMemoryText(item.text))
    .filter(item => Number(item.confidence || 0) >= minConfidence)
    .filter(item => !excludeSet.has(_normalizeMemoryText(item.text)))
    .filter(item => _isMemoryCurrentlyValid(item, nowTs))
    .filter(item => {
      if (!item.lastUsedAt) return true
      const usedTs = Date.parse(item.lastUsedAt)
      if (!usedTs) return true
      return nowTs - usedTs >= cooldownMs
    })
    .filter(item => {
      if (item.type === 'interest' || item.type === 'healthNote' || item.type === 'tabooTopic' || item.type === 'routineNote') return true
      return _isRecent(item.createdAt, 45)
    })
    .map(item => {
      const lexical = _computeLexicalRelevance(currentUserText, item)
      const memoryScore = Number(item.score || _computeMemoryScore(item, nowTs))
      const typeBoost = (typeRank[item.type] || 0) / 6
      return Object.assign({}, item, {
        lexical,
        hybridScore: Number((0.45 * memoryScore + 0.4 * lexical + 0.15 * typeBoost).toFixed(4)),
      })
    })
    .filter(item => !requireTopicMatch || item.lexical >= 0.12)
    .sort((a, b) => {
      if (requireTopicMatch || currentUserText) {
        if (b.hybridScore !== a.hybridScore) return b.hybridScore - a.hybridScore
      }
      const ar = typeRank[a.type] || 0
      const br = typeRank[b.type] || 0
      if (br !== ar) return br - ar
      if (b.hybridScore !== a.hybridScore) return b.hybridScore - a.hybridScore
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      return Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '')
    })
    .filter(item => {
      const budget = Number(typeBudget[item.type] || 0)
      if (budget <= 0) return false
      if (!pickedTypes[item.type]) pickedTypes[item.type] = 0
      if (pickedTypes[item.type] >= budget) return false
      pickedTypes[item.type] += 1
      return true
    })
    .slice(0, maxItems)
}

function _mergeMemoryItems(existingItems, deltaItems) {
  const now = new Date().toISOString()
  const nowTs = Date.now()
  const allItems = []
    .concat(existingItems || [])
    .concat(deltaItems || [])
    .filter(Boolean)

  const mergedMap = {}
  allItems.forEach(item => {
    const type = _normalizeMemoryType(item.type)
    const text = _normalizeMemoryText(item.text)
    if (!text) return
    const key = `${type}:${text}`
    const safeConfidence = Math.max(0, Math.min(1, Number(item.confidence || MEMORY_TYPE_CONFIDENCE[type] || 0.6)))
    const sourceMeta = _normalizeMemorySourceMeta({
      source: item.source || 'summary',
      sourceCallId: item.sourceCallId || item.callId || '',
      sourceTurnId: item.sourceTurnId || item.turnId || '',
      observedAt: item.observedAt || item.createdAt || now,
      validFrom: item.validFrom || '',
      validTo: item.validTo || '',
      expiresAt: item.expiresAt || '',
      visibility: item.visibility || '',
      contradicts: item.contradicts || [],
    }, now)
    const sensitivity = item.sensitivity || _resolveMemorySensitivity(type, safeConfidence)
    const status = _normalizeMemoryStatus(item, type, safeConfidence, sensitivity, sourceMeta.source)
    const normalizedItem = Object.assign({}, item, {
      id: item.id || _memoryItemId(type, text),
      type,
      text,
      confidence: safeConfidence,
      layer: item.layer || _resolveMemoryLayer(type),
      source: sourceMeta.source,
      sourceCallId: sourceMeta.sourceCallId,
      sourceTurnId: sourceMeta.sourceTurnId,
      observedAt: sourceMeta.observedAt,
      validFrom: sourceMeta.validFrom,
      validTo: sourceMeta.validTo,
      expiresAt: sourceMeta.expiresAt,
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now,
      lastUsedAt: item.lastUsedAt || '',
      triggerCount: Number(item.triggerCount || 0) || 0,
      stability: item.stability || (type === 'interest' || type === 'healthNote' ? 'stable' : 'semi_stable'),
      sensitivity,
      visibility: _resolveMemoryVisibility(type, sensitivity, sourceMeta.visibility),
      status,
      needsConfirmation: typeof item.needsConfirmation === 'boolean'
        ? item.needsConfirmation
        : status === MEMORY_STATUS.PENDING,
      confirmedAt: item.confirmedAt || '',
      lastConfirmedAt: item.lastConfirmedAt || '',
      evidence: item.evidence || text,
      contradicts: sourceMeta.contradicts,
    })
    normalizedItem.score = _computeMemoryScore(normalizedItem, nowTs)
    const current = mergedMap[key]
    if (!current) {
      mergedMap[key] = normalizedItem
      return
    }
    if (current.status === MEMORY_STATUS.CONFIRMED && normalizedItem.status !== MEMORY_STATUS.CONFIRMED) {
      return
    }
    if (current.status !== MEMORY_STATUS.CONFIRMED && normalizedItem.status === MEMORY_STATUS.CONFIRMED) {
      mergedMap[key] = normalizedItem
      return
    }
    // 冲突时优先保留高置信度版本，并补齐最近使用时间
    if (normalizedItem.confidence > current.confidence) {
      mergedMap[key] = Object.assign({}, current, normalizedItem, {
        lastUsedAt: current.lastUsedAt || normalizedItem.lastUsedAt || '',
      })
      return
    }
    if (!current.lastUsedAt && normalizedItem.lastUsedAt) {
      current.lastUsedAt = normalizedItem.lastUsedAt
    }
    if (!current.sourceCallId && normalizedItem.sourceCallId) {
      current.sourceCallId = normalizedItem.sourceCallId
    }
    if (!current.evidence && normalizedItem.evidence) {
      current.evidence = normalizedItem.evidence
    }
  })

  const byType = {}
  Object.keys(mergedMap).forEach(key => {
    const item = mergedMap[key]
    if (!byType[item.type]) byType[item.type] = []
    byType[item.type].push(item)
  })

  const result = []
  Object.keys(byType).forEach(type => {
    const limit = MEMORY_TYPE_LIMIT[type] || 10
    const sorted = byType[type].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      return Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '')
    })
    result.push.apply(result, sorted.slice(0, limit))
  })
  return result
}

function _buildItemsFromLegacy(bundle) {
  const now = new Date().toISOString()
  const elderMemory = bundle.elderMemory || {}
  const xiaolinMemory = bundle.xiaolinMemory || {}
  const items = []
  ;(elderMemory.recentEvents || []).forEach(text => {
    const item = _buildMemoryItem('recentEvent', text, 'legacy', 0.65, now, text)
    if (item) items.push(item)
  })
  ;(elderMemory.interestTags || []).forEach(text => {
    const item = _buildMemoryItem('interest', text, 'legacy', 0.65, now, text)
    if (item) items.push(item)
  })
  ;(elderMemory.healthNotes || []).forEach(text => {
    const item = _buildMemoryItem('healthNote', text, 'legacy', 0.8, now, text)
    if (item) items.push(item)
  })
  ;(elderMemory.routineNotes || []).forEach(text => {
    const item = _buildMemoryItem('routineNote', text, 'legacy', 0.7, now, text)
    if (item) items.push(item)
  })
  ;(xiaolinMemory.followUps || []).forEach(text => {
    const item = _buildMemoryItem('followUp', text, 'legacy', 0.7, now, text)
    if (item) items.push(item)
  })
  ;(xiaolinMemory.tabooTopics || []).forEach(text => {
    const item = _buildMemoryItem('tabooTopic', text, 'legacy', 0.8, now, text)
    if (item) items.push(item)
  })
  return _mergeMemoryItems([], items)
}

function getElderKey(config) {
  const elderConfig = config || getElderConfig()
  if (!elderConfig) return 'elder:default'

  const namePart = _normalizeName(elderConfig.parentName) || 'unknown'
  const phonePart = String(elderConfig.phone || '')
    .replace(/[^\d]/g, '')
    .slice(-4) || '0000'
  return `elder:${namePart}:${phonePart}`
}

/**
 * 获取老人配置
 */
function getElderConfig() {
  return wx.getStorageSync(KEYS.ELDER_CONFIG) || null
}

/**
 * 保存老人配置
 * @param {object} config - { parentName, phone, titleSuffix, role }
 */
function saveElderConfig(config) {
  wx.setStorageSync(KEYS.ELDER_CONFIG, config)
  const app = _safeGetApp()
  if (app) app.globalData.elderConfig = config
}

/**
 * 获取小林对老人的称呼
 */
function getElderTitle() {
  const config = getElderConfig()
  if (!config) return ''
  const surname = (config.parentName || '').trim().charAt(0)
  return surname ? `${surname}${config.titleSuffix}` : config.titleSuffix
}

/**
 * 获取 dialog_id（跨通话记忆）
 */
function getDialogId(elderKey) {
  const scopedKey = elderKey || getElderKey()
  const map = wx.getStorageSync(KEYS.DIALOG_ID_MAP) || {}
  if (map[scopedKey]) return map[scopedKey]

  // 兼容旧版本单值 dialogId
  if (scopedKey === 'elder:default') {
    return wx.getStorageSync(KEYS.DIALOG_ID) || ''
  }
  return ''
}

function saveDialogId(id, elderKey) {
  const scopedKey = elderKey || getElderKey()
  const map = wx.getStorageSync(KEYS.DIALOG_ID_MAP) || {}
  map[scopedKey] = id
  wx.setStorageSync(KEYS.DIALOG_ID_MAP, map)

  // 保留旧 key，兼容历史读取
  wx.setStorageSync(KEYS.DIALOG_ID, id)
  const app = _safeGetApp()
  if (app) app.globalData.dialogId = id
}

function clearDialogId(elderKey) {
  const scopedKey = elderKey || getElderKey()
  const map = wx.getStorageSync(KEYS.DIALOG_ID_MAP) || {}
  delete map[scopedKey]
  wx.setStorageSync(KEYS.DIALOG_ID_MAP, map)
}

/**
 * 通话记录管理
 */
function getCallHistory() {
  return wx.getStorageSync(KEYS.CALL_HISTORY) || []
}

function addCallRecord(record) {
  const history = getCallHistory()
  history.unshift(record)
  wx.setStorageSync(KEYS.CALL_HISTORY, history)
  const app = _safeGetApp()
  if (app) app.globalData.callHistory = history
}

function updateCallRecord(callId, updates) {
  const history = getCallHistory()
  const idx = history.findIndex(record => record.id === callId)
  if (idx < 0) return false

  history[idx] = Object.assign({}, history[idx], updates)
  wx.setStorageSync(KEYS.CALL_HISTORY, history)

  const app = _safeGetApp()
  if (app) app.globalData.callHistory = history
  return true
}

function _getMemoryMap() {
  return wx.getStorageSync(KEYS.MEMORY_MAP) || {}
}

function _saveMemoryMap(memoryMap) {
  wx.setStorageSync(KEYS.MEMORY_MAP, memoryMap)
}

function _getReminderMap() {
  return wx.getStorageSync(KEYS.REMINDER_MAP) || {}
}

function _saveReminderMap(reminderMap) {
  wx.setStorageSync(KEYS.REMINDER_MAP, reminderMap)
}

function _getGreetingCooldownMap() {
  return wx.getStorageSync(KEYS.GREETING_COOLDOWN_MAP) || {}
}

function _saveGreetingCooldownMap(map) {
  wx.setStorageSync(KEYS.GREETING_COOLDOWN_MAP, map)
}

function _normalizeReminderText(text) {
  return String(text || '').trim()
}

function _stripTrailingSpeechParticles(text) {
  let result = _normalizeReminderText(text)
  let changed = true
  while (changed) {
    const before = result
    result = result
      .replace(/[。！？!?,，、；;\s]+$/g, '')
      .replace(/(?:吧|啦|啊|呀|呢|嘛|咯|喽)$/u, '')
      .replace(/[。！？!?,，、；;\s]+$/g, '')
      .trim()
    changed = result !== before
  }
  return result
}

function _sliceFromReminderTrigger(text) {
  const raw = _normalizeReminderText(text)
  if (!raw) return ''
  const triggerPattern = /(记得提醒我|提醒我一下|提醒一下我|提醒我|提醒一下|提醒下我|提醒下|帮我提醒|帮忙提醒|帮提醒|叫我|告诉我|通知我)/
  const match = raw.match(triggerPattern)
  if (!match || typeof match.index !== 'number') return raw
  return raw.slice(match.index)
}

function _normalizeReminderTitle(text) {
  const raw = _sliceFromReminderTrigger(text)
  if (!raw) return ''

  // 先去掉“提醒我/记得提醒我”等第一人称提醒前缀
  let title = raw
    .replace(/^[，。！？、\s]+/, '')

  // 去掉“提醒张叔叔/提醒王阿姨”等称呼前缀，避免和“吃药”重复入库
  title = title
    .replace(/^(请)?(帮忙)?(帮)?提醒(一下)?[，。！？、\s]*/u, '')
    .replace(/^(?:老[\u4e00-\u9fa5]{1,2}|[\u4e00-\u9fa5]{1,3}(?:叔叔|阿姨|爷爷|奶奶|伯伯|大爷|大妈|老师|医生|先生|女士|哥哥|姐姐|弟弟|妹妹))[，。！？、\s]*/u, '')
    .replace(/^(您|你)[，。！？、\s]*/u, '')
    .replace(/^我[，。！？、\s]*/u, '')
    .replace(/^(请)?(帮我)?(记得)?(到时候)?(一定)?(提醒我一下|提醒一下我|提醒我|提醒下我|提醒下|记得提醒我|叫我|告诉我|通知我)[，。！？、\s]*/u, '')
    .replace(/^[，。！？、\s]+/, '')

  // 再去掉开头的时间短语（支持组合：明天下午2点 / 周一上午十点 / 每天9:00）
  const timeWordPrefix = /^(?:(今天|今晚|明天|后天|大后天|下周[一二三四五六日天]?|本周[一二三四五六日天]?|周[一二三四五六日天]|每天|每周|每月|每个?周[一二三四五六日天]|每个?月|\d{1,2}月\d{1,2}[日号]?|凌晨|早上|上午|中午|下午|晚上|夜里|夜间|清晨)[，。！？、\s]*)+/u
  // 支持：9点 / 9点钟 / 九点 / 九点钟 / 09:00 / 上午十点半 等
  const timeClockPrefix = /^(\d{1,2}([:：]\d{1,2})?|[零一二两三四五六七八九十]{1,3})(点(半|[0-5]?\d分?)?(?:钟)?)?[，。！？、\s]*/u
  let withTimeRemoved = title
    .replace(timeWordPrefix, '')
    .replace(/^[，。！？、\s]+/, '')
  withTimeRemoved = withTimeRemoved
    .replace(timeClockPrefix, '')
    .replace(/^[，。！？、\s]+/, '')
  // 兜底：处理极端匹配下残留的“点/点半”前缀（如误成“点吃药”）
  withTimeRemoved = withTimeRemoved
    .replace(/^(?:[零一二两三四五六七八九十\d]{0,2})点(半|[0-5]?\d分?)?(?:钟)?/, '')
    .replace(/^[，。！？、\s]+/, '')

  // 只有在去掉时间后仍有有效内容时才采用，避免误删成空
  if (withTimeRemoved && withTimeRemoved.length >= 2) {
    title = withTimeRemoved
  }

  title = _stripTrailingSpeechParticles(title)
  return title || raw
}

function _normalizeReminderActionKey(text) {
  return _normalizeMemoryText(text)
    // “去看电影” / “要去医院复查” 这类前导动作词不影响提醒语义，用于去重时统一
    .replace(/^(?:要)?(?:准备|打算|想)?去/u, '')
    .replace(/^(?:得|要|想)(?:去|做)?/u, '')
}

function _normalizeReminderDedupKey(text) {
  return _normalizeReminderActionKey(_normalizeReminderTitle(text || ''))
}

function _hasTimeCue(text) {
  const normalized = _normalizeReminderText(text)
  if (!normalized) return false
  return /(\d{4}-\d{2}-\d{2}|\d{1,2}[:：]\d{1,2}|\d{1,2}点|[零〇一二两三四五六七八九十]{1,3}点|早上|上午|中午|下午|晚上|凌晨|今晚|明天|后天|大后天|今天|下周[一二三四五六日天]|周[一二三四五六日天]|每周|每天|每日|每月|\d{1,2}月\d{1,2}[日号]?)/.test(normalized)
}

function _normalizeReminderStatus(status) {
  const text = String(status || '').trim()
  if (text === REMINDER_STATUS.CANDIDATE) return REMINDER_STATUS.CANDIDATE
  if (text === REMINDER_STATUS.TRIGGERED) return REMINDER_STATUS.TRIGGERED
  if (text === REMINDER_STATUS.DONE) return REMINDER_STATUS.DONE
  return REMINDER_STATUS.PENDING
}

function _removeReminderRelatedMemory(reminder, elderKey) {
  const scopedKey = elderKey || getElderKey()
  const title = _normalizeMemoryText(reminder && reminder.title)
  const evidence = _normalizeMemoryText(reminder && reminder.evidence)
  const remindDate = _normalizeMemoryText(reminder && reminder.remindDate)
  const timeOfDay = _normalizeMemoryText(reminder && reminder.timeOfDay)
  const tokens = [title, evidence, remindDate, timeOfDay].filter(Boolean)
  if (tokens.length === 0) return false

  const hasRelatedToken = (text) => {
    const normalized = _normalizeMemoryText(text)
    if (!normalized) return false
    return tokens.some(token => {
      if (!token) return false
      if (token.length <= 2) return normalized === token
      return normalized.includes(token) || token.includes(normalized)
    })
  }

  const bundle = getMemoryBundle(scopedKey)
  const nextXiaolinFollowUps = (bundle.xiaolinMemory && bundle.xiaolinMemory.followUps || [])
    .filter(text => !hasRelatedToken(text))
  const nextRecentEvents = (bundle.elderMemory && bundle.elderMemory.recentEvents || [])
    .filter(text => !hasRelatedToken(text))
  const nextMemoryItems = (bundle.memoryItems || [])
    .filter(item => {
      if (!item || !item.text) return false
      if (!(item.type === 'followUp' || item.type === 'recentEvent')) return true
      return !hasRelatedToken(item.text)
    })

  const changed = nextXiaolinFollowUps.length !== (bundle.xiaolinMemory && bundle.xiaolinMemory.followUps || []).length
    || nextRecentEvents.length !== (bundle.elderMemory && bundle.elderMemory.recentEvents || []).length
    || nextMemoryItems.length !== (bundle.memoryItems || []).length
  if (!changed) return false

  saveMemoryBundle(Object.assign({}, bundle, {
    elderMemory: Object.assign({}, bundle.elderMemory, {
      recentEvents: nextRecentEvents,
      lastUpdatedAt: new Date().toISOString(),
    }),
    xiaolinMemory: Object.assign({}, bundle.xiaolinMemory, {
      followUps: nextXiaolinFollowUps,
      memoryUpdatedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    }),
    memoryMeta: Object.assign({}, bundle.memoryMeta, {
      memoryUpdatedAt: new Date().toISOString(),
    }),
    memoryItems: nextMemoryItems,
  }), scopedKey)
  return true
}

function _normalizeReminder(reminder) {
  const now = new Date().toISOString()
  const title = _normalizeReminderTitle(reminder && reminder.title)
  const timeOfDay = String((reminder && reminder.timeOfDay) || '09:00')
  const scheduleType = String((reminder && reminder.scheduleType) || 'daily')
  const remindDate = _normalizeReminderText(reminder && reminder.remindDate)
  const weekdays = Array.isArray(reminder && reminder.weekdays) ? reminder.weekdays : []
  const missingFields = Array.isArray(reminder && reminder.missingFields) ? reminder.missingFields : []
  const confidenceRaw = Number(reminder && reminder.confidence)
  const fallbackConfidence = reminder && reminder.source === 'call_extract' ? 0.8 : 1
  const safeConfidence = Number.isFinite(confidenceRaw) ? confidenceRaw : fallbackConfidence
  const status = _normalizeReminderStatus(reminder && reminder.status)
  return {
    id: reminder && reminder.id ? reminder.id : `reminder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: title || '未命名提醒',
    note: _normalizeReminderText(reminder && reminder.note),
    type: reminder && reminder.type ? reminder.type : 'general',
    scheduleType,
    timeOfDay,
    remindDate: remindDate || '',
    weekdays: weekdays.slice(0, 7),
    source: reminder && reminder.source ? reminder.source : 'manual',
    confidence: Math.max(0, Math.min(1, safeConfidence)),
    evidence: _normalizeReminderText(reminder && reminder.evidence),
    needsConfirmation: Boolean(reminder && reminder.needsConfirmation) || status === REMINDER_STATUS.CANDIDATE,
    intentType: _normalizeReminderText(reminder && reminder.intentType),
    missingFields: missingFields.map(item => _normalizeReminderText(item)).filter(Boolean).slice(0, 4),
    status,
    elderKey: reminder && reminder.elderKey ? reminder.elderKey : getElderKey(),
    triggerCount: Number(reminder && reminder.triggerCount) > 0 ? Number(reminder.triggerCount) : 0,
    createdAt: reminder && reminder.createdAt ? reminder.createdAt : now,
    updatedAt: reminder && reminder.updatedAt ? reminder.updatedAt : now,
    lastTriggeredAt: reminder && reminder.lastTriggeredAt ? reminder.lastTriggeredAt : '',
    completedAt: reminder && reminder.completedAt ? reminder.completedAt : '',
  }
}

function getReminders(elderKey) {
  const scopedKey = elderKey || getElderKey()
  const reminderMap = _getReminderMap()
  const list = reminderMap[scopedKey] || []
  return list
    .map(_normalizeReminder)
    .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''))
}

function saveReminder(reminder, elderKey) {
  const scopedKey = elderKey || getElderKey()
  const reminderMap = _getReminderMap()
  const list = getReminders(scopedKey)
  const normalized = _normalizeReminder(Object.assign({}, reminder, { elderKey: scopedKey }))
  const idx = list.findIndex(item => item.id === normalized.id)
  if (idx >= 0) {
    list[idx] = Object.assign({}, list[idx], normalized, {
      updatedAt: new Date().toISOString(),
    })
  } else {
    list.unshift(normalized)
  }
  reminderMap[scopedKey] = list
  _saveReminderMap(reminderMap)
  return normalized
}

function updateReminder(reminderId, updates, elderKey) {
  const scopedKey = elderKey || getElderKey()
  if (!reminderId) return null
  const reminderMap = _getReminderMap()
  const list = getReminders(scopedKey)
  const idx = list.findIndex(item => item.id === reminderId)
  if (idx < 0) return null
  const next = _normalizeReminder(Object.assign({}, list[idx], updates || {}, {
    id: reminderId,
    elderKey: scopedKey,
    updatedAt: new Date().toISOString(),
  }))
  list[idx] = next
  reminderMap[scopedKey] = list
  _saveReminderMap(reminderMap)
  return next
}

function deleteReminder(reminderId, elderKey) {
  const scopedKey = elderKey || getElderKey()
  if (!reminderId) return false
  const reminderMap = _getReminderMap()
  const list = getReminders(scopedKey)
  const removed = list.find(item => item.id === reminderId) || null
  const nextList = list.filter(item => item.id !== reminderId)
  if (nextList.length === list.length) return false
  reminderMap[scopedKey] = nextList
  _saveReminderMap(reminderMap)
  if (removed) {
    _removeReminderRelatedMemory(removed, scopedKey)
  }
  return true
}

function markReminderTriggered(reminderId, elderKey) {
  const current = updateReminder(reminderId, {
    status: REMINDER_STATUS.TRIGGERED,
    lastTriggeredAt: new Date().toISOString(),
  }, elderKey)
  if (!current) return null
  const nextCount = Number(current.triggerCount || 0) + 1
  return updateReminder(reminderId, { triggerCount: nextCount }, elderKey)
}

function markReminderDone(reminderId, elderKey) {
  return updateReminder(reminderId, {
    status: REMINDER_STATUS.DONE,
    completedAt: new Date().toISOString(),
  }, elderKey)
}

function pickNextIncomingReminder(elderKey, options) {
  const scopedKey = elderKey || getElderKey()
  const opts = options || {}
  const cooldownMs = typeof opts.cooldownMs === 'number'
    ? opts.cooldownMs
    : DEFAULT_REMINDER_COOLDOWN_MS
  const nowTs = Date.now()
  const reminders = getReminders(scopedKey).filter(item => item.status === REMINDER_STATUS.PENDING || item.status === REMINDER_STATUS.TRIGGERED)
  if (reminders.length === 0) return null

  const available = reminders.filter(item => {
    if (!item.lastTriggeredAt) return true
    const lastTs = Date.parse(item.lastTriggeredAt)
    if (!lastTs) return true
    return nowTs - lastTs >= cooldownMs
  })

  const source = available.length > 0 ? available : reminders
  const sorted = source.sort((a, b) => {
    const statusRank = {
      [REMINDER_STATUS.CANDIDATE]: 0,
      [REMINDER_STATUS.PENDING]: 2,
      [REMINDER_STATUS.TRIGGERED]: 1,
      [REMINDER_STATUS.DONE]: 0,
    }
    const ar = statusRank[a.status] || 0
    const br = statusRank[b.status] || 0
    if (br !== ar) return br - ar
    const aTs = Date.parse(a.lastTriggeredAt || '') || 0
    const bTs = Date.parse(b.lastTriggeredAt || '') || 0
    if (aTs !== bTs) return aTs - bTs
    return Date.parse(a.createdAt || '') - Date.parse(b.createdAt || '')
  })
  return sorted[0] || null
}

function upsertExtractedReminderCandidates(candidates, elderKey, options) {
  const scopedKey = elderKey || getElderKey()
  const opts = options || {}
  const autoThreshold = typeof opts.autoThreshold === 'number' ? opts.autoThreshold : 0.78
  const reminderMap = _getReminderMap()
  const list = getReminders(scopedKey)
  const now = new Date().toISOString()
  const input = Array.isArray(candidates) ? candidates : []
  let inserted = 0
  let updated = 0
  let skippedLowConfidence = 0
  let insertedCandidates = 0
  let updatedCandidates = 0
  const candidateThreshold = typeof opts.candidateThreshold === 'number' ? opts.candidateThreshold : 0.45

  input.forEach(raw => {
    const title = _normalizeReminderTitle(raw && raw.title)
    const confidenceRaw = Number(raw && raw.confidence)
    const confidence = Math.max(0, Math.min(1, Number.isFinite(confidenceRaw) ? confidenceRaw : 0))
    if (!title || confidence < candidateThreshold) {
      skippedLowConfidence += 1
      return
    }
    const rawNeedsConfirmation = Boolean(raw && raw.needsConfirmation)
    const missingFields = Array.isArray(raw && raw.missingFields)
      ? raw.missingFields.map(item => _normalizeReminderText(item)).filter(Boolean).slice(0, 4)
      : []
    const incomingStatus = rawNeedsConfirmation || missingFields.length > 0 || confidence < autoThreshold
      ? REMINDER_STATUS.CANDIDATE
      : REMINDER_STATUS.PENDING
    const normalizedTitle = _normalizeReminderDedupKey(title)
    const scheduleType = String((raw && raw.scheduleType) || 'daily')
    const timeOfDay = String((raw && raw.timeOfDay) || '09:00')
    const hasExplicitTime = _hasTimeCue(raw && raw.remindDate)
      || _hasTimeCue(raw && raw.evidence)
      || _hasTimeCue(raw && raw.title)
    const hitIndex = list.findIndex(item => {
      return _normalizeReminderDedupKey(item.title) === normalizedTitle
        && String(item.scheduleType || 'daily') === scheduleType
        && (
          String(item.timeOfDay || '09:00') === timeOfDay
          || !hasExplicitTime
        )
    })
    if (hitIndex >= 0) {
      const currentTitle = String(list[hitIndex].title || '').trim()
      const nextTitle = title
      const preferredTitle = !currentTitle
        ? nextTitle
        : (!nextTitle ? currentTitle : (nextTitle.length < currentTitle.length ? nextTitle : currentTitle))
      const previousStatus = list[hitIndex].status || REMINDER_STATUS.PENDING
      const nextStatus = previousStatus === REMINDER_STATUS.CANDIDATE && incomingStatus === REMINDER_STATUS.PENDING
        ? REMINDER_STATUS.PENDING
        : previousStatus
      const merged = _normalizeReminder(Object.assign({}, list[hitIndex], {
        title: preferredTitle,
        confidence: Math.max(confidence, Number(list[hitIndex].confidence || 0)),
        evidence: raw && raw.evidence ? String(raw.evidence) : list[hitIndex].evidence,
        source: 'call_extract',
        needsConfirmation: nextStatus === REMINDER_STATUS.CANDIDATE || rawNeedsConfirmation,
        intentType: raw && raw.intentType ? String(raw.intentType) : list[hitIndex].intentType,
        missingFields: missingFields.length > 0 ? missingFields : list[hitIndex].missingFields,
        // 避免摘要候选把已完成提醒“复活”为 pending
        status: nextStatus,
        updatedAt: now,
        elderKey: scopedKey,
      }))
      list[hitIndex] = merged
      updated += 1
      if (merged.status === REMINDER_STATUS.CANDIDATE) updatedCandidates += 1
      return
    }
    list.unshift(_normalizeReminder({
      title,
      scheduleType,
      timeOfDay,
      remindDate: raw && raw.remindDate ? String(raw.remindDate) : '',
      source: 'call_extract',
      confidence,
      evidence: raw && raw.evidence ? String(raw.evidence) : title,
      needsConfirmation: incomingStatus === REMINDER_STATUS.CANDIDATE || rawNeedsConfirmation,
      intentType: raw && raw.intentType ? String(raw.intentType) : '',
      missingFields,
      weekdays: Array.isArray(raw && raw.weekdays) ? raw.weekdays : [],
      status: incomingStatus,
      elderKey: scopedKey,
      createdAt: now,
      updatedAt: now,
    }))
    inserted += 1
    if (incomingStatus === REMINDER_STATUS.CANDIDATE) insertedCandidates += 1
  })

  reminderMap[scopedKey] = list
  _saveReminderMap(reminderMap)
  return { inserted, updated, skippedLowConfidence, insertedCandidates, updatedCandidates }
}

function markGreetingMemoryUsed(elderKey, text) {
  const scopedKey = elderKey || getElderKey()
  const normalized = _normalizeMemoryText(text)
  if (!normalized) return false
  const map = _getGreetingCooldownMap()
  if (!map[scopedKey]) map[scopedKey] = {}
  map[scopedKey][normalized] = new Date().toISOString()
  _saveGreetingCooldownMap(map)
  return true
}

function isGreetingMemoryCooling(elderKey, text, cooldownMs) {
  const scopedKey = elderKey || getElderKey()
  const normalized = _normalizeMemoryText(text)
  if (!normalized) return false
  const map = _getGreetingCooldownMap()
  const ts = map[scopedKey] && map[scopedKey][normalized]
  if (!ts) return false
  const lastTs = Date.parse(ts)
  if (!lastTs) return false
  const windowMs = typeof cooldownMs === 'number' ? cooldownMs : DEFAULT_GREETING_COOLDOWN_MS
  return Date.now() - lastTs < windowMs
}

function getMockTimeWeatherContext() {
  const now = new Date()
  const hour = now.getHours()
  let timePeriod = '白天'
  if (hour < 11) timePeriod = '上午'
  else if (hour < 14) timePeriod = '中午'
  else if (hour < 18) timePeriod = '下午'
  else if (hour < 22) timePeriod = '晚上'
  else timePeriod = '深夜'

  const weatherPool = [
    { text: '晴，微风，体感舒适', temp: '21-26°C' },
    { text: '多云，气温平稳', temp: '19-24°C' },
    { text: '小雨，出门注意带伞', temp: '17-22°C' },
  ]
  const weather = weatherPool[now.getDate() % weatherPool.length]
  const dateText = `${now.getMonth() + 1}月${now.getDate()}日`
  const prompt = `当前是${dateText}${timePeriod}，天气${weather.text}（${weather.temp}）。可自然结合天气与作息开启话题。`
  return {
    dateText,
    timePeriod,
    weatherText: weather.text,
    temperature: weather.temp,
    prompt,
  }
}

function getMemoryBundle(elderKey) {
  const scopedKey = elderKey || getElderKey()
  const memoryMap = _getMemoryMap()
  const bundle = memoryMap[scopedKey]
  if (!bundle) return getDefaultMemoryBundle()
  const merged = Object.assign(getDefaultMemoryBundle(), bundle)
  if (!merged.xiaolinMemory.memoryUpdatedAt && merged.xiaolinMemory.lastUpdatedAt) {
    merged.xiaolinMemory.memoryUpdatedAt = merged.xiaolinMemory.lastUpdatedAt
  }
  if (!Array.isArray(merged.memoryItems) || merged.memoryItems.length === 0) {
    merged.memoryItems = _buildItemsFromLegacy(merged)
  }
  return merged
}

function saveMemoryBundle(bundle, elderKey) {
  const scopedKey = elderKey || getElderKey()
  const memoryMap = _getMemoryMap()
  memoryMap[scopedKey] = bundle
  _saveMemoryMap(memoryMap)
}

function clearMemoryBundle(elderKey) {
  const scopedKey = elderKey || getElderKey()
  const memoryMap = _getMemoryMap()
  delete memoryMap[scopedKey]
  _saveMemoryMap(memoryMap)
}

function initMemoryBundle(elderKey, seed) {
  const scopedKey = elderKey || getElderKey()
  const memoryMap = _getMemoryMap()
  if (memoryMap[scopedKey]) {
    // 已存在则只做轻量补充，避免覆盖历史记忆
    return mergeMemoryBundle(scopedKey, {
      elderMemory: {
        healthNotes: _uniqList([seed && seed.health], 10),
        interestTags: _uniqList((seed && seed.hobbies) || [], 20),
      },
      xiaolinMemory: {
        preferredAddress: seed && seed.preferredAddress ? seed.preferredAddress : '',
      },
    }, '')
  }

  const base = getDefaultMemoryBundle()
  const now = new Date().toISOString()
  const next = Object.assign({}, base, {
    elderMemory: Object.assign({}, base.elderMemory, {
      healthNotes: _uniqList([seed && seed.health], 10),
      interestTags: _uniqList((seed && seed.hobbies) || [], 20),
      lastUpdatedAt: now,
    }),
    xiaolinMemory: Object.assign({}, base.xiaolinMemory, {
      preferredAddress: seed && seed.preferredAddress ? seed.preferredAddress : '',
      responseStyle: '语速自然正常，口语化表达，句子简短，适当停顿，多确认对方感受',
      lastUpdatedAt: now,
      memoryUpdatedAt: now,
    }),
    memoryMeta: Object.assign({}, base.memoryMeta, {
      memoryUpdatedAt: now,
    }),
    memoryItems: _mergeMemoryItems(base.memoryItems, [
      _buildMemoryItem('healthNote', seed && seed.health, 'onboarding', 0.9, now, seed && seed.health),
    ].concat((seed && seed.hobbies || []).map(tag => _buildMemoryItem('interest', tag, 'onboarding', 0.85, now, tag))).filter(Boolean)),
  })
  saveMemoryBundle(next, scopedKey)
  return next
}

function mergeMemoryBundle(elderKey, delta, callId) {
  const scopedKey = elderKey || getElderKey()
  const current = getMemoryBundle(scopedKey)
  const now = new Date().toISOString()
  const deltaElderMemory = delta && delta.elderMemory ? delta.elderMemory : {}
  const deltaXiaolinMemory = delta && delta.xiaolinMemory ? delta.xiaolinMemory : {}
  const sourceMeta = {
    source: delta && delta.memorySource ? delta.memorySource : 'summary',
    sourceCallId: callId || delta && delta.sourceCallId || '',
    observedAt: delta && delta.observedAt ? delta.observedAt : now,
  }

  const elderMemory = Object.assign({}, current.elderMemory, deltaElderMemory)
  elderMemory.healthNotes = _uniqList([].concat(current.elderMemory.healthNotes, elderMemory.healthNotes || []), 10)
  elderMemory.interestTags = _uniqList([].concat(current.elderMemory.interestTags, elderMemory.interestTags || []), 20)
  elderMemory.routineNotes = _uniqList([].concat(current.elderMemory.routineNotes, elderMemory.routineNotes || []), 10)
  elderMemory.recentEvents = _uniqList([].concat(current.elderMemory.recentEvents, elderMemory.recentEvents || []), 10)
  elderMemory.lastUpdatedAt = now

  const xiaolinMemory = Object.assign({}, current.xiaolinMemory, deltaXiaolinMemory)
  xiaolinMemory.tabooTopics = _uniqList([].concat(current.xiaolinMemory.tabooTopics, xiaolinMemory.tabooTopics || []), 10)
  xiaolinMemory.followUps = _uniqList([].concat(current.xiaolinMemory.followUps, xiaolinMemory.followUps || []), 10)
  xiaolinMemory.careStrategies = _uniqList([].concat(current.xiaolinMemory.careStrategies, xiaolinMemory.careStrategies || []), 10)
  xiaolinMemory.lastUpdatedAt = now
  xiaolinMemory.memoryUpdatedAt = now

  const deltaItems = []
  ;(deltaElderMemory.recentEvents || []).forEach(text => {
    const item = _buildMemoryItem('recentEvent', text, sourceMeta, MEMORY_TYPE_CONFIDENCE.recentEvent, now, text)
    if (item) deltaItems.push(item)
  })
  ;(deltaElderMemory.interestTags || []).forEach(text => {
    const item = _buildMemoryItem('interest', text, sourceMeta, MEMORY_TYPE_CONFIDENCE.interest, now, text)
    if (item) deltaItems.push(item)
  })
  ;(deltaElderMemory.healthNotes || []).forEach(text => {
    const item = _buildMemoryItem('healthNote', text, sourceMeta, MEMORY_TYPE_CONFIDENCE.healthNote, now, text)
    if (item) deltaItems.push(item)
  })
  ;(deltaElderMemory.routineNotes || []).forEach(text => {
    const item = _buildMemoryItem('routineNote', text, sourceMeta, MEMORY_TYPE_CONFIDENCE.routineNote, now, text)
    if (item) deltaItems.push(item)
  })
  ;(deltaXiaolinMemory.followUps || []).forEach(text => {
    const item = _buildMemoryItem('followUp', text, sourceMeta, MEMORY_TYPE_CONFIDENCE.followUp, now, text)
    if (item) deltaItems.push(item)
  })
  ;(deltaXiaolinMemory.tabooTopics || []).forEach(text => {
    const item = _buildMemoryItem('tabooTopic', text, sourceMeta, MEMORY_TYPE_CONFIDENCE.tabooTopic, now, text)
    if (item) deltaItems.push(item)
  })
  ;(delta && Array.isArray(delta.memoryItems) ? delta.memoryItems : []).forEach(rawItem => {
    if (!rawItem || !rawItem.text) return
    deltaItems.push(Object.assign({}, rawItem, {
      type: _normalizeMemoryType(rawItem.type),
      source: rawItem.source || sourceMeta.source,
      sourceCallId: rawItem.sourceCallId || sourceMeta.sourceCallId,
      observedAt: rawItem.observedAt || sourceMeta.observedAt,
      createdAt: rawItem.createdAt || now,
      updatedAt: rawItem.updatedAt || now,
    }))
  })

  const next = {
    elderMemory,
    xiaolinMemory,
    memoryMeta: Object.assign({}, current.memoryMeta, {
      version: 2,
      updatedFromCallId: callId || '',
      memoryUpdatedAt: now,
    }),
    memoryItems: _mergeMemoryItems(current.memoryItems || [], deltaItems),
  }
  saveMemoryBundle(next, scopedKey)
  return next
}

function buildMemoryPrompt(elderKey, options) {
  const context = buildMemoryContext(elderKey, Object.assign({
    intent: 'general',
  }, options || {}, {
    includePreferredAddress: false,
  }))
  return context.prompt || ''
}

function buildMemoryContext(elderKey, options) {
  const bundle = getMemoryBundle(elderKey)
  const opts = options || {}
  const purpose = _normalizeMemoryPurpose(opts.purpose)
  const intent = _inferMemoryContextIntent(opts)
  const selected = _selectMemoryItemsForContext(bundle, opts)
  const factItems = selected.filter(item => item.type !== 'tabooTopic')
  const tabooItems = selected.filter(item => item.type === 'tabooTopic')
  const outputItems = purpose === 'constraint' ? tabooItems : factItems
  const lines = outputItems.map(_formatMemoryItemForPrompt).filter(Boolean)
  if (purpose !== 'rag' && purpose !== 'steer' && purpose !== 'greeting' && purpose !== 'constraint' && tabooItems.length > 0) {
    lines.push(`慎提话题（只作行为约束，不要主动提起或复述）：${tabooItems.map(item => item.text).join('、')}`)
  }
  const xiaolinMemory = bundle.xiaolinMemory || {}
  if (purpose !== 'constraint' && purpose !== 'rag' && xiaolinMemory.preferredAddress && opts.includePreferredAddress) {
    lines.push(`偏好称呼：${xiaolinMemory.preferredAddress}`)
  }
  return {
    intent,
    prompt: purpose === 'constraint' && tabooItems.length > 0
      ? `慎提话题（只作行为约束，不要主动提起或复述）：${tabooItems.map(item => item.text).join('、')}`
      : lines.join('\n'),
    items: outputItems,
    usedTexts: outputItems.map(item => item.text),
    hasSensitive: outputItems.some(item => item.sensitivity === 'sensitive' || item.type === 'healthNote'),
  }
}

function getPreferredAddress(elderKey) {
  const bundle = getMemoryBundle(elderKey)
  const preferred = bundle && bundle.xiaolinMemory
    ? String(bundle.xiaolinMemory.preferredAddress || '').trim()
    : ''
  return preferred || getElderTitle()
}

function getPendingMemoryConfirmations(elderKey, options) {
  const scopedKey = elderKey || getElderKey()
  const opts = options || {}
  const maxCount = typeof opts.maxCount === 'number' ? opts.maxCount : 3
  const bundle = getMemoryBundle(scopedKey)
  return (bundle.memoryItems || [])
    .filter(item => item && item.text)
    .filter(item => item.status === MEMORY_STATUS.PENDING || item.needsConfirmation)
    .filter(item => item.status !== MEMORY_STATUS.REJECTED)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      return Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '')
    })
    .slice(0, maxCount)
}

function confirmMemoryItem(elderKey, memoryItemId, confirmed) {
  const scopedKey = elderKey || getElderKey()
  if (!memoryItemId) return null
  const bundle = getMemoryBundle(scopedKey)
  const now = new Date().toISOString()
  let updatedItem = null
  const nextItems = (bundle.memoryItems || []).map(item => {
    if (!item || item.id !== memoryItemId) return item
    const nextStatus = confirmed ? MEMORY_STATUS.CONFIRMED : MEMORY_STATUS.REJECTED
    updatedItem = Object.assign({}, item, {
      status: nextStatus,
      needsConfirmation: false,
      confirmedAt: confirmed ? now : '',
      lastConfirmedAt: confirmed ? now : item.lastConfirmedAt || '',
    })
    return updatedItem
  })
  if (!updatedItem) return null
  saveMemoryBundle(Object.assign({}, bundle, {
    memoryItems: nextItems,
    memoryMeta: Object.assign({}, bundle.memoryMeta, {
      memoryUpdatedAt: now,
    }),
  }), scopedKey)
  return updatedItem
}

function markMemoryItemsUsed(elderKey, texts) {
  const scopedKey = elderKey || getElderKey()
  const bundle = getMemoryBundle(scopedKey)
  const usedSet = new Set([].concat(texts || []).map(_normalizeMemoryText).filter(Boolean))
  if (usedSet.size === 0) return false
  const now = new Date().toISOString()
  const nowTs = Date.parse(now) || Date.now()
  let changed = false
  const nextItems = (bundle.memoryItems || []).map(item => {
    if (usedSet.has(_normalizeMemoryText(item.text))) {
      changed = true
      const nextTriggerCount = Number(item.triggerCount || 0) + 1
      const next = Object.assign({}, item, {
        lastUsedAt: now,
        triggerCount: nextTriggerCount,
      })
      next.score = _computeMemoryScore(next, nowTs)
      return next
    }
    return item
  })
  if (!changed) return false
  const previousLog = Array.isArray(bundle.memoryMeta && bundle.memoryMeta.usageLog)
    ? bundle.memoryMeta.usageLog
    : []
  const logEntry = {
    at: now,
    usedTexts: Array.from(usedSet),
    hit: true,
  }
  const usageLog = previousLog.concat([logEntry]).slice(-120)
  saveMemoryBundle(Object.assign({}, bundle, {
    memoryItems: nextItems,
    memoryMeta: Object.assign({}, bundle.memoryMeta, {
      usageLog,
      memoryUpdatedAt: now,
    }),
  }), scopedKey)
  return true
}

function _memoryListKeyForType(type) {
  const normalizedType = _normalizeMemoryType(type)
  if (normalizedType === 'interest') return { section: 'elderMemory', key: 'interestTags' }
  if (normalizedType === 'healthNote') return { section: 'elderMemory', key: 'healthNotes' }
  if (normalizedType === 'recentEvent') return { section: 'elderMemory', key: 'recentEvents' }
  if (normalizedType === 'routineNote') return { section: 'elderMemory', key: 'routineNotes' }
  if (normalizedType === 'followUp') return { section: 'xiaolinMemory', key: 'followUps' }
  if (normalizedType === 'tabooTopic') return { section: 'xiaolinMemory', key: 'tabooTopics' }
  return null
}

function updateMemoryItem(elderKey, memoryItemId, updates) {
  const scopedKey = elderKey || getElderKey()
  if (!memoryItemId) return null
  const bundle = getMemoryBundle(scopedKey)
  const now = new Date().toISOString()
  let previousItem = null
  let updatedItem = null
  const nextItems = (bundle.memoryItems || []).map(item => {
    if (!item || item.id !== memoryItemId) return item
    previousItem = item
    const nextType = _normalizeMemoryType(updates && updates.type ? updates.type : item.type)
    const nextText = _normalizeMemoryText(updates && Object.prototype.hasOwnProperty.call(updates, 'text') ? updates.text : item.text)
    if (!nextText) return item
    const merged = Object.assign({}, item, updates || {}, {
      id: memoryItemId,
      type: nextType,
      text: nextText,
      updatedAt: now,
    })
    updatedItem = _mergeMemoryItems([], [merged])[0] || merged
    return updatedItem
  })
  if (!updatedItem) return null

  const nextBundle = Object.assign({}, bundle, {
    memoryItems: nextItems,
    memoryMeta: Object.assign({}, bundle.memoryMeta, {
      memoryUpdatedAt: now,
    }),
  })
  const previousListRef = _memoryListKeyForType(previousItem && previousItem.type)
  const nextListRef = _memoryListKeyForType(updatedItem.type)
  if (previousListRef) {
    const section = Object.assign({}, nextBundle[previousListRef.section] || {})
    section[previousListRef.key] = (section[previousListRef.key] || [])
      .filter(text => _normalizeMemoryText(text) !== _normalizeMemoryText(previousItem.text))
    nextBundle[previousListRef.section] = section
  }
  if (nextListRef) {
    const section = Object.assign({}, nextBundle[nextListRef.section] || {})
    section[nextListRef.key] = _uniqList([].concat(section[nextListRef.key] || [], [updatedItem.text]), MEMORY_TYPE_LIMIT[updatedItem.type] || 10)
    nextBundle[nextListRef.section] = section
  }
  saveMemoryBundle(nextBundle, scopedKey)
  return updatedItem
}

function deleteMemoryItem(elderKey, memoryItemId) {
  const scopedKey = elderKey || getElderKey()
  if (!memoryItemId) return false
  const bundle = getMemoryBundle(scopedKey)
  const removed = (bundle.memoryItems || []).find(item => item && item.id === memoryItemId)
  if (!removed) return false
  const now = new Date().toISOString()
  const nextBundle = Object.assign({}, bundle, {
    memoryItems: (bundle.memoryItems || []).filter(item => item && item.id !== memoryItemId),
    memoryMeta: Object.assign({}, bundle.memoryMeta, {
      memoryUpdatedAt: now,
    }),
  })
  const listRef = _memoryListKeyForType(removed.type)
  if (listRef) {
    const section = Object.assign({}, nextBundle[listRef.section] || {})
    section[listRef.key] = (section[listRef.key] || [])
      .filter(text => _normalizeMemoryText(text) !== _normalizeMemoryText(removed.text))
    nextBundle[listRef.section] = section
  }
  saveMemoryBundle(nextBundle, scopedKey)
  return true
}

function getMemoryDebugSnapshot(elderKey) {
  const scopedKey = elderKey || getElderKey()
  return {
    elderKey: scopedKey,
    dialogId: getDialogId(scopedKey),
    memoryBundle: getMemoryBundle(scopedKey),
  }
}

/**
 * 老人档案（AI 自动丰富）
 */
function getProfile() {
  return wx.getStorageSync(KEYS.PROFILE) || {
    hobbies: [],
    health: '',
    habits: '',
    family: '',
  }
}

function updateProfile(updates) {
  const profile = getProfile()
  Object.assign(profile, updates)
  wx.setStorageSync(KEYS.PROFILE, profile)
}

function clearAllRuntimeData() {
  wx.removeStorageSync(KEYS.ELDER_CONFIG)
  wx.removeStorageSync(KEYS.DIALOG_ID)
  wx.removeStorageSync(KEYS.DIALOG_ID_MAP)
  wx.removeStorageSync(KEYS.CALL_HISTORY)
  wx.removeStorageSync(KEYS.PROFILE)
  wx.removeStorageSync(KEYS.MEMORY_MAP)
  wx.removeStorageSync(KEYS.REMINDER_MAP)
  wx.removeStorageSync(KEYS.GREETING_COOLDOWN_MAP)

  const app = _safeGetApp()
  if (app && app.globalData) {
    app.globalData.elderConfig = null
    app.globalData.dialogId = ''
    app.globalData.callHistory = []
  }
}

module.exports = {
  getElderConfig,
  saveElderConfig,
  getElderKey,
  getElderTitle,
  getPreferredAddress,
  getDialogId,
  saveDialogId,
  clearDialogId,
  getCallHistory,
  addCallRecord,
  updateCallRecord,
  getMemoryBundle,
  saveMemoryBundle,
  clearMemoryBundle,
  initMemoryBundle,
  mergeMemoryBundle,
  buildMemoryPrompt,
  buildMemoryContext,
  markMemoryItemsUsed,
  updateMemoryItem,
  deleteMemoryItem,
  getMemoryDebugSnapshot,
  getPendingMemoryConfirmations,
  confirmMemoryItem,
  getReminders,
  saveReminder,
  updateReminder,
  deleteReminder,
  markReminderTriggered,
  markReminderDone,
  pickNextIncomingReminder,
  upsertExtractedReminderCandidates,
  markGreetingMemoryUsed,
  isGreetingMemoryCooling,
  getMockTimeWeatherContext,
  getProfile,
  updateProfile,
  clearAllRuntimeData,
}
