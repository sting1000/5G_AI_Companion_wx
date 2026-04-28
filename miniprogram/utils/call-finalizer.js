const { createLogger } = require('./logger')
const logger = createLogger('CallFinalizer')

function buildLocalSummaryPayload(record, elderName, normalizeSummaryPayload) {
  const messages = (record && record.messages) || []
  const userMsgs = messages.filter(m => m.role === 'user').map(m => m.content)
  const allText = messages.map(m => m.content).join(' ')
  const healthKeywords = ['心脏病', '胸闷', '胸痛', '心慌', '心悸', '不舒服', '难受', '头晕', '血压', '血糖', '失眠', '吃药', '没药', '复查', '复诊']
  const interestKeywords = ['太极拳', '书法', '电视剧', '运动', '做饭', '烹饪', '散步', '公园', '邻居', '广场舞', '跳舞']
  const healthTopics = healthKeywords.filter(k => allText.includes(k))
  const interestTopics = interestKeywords.filter(k => allText.includes(k))
  const topics = []
  if (healthTopics.length > 0) topics.push('健康关注')
  topics.push.apply(topics, interestTopics)
  const dedupTopics = Array.from(new Set(topics)).slice(0, 6)
  const healthHighlight = userMsgs.filter(text => /(心脏病|胸闷|胸痛|不舒服|难受|没药|没带药|吃药|血压|血糖|焦虑|紧张|状态不好)/.test(String(text || ''))).slice(0, 2)
  const genericHighlights = userMsgs.slice(0, 3)
  const highlights = Array.from(new Set([].concat(healthHighlight, genericHighlights))).slice(0, 3)
  const summary = `${elderName}和小林进行了${messages.length}轮对话。`
    + (dedupTopics.length > 0 ? `话题涉及${dedupTopics.join('、')}。` : '')
    + (healthTopics.length > 0 ? '对话中出现了健康不适与用药相关线索，建议优先跟进。' : '')

  return normalizeSummaryPayload({
    summary,
    topics: dedupTopics.length > 0 ? dedupTopics : ['日常聊天'],
    highlights,
    mood: '',
    moodEmoji: '',
    summarySource: 'local_rule',
    summaryModel: '',
  }, record, { preferSource: 'local_rule' })
}

function applyLocalSummary(record, options) {
  const {
    elderName,
    normalizeSummaryPayload,
    updateCallRecord,
    evolveMemory,
  } = options
  const summaryPayload = buildLocalSummaryPayload(record, elderName, normalizeSummaryPayload)
  updateCallRecord(record.id, Object.assign({}, summaryPayload, {
    summaryStatus: 'done',
    summaryUpdatedAt: new Date().toISOString(),
    summaryError: '',
  }))
  evolveMemory(record, {
    summary: summaryPayload.summary,
    topics: summaryPayload.topics,
    highlights: summaryPayload.highlights,
    mood: summaryPayload.moodLabel,
    moodEmoji: summaryPayload.mood,
  })
}

function generateSummary(record, options) {
  if (!record || !record.messages || record.messages.length === 0) return
  const {
    elderName,
    normalizeSummaryPayload,
    updateCallRecord,
    evolveMemory,
  } = options
  const fallback = () => applyLocalSummary(record, options)

  if (!wx.cloud) {
    fallback()
    return
  }

  wx.cloud.callFunction({
    name: 'generateSummary',
    data: {
      messages: record.messages,
      elderName,
    },
  }).then((res) => {
    if (res.result && res.result.success) {
      const summaryPayload = Object.assign(
        {},
        normalizeSummaryPayload(res.result.data, record, { preferSource: 'cloud_ark' }),
        {
          summaryStatus: 'done',
          summaryUpdatedAt: new Date().toISOString(),
          summaryError: '',
        }
      )
      updateCallRecord(record.id, summaryPayload)
      evolveMemory(record, summaryPayload)
      return
    }
    fallback()
  }).catch((err) => {
    logger.warn('云函数摘要生成失败，使用本地生成:', err)
    fallback()
  })
}

module.exports = {
  generateSummary,
  applyLocalSummary,
}
