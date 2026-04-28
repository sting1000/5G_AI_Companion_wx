// 云函数入口文件：从通话记录中抽取长期记忆 patch
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ARK_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const ARK_REQUEST_TIMEOUT_MS = Number(process.env.ARK_MEMORY_REQUEST_TIMEOUT_MS || 2600)
const DEFAULT_MEMORY_MODEL = 'doubao-seed-2-0-mini-260215'

const EMPTY_DELTA = {
  elderMemory: {
    interestTags: [],
    healthNotes: [],
    routineNotes: [],
    recentEvents: [],
  },
  xiaolinMemory: {
    followUps: [],
    tabooTopics: [],
    careStrategies: [],
  },
  memoryItems: [],
}

exports.main = async (event, context) => {
  const messages = Array.isArray(event && event.messages) ? event.messages : []
  const summaryData = event && event.summaryData ? event.summaryData : {}
  const requestId = (context && (context.requestId || context.request_id)) || ''
  const startedAt = Date.now()
  const baseMetric = {
    requestId,
    callId: event && event.callId ? event.callId : '',
    messageCount: messages.length,
    timeoutMs: ARK_REQUEST_TIMEOUT_MS,
  }

  if (messages.length === 0) {
    console.log('[MemoryMetric]', JSON.stringify({
      ...baseMetric,
      outcome: 'invalid_input',
      totalLatencyMs: Date.now() - startedAt,
    }))
    return {
      success: false,
      error: '没有通话内容',
      data: EMPTY_DELTA,
    }
  }

  const apiKey = process.env.ARK_API_KEY || event.apiKey
  const modelId = process.env.ARK_MEMORY_MODEL || event.model || DEFAULT_MEMORY_MODEL
  if (!apiKey) {
    console.log('[MemoryMetric]', JSON.stringify({
      ...baseMetric,
      modelId,
      outcome: 'fallback_no_api_key',
      totalLatencyMs: Date.now() - startedAt,
    }))
    return {
      success: false,
      error: '缺少 ARK_API_KEY',
      data: EMPTY_DELTA,
    }
  }

  try {
    const prompt = buildPrompt({
      messages,
      summaryData,
      elderName: event.elderName || '老人',
      callId: event.callId || '',
    })
    const arkStartedAt = Date.now()
    const response = await callArkAPI(apiKey, modelId, prompt, ARK_REQUEST_TIMEOUT_MS)
    const arkLatencyMs = Date.now() - arkStartedAt
    const normalized = normalizeMemoryDelta(parseModelJSON(response))
    console.log('[MemoryMetric]', JSON.stringify({
      ...baseMetric,
      modelId,
      outcome: 'cloud_success',
      memoryItemCount: normalized.memoryItems.length,
      arkLatencyMs,
      totalLatencyMs: Date.now() - startedAt,
    }))
    return {
      success: true,
      data: normalized,
    }
  } catch (err) {
    console.error('记忆抽取失败:', err)
    console.log('[MemoryMetric]', JSON.stringify({
      ...baseMetric,
      modelId,
      outcome: 'fallback_error',
      errorMessage: err && err.message ? String(err.message).slice(0, 200) : 'unknown',
      totalLatencyMs: Date.now() - startedAt,
    }))
    return {
      success: false,
      error: '记忆抽取失败',
      data: EMPTY_DELTA,
    }
  }
}

function buildPrompt({ messages, summaryData, elderName, callId }) {
  const transcript = messages
    .map((item, idx) => {
      const speaker = item.role === 'user' ? elderName : '小林'
      return `${idx + 1}. ${speaker}: ${String(item.content || '').trim()}`
    })
    .join('\n')
  const summary = JSON.stringify(summaryData || {})

  return `你是老年陪伴助手的记忆抽取器。请只抽取未来通话真正有帮助、可被老人或家属解释清楚的长期记忆。

要求：
1. 不要抽取寒暄、短答、低信息句。
2. 健康、用药、情绪异常、家庭矛盾等敏感信息必须 needsConfirmation=true。
3. 事实不确定时 needsConfirmation=true，confidence 不超过 0.7。
4. 提醒/待办只放到 followUp 或 memoryItems，不要编造日期。
5. 每条 memoryItem 必须有 evidence，优先引用用户原话的短片段。
6. 只返回 JSON，不要 markdown。

通话ID：${callId}
摘要：${summary}

通话记录：
${transcript}

返回格式：
{
  "elderMemory": {
    "interestTags": ["兴趣标签"],
    "healthNotes": ["健康背景"],
    "routineNotes": ["日常习惯"],
    "recentEvents": ["近期具体事件"]
  },
  "xiaolinMemory": {
    "followUps": ["下次应跟进事项"],
    "tabooTopics": ["慎提话题"],
    "careStrategies": ["对这个老人有效的沟通策略"]
  },
  "memoryItems": [
    {
      "type": "interest/healthNote/routineNote/recentEvent/followUp/tabooTopic",
      "text": "一句完整记忆",
      "confidence": 0.0,
      "evidence": "原话证据",
      "validFrom": "",
      "validTo": "",
      "expiresAt": "",
      "sensitivity": "normal/sensitive",
      "needsConfirmation": false
    }
  ]
}`
}

function parseModelJSON(rawText) {
  const content = String(rawText || '')
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim()
  if (!content) return {}
  try {
    return JSON.parse(content)
  } catch (err) {
    const start = content.indexOf('{')
    const end = content.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end + 1))
    }
    throw err
  }
}

function normalizeMemoryDelta(rawData) {
  const input = rawData && typeof rawData === 'object' ? rawData : {}
  const elderMemory = input.elderMemory && typeof input.elderMemory === 'object' ? input.elderMemory : {}
  const xiaolinMemory = input.xiaolinMemory && typeof input.xiaolinMemory === 'object' ? input.xiaolinMemory : {}
  return {
    elderMemory: {
      interestTags: normalizeStringList(elderMemory.interestTags, 8),
      healthNotes: normalizeStringList(elderMemory.healthNotes, 6),
      routineNotes: normalizeStringList(elderMemory.routineNotes, 6),
      recentEvents: normalizeStringList(elderMemory.recentEvents, 8),
    },
    xiaolinMemory: {
      followUps: normalizeStringList(xiaolinMemory.followUps, 6),
      tabooTopics: normalizeStringList(xiaolinMemory.tabooTopics, 4),
      careStrategies: normalizeStringList(xiaolinMemory.careStrategies, 4),
    },
    memoryItems: Array.isArray(input.memoryItems)
      ? input.memoryItems.map(normalizeMemoryItem).filter(Boolean).slice(0, 12)
      : [],
  }
}

function normalizeMemoryItem(item) {
  if (!item || typeof item !== 'object') return null
  const type = normalizeType(item.type)
  const text = normalizeText(item.text)
  if (!text || isLowInfo(text)) return null
  const confidence = Math.max(0, Math.min(1, Number(item.confidence || 0.7)))
  const sensitivity = item.sensitivity === 'sensitive' || type === 'healthNote'
    ? 'sensitive'
    : 'normal'
  const needsConfirmation = typeof item.needsConfirmation === 'boolean'
    ? item.needsConfirmation
    : (sensitivity === 'sensitive' || confidence < 0.7)
  return {
    type,
    text,
    confidence: Number(confidence.toFixed(3)),
    evidence: normalizeText(item.evidence) || text,
    validFrom: normalizeText(item.validFrom),
    validTo: normalizeText(item.validTo),
    expiresAt: normalizeText(item.expiresAt),
    sensitivity,
    needsConfirmation,
  }
}

function normalizeType(type) {
  const raw = String(type || '').trim()
  const aliasMap = {
    health: 'healthNote',
    health_note: 'healthNote',
    healthNote: 'healthNote',
    interest: 'interest',
    hobby: 'interest',
    routine: 'routineNote',
    routine_note: 'routineNote',
    routineNote: 'routineNote',
    recent_event: 'recentEvent',
    recentEvent: 'recentEvent',
    event: 'recentEvent',
    follow_up: 'followUp',
    followUp: 'followUp',
    taboo: 'tabooTopic',
    taboo_topic: 'tabooTopic',
    tabooTopic: 'tabooTopic',
  }
  return aliasMap[raw] || 'recentEvent'
}

function normalizeStringList(items, maxCount) {
  const seen = {}
  const result = []
  ;(Array.isArray(items) ? items : []).forEach(item => {
    const text = normalizeText(item)
    if (!text || seen[text] || isLowInfo(text)) return
    seen[text] = true
    result.push(text)
  })
  return result.slice(0, maxCount || 5)
}

function normalizeText(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[。！？!?,，、；;]+$/g, '')
}

function isLowInfo(text) {
  const line = normalizeText(text)
  if (!line || line.length <= 3) return true
  if (/^(还不错|挺好|很好|还好|一般|就那样|可以|行|嗯|嗯嗯|哦|好的|没事|没什么|都好|还行|可以的|还可以|是的|对|对的|好)$/.test(line)) {
    return true
  }
  if (/^(过得|日子|最近)?(还|挺|就)?(行|还行|一般|凑合|那样)(吧|呢|呀)?$/.test(line)) {
    return true
  }
  return false
}

async function callArkAPI(apiKey, modelId, prompt, timeoutMs) {
  const https = require('https')
  const url = new URL(ARK_API_URL)
  const requestBody = JSON.stringify({
    model: modelId,
    messages: [
      { role: 'system', content: '你是记忆抽取器，必须严格输出 JSON。' },
      { role: 'user', content: prompt },
    ],
    thinking: { type: 'disabled' },
    reasoning_effort: 'minimal',
    temperature: 0.1,
    max_tokens: 700,
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          resolve(json.choices?.[0]?.message?.content || '')
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs || ARK_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`ARK memory request timeout after ${timeoutMs || ARK_REQUEST_TIMEOUT_MS}ms`))
    })
    req.write(requestBody)
    req.end()
  })
}
