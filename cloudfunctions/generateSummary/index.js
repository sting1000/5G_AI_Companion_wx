// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ARK_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const ARK_REQUEST_TIMEOUT_MS = Number(process.env.ARK_REQUEST_TIMEOUT_MS || 2200)
const DEFAULT_SUMMARY_MODEL = 'doubao-seed-2-0-mini-260215'
const DEFAULT_SUMMARY = {
  summary: '',
  topics: [],
  highlights: [],
  mood: '平静',
  moodEmoji: '😌',
  reminderCandidates: [],
}
const MOOD_EMOJI_MAP = {
  开心: '😊',
  平静: '😌',
  低落: '😢',
  焦虑: '😟',
}

/**
 * 生成通话摘要
 * @param {object} event
 * @param {Array} event.messages - 通话消息 [{role, content}]
 * @param {string} event.elderName - 老人姓名
 */
exports.main = async (event, context) => {
  const { messages, elderName } = event
  const requestId = (context && (context.requestId || context.request_id)) || ''
  const startedAt = Date.now()
  const baseMetric = {
    requestId,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    timeoutMs: ARK_REQUEST_TIMEOUT_MS,
  }

  if (!messages || messages.length === 0) {
    console.log('[SummaryMetric]', JSON.stringify({
      ...baseMetric,
      outcome: 'invalid_input',
      totalLatencyMs: Date.now() - startedAt,
    }))
    return {
      success: false,
      error: '没有通话内容',
    }
  }

  // 从环境变量获取 API Key，如果没有则使用 event 中传入的
  const apiKey = process.env.ARK_API_KEY || event.apiKey
  const modelId = process.env.ARK_SUMMARY_MODEL || event.model || DEFAULT_SUMMARY_MODEL
  if (!apiKey) {
    // 没有 API Key 时，使用本地规则生成简易摘要
    const fallback = generateLocalSummary(messages, elderName)
    console.log('[SummaryMetric]', JSON.stringify({
      ...baseMetric,
      modelId,
      outcome: 'fallback_no_api_key',
      summarySource: fallback && fallback.data ? fallback.data.summarySource : 'local_rule',
      totalLatencyMs: Date.now() - startedAt,
    }))
    return fallback
  }

  try {
    // 构造对话文本
    const transcript = messages
      .map(m => `${m.role === 'user' ? elderName || '老人' : '小林'}: ${m.content}`)
      .join('\n')

    const prompt = `你是一个通话摘要分析师。请分析以下AI陪伴通话记录，生成结构化摘要。

通话记录：
${transcript}

请以如下JSON格式返回（不要包含markdown标记）：
{
  "summary": "一段50-100字的通话概要，描述主要聊了什么",
  "topics": ["话题标签1", "话题标签2"],
  "highlights": ["重要提及1", "重要提及2"],
  "mood": "开心/平静/低落/焦虑",
  "moodEmoji": "😊/😌/😢/😟",
  "reminderCandidates": [
    {
      "title": "提醒内容",
      "scheduleType": "once/daily/weekly/monthly",
      "timeOfDay": "HH:mm",
      "remindDate": "YYYY-MM-DD或空字符串",
      "confidence": 0.0,
      "evidence": "原话摘录"
    }
  ]
}`

    const arkStartedAt = Date.now()
    const response = await callArkAPI(apiKey, modelId, prompt, ARK_REQUEST_TIMEOUT_MS)
    const arkLatencyMs = Date.now() - arkStartedAt

    if (response) {
      const result = normalizeSummaryData(parseModelSummary(response), {
        source: 'cloud_ark',
        model: modelId,
      })
      console.log('[SummaryMetric]', JSON.stringify({
        ...baseMetric,
        modelId,
        outcome: 'cloud_success',
        arkLatencyMs,
        totalLatencyMs: Date.now() - startedAt,
        summarySource: result.summarySource,
      }))
      return {
        success: true,
        data: result,
      }
    }

    const fallback = generateLocalSummary(messages, elderName)
    console.log('[SummaryMetric]', JSON.stringify({
      ...baseMetric,
      modelId,
      outcome: 'fallback_empty_response',
      arkLatencyMs,
      totalLatencyMs: Date.now() - startedAt,
      summarySource: fallback && fallback.data ? fallback.data.summarySource : 'local_rule',
    }))
    return fallback
  } catch (err) {
    console.error('摘要生成失败:', err)
    const fallback = generateLocalSummary(messages, elderName)
    console.log('[SummaryMetric]', JSON.stringify({
      ...baseMetric,
      modelId,
      outcome: 'fallback_error',
      errorName: err && err.name ? err.name : 'Error',
      errorMessage: err && err.message ? String(err.message).slice(0, 200) : 'unknown',
      totalLatencyMs: Date.now() - startedAt,
      summarySource: fallback && fallback.data ? fallback.data.summarySource : 'local_rule',
    }))
    return fallback
  }
}

function parseModelSummary(rawText) {
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
      const slice = content.slice(start, end + 1)
      return JSON.parse(slice)
    }
    throw err
  }
}

function normalizeSummaryData(rawData, meta) {
  const input = rawData && typeof rawData === 'object' ? rawData : {}
  const moodLabel = normalizeMoodLabel(input.mood)
  const moodEmoji = normalizeMoodEmoji(input.moodEmoji, moodLabel)
  const reminders = Array.isArray(input.reminderCandidates)
    ? input.reminderCandidates.map(normalizeReminderCandidate).filter(Boolean).slice(0, 6)
    : []
  return {
    summary: String(input.summary || DEFAULT_SUMMARY.summary).trim(),
    topics: normalizeStringList(input.topics, 6),
    highlights: normalizeStringList(input.highlights, 5),
    mood: moodLabel,
    moodEmoji,
    reminderCandidates: reminders,
    summarySource: (meta && meta.source) || 'cloud_ark',
    summaryModel: (meta && meta.model) || '',
  }
}

function normalizeStringList(items, maxCount) {
  if (!Array.isArray(items)) return []
  const uniqMap = {}
  items.forEach(item => {
    const text = String(item || '').trim()
    if (!text) return
    if (!uniqMap[text]) {
      uniqMap[text] = true
    }
  })
  return Object.keys(uniqMap).slice(0, maxCount || 5)
}

function normalizeMoodLabel(input) {
  const text = String(input || '').trim()
  if (text === '开心' || text === '平静' || text === '低落' || text === '焦虑') {
    return text
  }
  if (/开心|高兴|愉快/.test(text)) return '开心'
  if (/焦虑|担心|紧张/.test(text)) return '焦虑'
  if (/低落|难过|伤心/.test(text)) return '低落'
  return DEFAULT_SUMMARY.mood
}

function normalizeMoodEmoji(input, moodLabel) {
  const text = String(input || '').trim()
  if (text === '😊' || text === '😌' || text === '😢' || text === '😟') {
    return text
  }
  return MOOD_EMOJI_MAP[moodLabel] || DEFAULT_SUMMARY.moodEmoji
}

function normalizeReminderCandidate(item) {
  if (!item || typeof item !== 'object') return null
  const title = String(item.title || '').trim()
  if (!title) return null
  const scheduleType = String(item.scheduleType || 'once').trim()
  const validSchedule = scheduleType === 'once' || scheduleType === 'daily' || scheduleType === 'weekly' || scheduleType === 'monthly'
  const timeOfDay = String(item.timeOfDay || '09:00').trim()
  const remindDate = String(item.remindDate || '').trim()
  const confidence = Math.max(0, Math.min(1, Number(item.confidence || 0.6)))
  const evidence = String(item.evidence || title).trim()
  return {
    title,
    scheduleType: validSchedule ? scheduleType : 'once',
    timeOfDay: /^\d{1,2}:\d{1,2}$/.test(timeOfDay) ? timeOfDay : '09:00',
    remindDate,
    confidence: Number(confidence.toFixed(3)),
    evidence: evidence || title,
  }
}

/**
 * 调用火山方舟 LLM API
 */
async function callArkAPI(apiKey, modelId, prompt, timeoutMs) {
  // 使用 Node.js 内置 https 模块（云函数环境不保证有 fetch）
  const https = require('https')
  const url = new URL(ARK_API_URL)

  const requestBody = JSON.stringify({
    model: modelId,
    messages: [
      { role: 'system', content: '你是通话摘要分析助手，请严格按照JSON格式输出。' },
      { role: 'user', content: prompt },
    ],
    thinking: { type: 'disabled' },
    reasoning_effort: 'minimal',
    temperature: 0.3,
    max_tokens: 220,
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
          const content = json.choices?.[0]?.message?.content || ''
          resolve(content)
        } catch (e) {
          reject(e)
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(timeoutMs || ARK_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`ARK API request timeout after ${timeoutMs || ARK_REQUEST_TIMEOUT_MS}ms`))
    })
    req.write(requestBody)
    req.end()
  })
}

/**
 * 本地规则生成简易摘要（无需 API Key 的 fallback）
 */
function generateLocalSummary(messages, elderName) {
  const name = elderName || '老人'
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content)

  // 简单提取话题关键词
  const topicKeywords = ['健康', '养生', '太极拳', '书法', '电视剧', '运动', '做饭', '烹饪',
    '家庭', '孩子', '天气', '散步', '公园', '邻居', '朋友', '睡眠', '吃饭', '买菜']
  const allText = messages.map(m => m.content).join(' ')
  const topics = topicKeywords.filter(k => allText.includes(k))

  // 简单摘要
  const totalMessages = messages.length
  const summary = `${name}和小林进行了${totalMessages}轮对话。` +
    (topics.length > 0 ? `话题涉及${topics.join('、')}。` : '') +
    (userMessages.length > 0 ? `${name}主动发言${userMessages.length}次。` : '')

  return {
    success: true,
    data: normalizeSummaryData({
      summary,
      topics: topics.length > 0 ? topics : ['日常聊天'],
      highlights: userMessages.slice(0, 3),
      mood: DEFAULT_SUMMARY.mood,
      moodEmoji: DEFAULT_SUMMARY.moodEmoji,
      reminderCandidates: [],
    }, {
      source: 'local_rule',
      model: '',
    }),
  }
}
