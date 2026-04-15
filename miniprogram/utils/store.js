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
  PENDING: 'pending',
  TRIGGERED: 'triggered',
  DONE: 'done',
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
  interest: 20,
  healthNote: 10,
  tabooTopic: 10,
}

const MEMORY_TYPE_CONFIDENCE = {
  followUp: 0.75,
  recentEvent: 0.7,
  interest: 0.65,
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

function _buildMemoryItem(type, text, source, confidence, now, evidence) {
  const cleanText = _normalizeMemoryText(text)
  if (!cleanText) return null
  const safeConfidence = Math.max(0, Math.min(1, Number(confidence || 0.6)))
  const nowTs = Date.parse(now || '') || Date.now()
  return {
    id: _memoryItemId(type, cleanText),
    type,
    text: cleanText,
    source: source || 'summary',
    confidence: safeConfidence,
    layer: _resolveMemoryLayer(type),
    stability: type === 'interest' || type === 'healthNote' ? 'stable' : 'semi_stable',
    sensitivity: _resolveMemorySensitivity(type, safeConfidence),
    lastConfirmedAt: '',
    createdAt: now,
    lastUsedAt: '',
    triggerCount: 0,
    score: _computeMemoryScore({
      confidence: safeConfidence,
      createdAt: now,
      lastUsedAt: '',
      triggerCount: 0,
    }, nowTs),
    evidence: evidence || cleanText,
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
  if (type === 'interest') return 'persona'
  if (type === 'tabooTopic') return 'ai_strategy'
  return 'event'
}

function _resolveMemorySensitivity(type, confidence) {
  if (type !== 'healthNote') return 'normal'
  return Number(confidence || 0) >= 0.85 ? 'sensitive' : 'normal'
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

function _mergeMemoryItems(existingItems, deltaItems) {
  const now = new Date().toISOString()
  const nowTs = Date.now()
  const allItems = []
    .concat(existingItems || [])
    .concat(deltaItems || [])
    .filter(Boolean)

  const mergedMap = {}
  allItems.forEach(item => {
    const type = item.type || 'recentEvent'
    const text = _normalizeMemoryText(item.text)
    if (!text) return
    const key = `${type}:${text}`
    const normalizedItem = Object.assign({}, item, {
      id: item.id || _memoryItemId(type, text),
      type,
      text,
      confidence: Math.max(0, Math.min(1, Number(item.confidence || MEMORY_TYPE_CONFIDENCE[type] || 0.6))),
      layer: item.layer || _resolveMemoryLayer(type),
      source: item.source || 'summary',
      createdAt: item.createdAt || now,
      lastUsedAt: item.lastUsedAt || '',
      triggerCount: Number(item.triggerCount || 0) || 0,
      stability: item.stability || (type === 'interest' || type === 'healthNote' ? 'stable' : 'semi_stable'),
      sensitivity: item.sensitivity || _resolveMemorySensitivity(type, item.confidence),
      lastConfirmedAt: item.lastConfirmedAt || '',
      evidence: item.evidence || text,
    })
    normalizedItem.score = _computeMemoryScore(normalizedItem, nowTs)
    const current = mergedMap[key]
    if (!current) {
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
  return wx.getStorageSync(KEYS.DIALOG_ID) || ''
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

function _normalizeReminderTitle(text) {
  const raw = _normalizeReminderText(text)
  if (!raw) return ''

  // 先去掉“提醒我/记得提醒我”等第一人称提醒前缀
  let title = raw
    .replace(/^[，。！？、\s]+/, '')
    .replace(/^(请)?(帮我)?(记得)?(到时候)?(一定)?(提醒我一下|提醒一下我|提醒我|提醒下我|提醒下|记得提醒我|叫我|告诉我|通知我)[，。！？、\s]*/u, '')
    .replace(/^[，。！？、\s]+/, '')

  // 再去掉开头的时间短语（支持组合：明天下午2点 / 周一上午十点 / 每天9:00）
  const timeWordPrefix = /^(?:(今天|今晚|明天|后天|大后天|下周[一二三四五六日天]?|本周[一二三四五六日天]?|周[一二三四五六日天]|每天|每周|每月|每个?周[一二三四五六日天]|每个?月|\d{1,2}月\d{1,2}[日号]?|凌晨|早上|上午|中午|下午|晚上|夜里|夜间|清晨)[，。！？、\s]*)+/u
  const timeClockPrefix = /^(\d{1,2}([:：]\d{1,2})?|[零一二两三四五六七八九十]{1,3})(点(半|[0-5]?\d分?)?)?[，。！？、\s]*/u
  let withTimeRemoved = title
    .replace(timeWordPrefix, '')
    .replace(/^[，。！？、\s]+/, '')
  withTimeRemoved = withTimeRemoved
    .replace(timeClockPrefix, '')
    .replace(/^[，。！？、\s]+/, '')
  // 兜底：处理极端匹配下残留的“点/点半”前缀（如误成“点吃药”）
  withTimeRemoved = withTimeRemoved
    .replace(/^(?:[零一二两三四五六七八九十\d]{0,2})点(半|[0-5]?\d分?)?/, '')
    .replace(/^[，。！？、\s]+/, '')

  // 只有在去掉时间后仍有有效内容时才采用，避免误删成空
  if (withTimeRemoved && withTimeRemoved.length >= 2) {
    title = withTimeRemoved
  }

  return title || raw
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
  const confidenceRaw = Number(reminder && reminder.confidence)
  const fallbackConfidence = reminder && reminder.source === 'call_extract' ? 0.8 : 1
  const safeConfidence = Number.isFinite(confidenceRaw) ? confidenceRaw : fallbackConfidence
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
    status: reminder && reminder.status ? reminder.status : REMINDER_STATUS.PENDING,
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
  const reminders = getReminders(scopedKey).filter(item => item.status !== REMINDER_STATUS.DONE)
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

  input.forEach(raw => {
    const title = _normalizeReminderTitle(raw && raw.title)
    const confidenceRaw = Number(raw && raw.confidence)
    const confidence = Math.max(0, Math.min(1, Number.isFinite(confidenceRaw) ? confidenceRaw : 0))
    if (!title || confidence < autoThreshold) {
      skippedLowConfidence += 1
      return
    }
    const normalizedTitle = _normalizeMemoryText(title)
    const scheduleType = String((raw && raw.scheduleType) || 'daily')
    const timeOfDay = String((raw && raw.timeOfDay) || '09:00')
    const hitIndex = list.findIndex(item => {
      return _normalizeMemoryText(item.title) === normalizedTitle
        && String(item.scheduleType || 'daily') === scheduleType
        && String(item.timeOfDay || '09:00') === timeOfDay
    })
    if (hitIndex >= 0) {
      const merged = _normalizeReminder(Object.assign({}, list[hitIndex], {
        confidence: Math.max(confidence, Number(list[hitIndex].confidence || 0)),
        evidence: raw && raw.evidence ? String(raw.evidence) : list[hitIndex].evidence,
        source: 'call_extract',
        status: REMINDER_STATUS.PENDING,
        updatedAt: now,
        elderKey: scopedKey,
      }))
      list[hitIndex] = merged
      updated += 1
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
      status: REMINDER_STATUS.PENDING,
      elderKey: scopedKey,
      createdAt: now,
      updatedAt: now,
    }))
    inserted += 1
  })

  reminderMap[scopedKey] = list
  _saveReminderMap(reminderMap)
  return { inserted, updated, skippedLowConfidence }
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

  const elderMemory = Object.assign({}, current.elderMemory, delta && delta.elderMemory ? delta.elderMemory : {})
  elderMemory.healthNotes = _uniqList([].concat(current.elderMemory.healthNotes, elderMemory.healthNotes || []), 10)
  elderMemory.interestTags = _uniqList([].concat(current.elderMemory.interestTags, elderMemory.interestTags || []), 20)
  elderMemory.routineNotes = _uniqList([].concat(current.elderMemory.routineNotes, elderMemory.routineNotes || []), 10)
  elderMemory.recentEvents = _uniqList([].concat(current.elderMemory.recentEvents, elderMemory.recentEvents || []), 10)
  elderMemory.lastUpdatedAt = now

  const xiaolinMemory = Object.assign({}, current.xiaolinMemory, delta && delta.xiaolinMemory ? delta.xiaolinMemory : {})
  xiaolinMemory.tabooTopics = _uniqList([].concat(current.xiaolinMemory.tabooTopics, xiaolinMemory.tabooTopics || []), 10)
  xiaolinMemory.followUps = _uniqList([].concat(current.xiaolinMemory.followUps, xiaolinMemory.followUps || []), 10)
  xiaolinMemory.careStrategies = _uniqList([].concat(current.xiaolinMemory.careStrategies, xiaolinMemory.careStrategies || []), 10)
  xiaolinMemory.lastUpdatedAt = now
  xiaolinMemory.memoryUpdatedAt = now

  const deltaItems = []
  ;(elderMemory.recentEvents || []).forEach(text => {
    const item = _buildMemoryItem('recentEvent', text, 'summary', MEMORY_TYPE_CONFIDENCE.recentEvent, now, text)
    if (item) deltaItems.push(item)
  })
  ;(elderMemory.interestTags || []).forEach(text => {
    const item = _buildMemoryItem('interest', text, 'summary', MEMORY_TYPE_CONFIDENCE.interest, now, text)
    if (item) deltaItems.push(item)
  })
  ;(elderMemory.healthNotes || []).forEach(text => {
    const item = _buildMemoryItem('healthNote', text, 'summary', MEMORY_TYPE_CONFIDENCE.healthNote, now, text)
    if (item) deltaItems.push(item)
  })
  ;(xiaolinMemory.followUps || []).forEach(text => {
    const item = _buildMemoryItem('followUp', text, 'summary', MEMORY_TYPE_CONFIDENCE.followUp, now, text)
    if (item) deltaItems.push(item)
  })
  ;(xiaolinMemory.tabooTopics || []).forEach(text => {
    const item = _buildMemoryItem('tabooTopic', text, 'summary', MEMORY_TYPE_CONFIDENCE.tabooTopic, now, text)
    if (item) deltaItems.push(item)
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
  const bundle = getMemoryBundle(elderKey)
  const opts = options || {}
  const parts = []
  const elderMemory = bundle.elderMemory || {}
  const xiaolinMemory = bundle.xiaolinMemory || {}
  const excludeSet = new Set((opts.excludeTexts || []).map(_normalizeMemoryText).filter(Boolean))
  const maxItems = typeof opts.maxItems === 'number' ? opts.maxItems : 3
  const minConfidence = typeof opts.minConfidence === 'number' ? opts.minConfidence : 0.6
  const cooldownMs = typeof opts.cooldownMs === 'number' ? opts.cooldownMs : 12 * 60 * 60 * 1000
  const typeBudget = Object.assign({
    followUp: 1,
    recentEvent: 1,
    interest: 1,
  }, opts.typeBudget || {})
  const nowTs = Date.now()

  const memoryItems = (bundle.memoryItems || [])
    .filter(item => item && item.text)
    .filter(item => !_isLowInfoMemoryText(item.text))
    .filter(item => item.confidence >= minConfidence)
    .filter(item => !excludeSet.has(_normalizeMemoryText(item.text)))
    .filter(item => {
      if (!item.lastUsedAt) return true
      const usedTs = Date.parse(item.lastUsedAt)
      if (!usedTs) return true
      return nowTs - usedTs >= cooldownMs
    })
    .filter(item => {
      if (item.type === 'interest' || item.type === 'healthNote') return true
      return _isRecent(item.createdAt, 45)
    })

  if (memoryItems.length > 0) {
    const pickedTypes = {}
    const selected = memoryItems
      .sort((a, b) => {
        const typeRank = { followUp: 4, recentEvent: 3, interest: 2, healthNote: 1 }
        const ar = typeRank[a.type] || 0
        const br = typeRank[b.type] || 0
        if (br !== ar) return br - ar
        const as = Number(a.score || _computeMemoryScore(a, nowTs))
        const bs = Number(b.score || _computeMemoryScore(b, nowTs))
        if (bs !== as) return bs - as
        if (b.confidence !== a.confidence) return b.confidence - a.confidence
        return Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '')
      })
      .filter(item => {
        if (!(item.type === 'followUp' || item.type === 'recentEvent' || item.type === 'interest')) return false
        const budget = Number(typeBudget[item.type] || 0)
        if (budget <= 0) return false
        if (!pickedTypes[item.type]) pickedTypes[item.type] = 0
        if (pickedTypes[item.type] >= budget) return false
        pickedTypes[item.type] += 1
        return true
      })
      .slice(0, maxItems)

    selected.forEach(item => {
      if (item.type === 'followUp') {
        parts.push(`上次承诺跟进：${item.text}`)
      } else if (item.type === 'recentEvent') {
        parts.push(`老人近期事件：${item.text}`)
      } else if (item.type === 'interest') {
        parts.push(`老人兴趣：${item.text}`)
      }
    })
  }

  if (parts.length > 0) {
    return parts.join('\n')
  }

  if (elderMemory.recentEvents && elderMemory.recentEvents.length > 0) {
    const recentEvents = (elderMemory.recentEvents || []).filter(text => !_isLowInfoMemoryText(text))
    if (recentEvents.length > 0) {
      parts.push(`老人近期事件：${recentEvents.slice(0, 3).join('；')}`)
    }
  }
  if (elderMemory.interestTags && elderMemory.interestTags.length > 0) {
    const interestTags = (elderMemory.interestTags || []).filter(text => !_isLowInfoMemoryText(text))
    if (interestTags.length > 0) {
      parts.push(`老人兴趣：${interestTags.slice(0, 5).join('、')}`)
    }
  }
  if (xiaolinMemory.preferredAddress) {
    parts.push(`偏好称呼：${xiaolinMemory.preferredAddress}`)
  }
  if (xiaolinMemory.followUps && xiaolinMemory.followUps.length > 0) {
    const followUps = (xiaolinMemory.followUps || []).filter(text => !_isLowInfoMemoryText(text))
    if (followUps.length > 0) {
      parts.push(`上次承诺跟进：${followUps.slice(0, 3).join('；')}`)
    }
  }

  return parts.join('\n')
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
  markMemoryItemsUsed,
  getMemoryDebugSnapshot,
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
