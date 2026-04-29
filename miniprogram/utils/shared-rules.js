const MOOD_MAP = {
  开心: '😊',
  平静: '😌',
  低落: '😢',
  焦虑: '😟',
}
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

function normalizeTextList(items, maxCount) {
  if (!Array.isArray(items)) return []
  const uniqMap = {}
  items.forEach((item) => {
    const text = String(item || '').trim()
    if (!text || uniqMap[text]) return
    uniqMap[text] = true
  })
  return Object.keys(uniqMap).slice(0, maxCount || 5)
}

function normalizeMoodLabel(input) {
  const text = String(input || '').trim()
  if (!text) return ''
  if (MOOD_MAP[text]) return text
  if (/焦虑|担心|紧张|害怕|不舒服|难受|疼|痛/.test(text)) return '焦虑'
  if (/低落|难过|伤心|孤单|孤独|失落/.test(text)) return '低落'
  if (/开心|高兴|愉快|放心|舒服多了|好多了|顺利/.test(text)) return '开心'
  if (/平静|稳定|平稳/.test(text)) return '平静'
  return ''
}

function normalizeMoodEmoji(input, moodLabel) {
  const text = String(input || '').trim()
  if (MOOD_MAP[moodLabel]) return MOOD_MAP[moodLabel]
  if (text === '😊' || text === '😌' || text === '😢' || text === '😟') return text
  return ''
}

function inferMoodFromText(text) {
  const normalized = String(text || '').replace(/\s+/g, '')
  if (!normalized) return { mood: '😌', moodLabel: '平静' }
  if (/(担心|焦虑|紧张|害怕|慌|发愁|烦|睡不着|失眠|不舒服|难受|疼|痛|胸闷|胸痛|头晕|血压高|血糖高|没药|忘吃药)/.test(normalized)) return { mood: '😟', moodLabel: '焦虑' }
  if (/(难过|低落|伤心|没意思|孤单|孤独|失落|想哭|不想说话|提不起劲)/.test(normalized)) return { mood: '😢', moodLabel: '低落' }
  if (/(开心|高兴|不错|挺好|愉快|放心|舒服多了|好多了|顺利|满意)/.test(normalized)) return { mood: '😊', moodLabel: '开心' }
  return { mood: '😌', moodLabel: '平静' }
}

function inferMoodFromMessages(messages) {
  const userText = (messages || [])
    .filter(item => item && item.role === 'user')
    .map(item => String(item.content || '').trim())
    .join(' ')
  return inferMoodFromText(userText)
}

function normalizeSummaryPayload(summaryData, record, options) {
  const payload = summaryData && typeof summaryData === 'object' ? summaryData : {}
  const moodFromModel = normalizeMoodLabel(payload.mood || payload.moodLabel)
  const moodFallback = inferMoodFromMessages((record && record.messages) || [])
  const summarySource = String(payload.summarySource || (options && options.preferSource) || 'local_rule').trim()
  const shouldUseMoodFallback = moodFromModel === '平静'
    && moodFallback.moodLabel
    && moodFallback.moodLabel !== '平静'
    && summarySource === 'local_rule'
  const finalMoodLabel = shouldUseMoodFallback
    ? moodFallback.moodLabel
    : (moodFromModel || moodFallback.moodLabel || '平静')
  const finalMoodEmoji = normalizeMoodEmoji(payload.moodEmoji, finalMoodLabel) || moodFallback.mood || '😌'
  return {
    summary: String(payload.summary || '').trim(),
    topics: normalizeTextList(payload.topics, 6),
    highlights: normalizeTextList(payload.highlights, 5),
    reminderCandidates: Array.isArray(payload.reminderCandidates) ? payload.reminderCandidates : [],
    mood: finalMoodEmoji,
    moodLabel: finalMoodLabel,
    summarySource,
    summaryModel: String(payload.summaryModel || '').trim(),
  }
}

module.exports = {
  extractHealthTags,
  normalizeInterestTags,
  uniqTags,
  normalizeTextList,
  normalizeMoodLabel,
  normalizeMoodEmoji,
  inferMoodFromText,
  inferMoodFromMessages,
  normalizeSummaryPayload,
}
