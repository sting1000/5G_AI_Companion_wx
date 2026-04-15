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
      version: 1,
      updatedFromCallId: '',
      memoryUpdatedAt: '',
    },
  }
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

  const next = {
    elderMemory,
    xiaolinMemory,
    memoryMeta: Object.assign({}, current.memoryMeta, {
      version: 1,
      updatedFromCallId: callId || '',
      memoryUpdatedAt: now,
    }),
  }
  saveMemoryBundle(next, scopedKey)
  return next
}

function buildMemoryPrompt(elderKey) {
  const bundle = getMemoryBundle(elderKey)
  const parts = []
  const elderMemory = bundle.elderMemory || {}
  const xiaolinMemory = bundle.xiaolinMemory || {}

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
  getMemoryDebugSnapshot,
  getProfile,
  updateProfile,
  clearAllRuntimeData,
}
