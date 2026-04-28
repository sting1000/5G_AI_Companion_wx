const MOOD_MAP = {
  开心: '😊',
  平静: '😌',
  低落: '😢',
  焦虑: '😟',
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
    .map(item => item.trim())
    .filter(Boolean)
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
  if (/开心|高兴|愉快/.test(text)) return '开心'
  if (/焦虑|担心|紧张/.test(text)) return '焦虑'
  if (/低落|难过|伤心/.test(text)) return '低落'
  if (/平静|稳定|平稳/.test(text)) return '平静'
  return ''
}

function normalizeMoodEmoji(input, moodLabel) {
  const text = String(input || '').trim()
  if (text === '😊' || text === '😌' || text === '😢' || text === '😟') return text
  return MOOD_MAP[moodLabel] || ''
}

function inferMoodFromMessages(messages) {
  const userText = (messages || [])
    .filter(item => item && item.role === 'user')
    .map(item => String(item.content || '').trim())
    .join(' ')
  const normalized = userText.replace(/\s+/g, '')
  if (!normalized) return { mood: '😌', moodLabel: '平静' }
  if (/(担心|焦虑|紧张|害怕|睡不着|不舒服|难受|疼)/.test(normalized)) return { mood: '😟', moodLabel: '焦虑' }
  if (/(难过|低落|伤心|没意思|孤单|失落)/.test(normalized)) return { mood: '😢', moodLabel: '低落' }
  if (/(开心|高兴|不错|挺好|愉快|放心)/.test(normalized)) return { mood: '😊', moodLabel: '开心' }
  return { mood: '😌', moodLabel: '平静' }
}

function normalizeSummaryPayload(summaryData, record, options) {
  const payload = summaryData && typeof summaryData === 'object' ? summaryData : {}
  const moodFromModel = normalizeMoodLabel(payload.mood || payload.moodLabel)
  const moodFallback = inferMoodFromMessages((record && record.messages) || [])
  const finalMoodLabel = moodFromModel || moodFallback.moodLabel || '平静'
  const finalMoodEmoji = normalizeMoodEmoji(payload.moodEmoji, finalMoodLabel) || moodFallback.mood || '😌'
  return {
    summary: String(payload.summary || '').trim(),
    topics: normalizeTextList(payload.topics, 6),
    highlights: normalizeTextList(payload.highlights, 5),
    reminderCandidates: Array.isArray(payload.reminderCandidates) ? payload.reminderCandidates : [],
    mood: finalMoodEmoji,
    moodLabel: finalMoodLabel,
    summarySource: String(payload.summarySource || (options && options.preferSource) || 'local_rule').trim(),
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
  inferMoodFromMessages,
  normalizeSummaryPayload,
}
