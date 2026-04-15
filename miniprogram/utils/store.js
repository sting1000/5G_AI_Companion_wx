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
}

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

function _memoryItemId(type, text) {
  const base = `${type}:${_normalizeMemoryText(text)}`
  return `mem_${Date.now()}_${base.slice(0, 24)}`
}

function _buildMemoryItem(type, text, source, confidence, now, evidence) {
  const cleanText = _normalizeMemoryText(text)
  if (!cleanText) return null
  return {
    id: _memoryItemId(type, cleanText),
    type,
    text: cleanText,
    source: source || 'summary',
    confidence: Math.max(0, Math.min(1, Number(confidence || 0.6))),
    stability: type === 'interest' || type === 'healthNote' ? 'stable' : 'semi_stable',
    createdAt: now,
    lastUsedAt: '',
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

function _mergeMemoryItems(existingItems, deltaItems) {
  const now = new Date().toISOString()
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
      source: item.source || 'summary',
      createdAt: item.createdAt || now,
      lastUsedAt: item.lastUsedAt || '',
      stability: item.stability || (type === 'interest' || type === 'healthNote' ? 'stable' : 'semi_stable'),
      evidence: item.evidence || text,
    })
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

  const memoryItems = (bundle.memoryItems || [])
    .filter(item => item && item.text)
    .filter(item => item.confidence >= minConfidence)
    .filter(item => !excludeSet.has(_normalizeMemoryText(item.text)))
    .filter(item => {
      if (item.type === 'interest' || item.type === 'healthNote') return true
      return _isRecent(item.createdAt, 45)
    })

  if (memoryItems.length > 0) {
    const pickedTypes = {}
    const selected = memoryItems
      .sort((a, b) => {
        const typeRank = { followUp: 3, recentEvent: 2, interest: 1 }
        const ar = typeRank[a.type] || 0
        const br = typeRank[b.type] || 0
        if (br !== ar) return br - ar
        if (b.confidence !== a.confidence) return b.confidence - a.confidence
        return Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '')
      })
      .filter(item => {
        if (!(item.type === 'followUp' || item.type === 'recentEvent' || item.type === 'interest')) return false
        if (pickedTypes[item.type]) return false
        pickedTypes[item.type] = true
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
    parts.push(`老人近期事件：${elderMemory.recentEvents.slice(0, 3).join('；')}`)
  }
  if (elderMemory.interestTags && elderMemory.interestTags.length > 0) {
    parts.push(`老人兴趣：${elderMemory.interestTags.slice(0, 5).join('、')}`)
  }
  if (xiaolinMemory.preferredAddress) {
    parts.push(`偏好称呼：${xiaolinMemory.preferredAddress}`)
  }
  if (xiaolinMemory.followUps && xiaolinMemory.followUps.length > 0) {
    parts.push(`上次承诺跟进：${xiaolinMemory.followUps.slice(0, 3).join('；')}`)
  }

  return parts.join('\n')
}

function markMemoryItemsUsed(elderKey, texts) {
  const scopedKey = elderKey || getElderKey()
  const bundle = getMemoryBundle(scopedKey)
  const usedSet = new Set([].concat(texts || []).map(_normalizeMemoryText).filter(Boolean))
  if (usedSet.size === 0) return false
  const now = new Date().toISOString()
  let changed = false
  const nextItems = (bundle.memoryItems || []).map(item => {
    if (usedSet.has(_normalizeMemoryText(item.text))) {
      changed = true
      return Object.assign({}, item, { lastUsedAt: now })
    }
    return item
  })
  if (!changed) return false
  saveMemoryBundle(Object.assign({}, bundle, { memoryItems: nextItems }), scopedKey)
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
  getProfile,
  updateProfile,
  clearAllRuntimeData,
}
