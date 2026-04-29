/**
 * 提醒事项抽取与归一化
 * 统一服务实时 ASR 快判和通话后摘要候选校验。
 */

const DEFAULT_TIME_OF_DAY = '09:00'
const VALID_SCHEDULE_TYPES = ['once', 'daily', 'weekly', 'monthly']
const WEEKDAY_MAP = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
}

function normalizeSentence(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[。！？!?,，、；;]+$/g, '')
}

function clampConfidence(value, fallback) {
  const raw = Number(value)
  const safe = Number.isFinite(raw) ? raw : fallback
  return Math.max(0, Math.min(1, safe))
}

function parseChineseNumber(text) {
  const raw = String(text || '').trim()
  if (!raw) return NaN
  if (/^\d+$/.test(raw)) return Number(raw)
  const digitMap = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  }
  if (Object.prototype.hasOwnProperty.call(digitMap, raw)) return digitMap[raw]
  if (raw === '十') return 10
  if (/^十[一二两三四五六七八九]$/.test(raw)) {
    return 10 + (digitMap[raw.charAt(1)] || 0)
  }
  if (/^[一二两三四五六七八九]十$/.test(raw)) {
    return (digitMap[raw.charAt(0)] || 0) * 10
  }
  if (/^[一二两三四五六七八九]十[一二两三四五六七八九]$/.test(raw)) {
    return (digitMap[raw.charAt(0)] || 0) * 10 + (digitMap[raw.charAt(2)] || 0)
  }
  return NaN
}

function applyMeridiemToHour(hour, normalizedText) {
  const normalized = normalizeSentence(normalizedText)
  let h = Math.min(23, Math.max(0, Number(hour) || 0))
  const hasAfternoon = /下午/.test(normalized)
  const hasEvening = /晚上|今晚|夜里|夜间/.test(normalized)
  const hasNoon = /中午/.test(normalized)
  const hasMorning = /上午|早上|清晨/.test(normalized)
  const hasEarlyMorning = /凌晨/.test(normalized)

  if ((hasAfternoon || hasEvening) && h > 0 && h < 12) h += 12
  if (hasNoon && h > 0 && h < 11) h += 12
  if (hasEarlyMorning && h === 12) h = 0
  if (hasMorning && h === 12) h = 0
  if (hasEvening && h === 12) h = 0
  return h
}

function normalizeTime(rawTime, text) {
  const normalized = normalizeSentence(text)
  let hour = 9
  let minute = 0
  let hasConcreteTime = false
  let hasPeriodOnly = false

  const hhmmMatch = String(rawTime || '').trim().match(/^(\d{1,2})[:：](\d{1,2})$/)
  if (hhmmMatch) {
    hour = Math.min(23, Math.max(0, Number(hhmmMatch[1]) || 0))
    minute = Math.min(59, Math.max(0, Number(hhmmMatch[2]) || 0))
    hasConcreteTime = true
  } else {
    const textHhmmMatch = normalized.match(/(\d{1,2})[:：](\d{1,2})/)
    if (textHhmmMatch) {
      hour = Math.min(23, Math.max(0, Number(textHhmmMatch[1]) || 0))
      minute = Math.min(59, Math.max(0, Number(textHhmmMatch[2]) || 0))
      hasConcreteTime = true
    } else {
      const pointMatch = normalized.match(/(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})点(半|[零〇一二两三四五六七八九十\d]{1,3}分?)?(?:钟)?/)
      if (pointMatch) {
        const parsedHour = parseChineseNumber(pointMatch[1])
        hour = Math.min(23, Math.max(0, Number(parsedHour) || 0))
        if (pointMatch[2]) {
          if (String(pointMatch[2]).includes('半')) {
            minute = 30
          } else {
            const minuteText = String(pointMatch[2]).replace(/分/g, '')
            const parsedMinute = parseChineseNumber(minuteText)
            minute = Math.min(59, Math.max(0, Number(parsedMinute) || 0))
          }
        }
        hasConcreteTime = true
      } else if (/晚上|今晚/.test(normalized)) {
        hour = 20
        hasPeriodOnly = true
      } else if (/上午|早上|清晨/.test(normalized)) {
        hour = 9
        hasPeriodOnly = true
      } else if (/中午/.test(normalized)) {
        hour = 12
        hasPeriodOnly = true
      } else if (/下午/.test(normalized)) {
        hour = 14
        hasPeriodOnly = true
      }
    }
  }

  const adjustedHour = applyMeridiemToHour(hour, normalized)
  return {
    timeOfDay: `${String(adjustedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    hasConcreteTime,
    hasPeriodOnly,
  }
}

function startOfDay(date) {
  const input = date instanceof Date ? date : new Date()
  return new Date(input.getFullYear(), input.getMonth(), input.getDate())
}

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDateOffset(baseDate, days) {
  const date = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000)
  return formatDate(date)
}

function getWeekdayIndex(char) {
  return Object.prototype.hasOwnProperty.call(WEEKDAY_MAP, char) ? WEEKDAY_MAP[char] : null
}

function resolveNextWeekday(today, weekdayIndex, forceNextWeek) {
  const current = today.getDay()
  if (forceNextWeek) {
    const daysToNextMonday = current === 0 ? 1 : 8 - current
    const weekdayOffsetFromMonday = weekdayIndex === 0 ? 6 : weekdayIndex - 1
    return formatDateOffset(today, daysToNextMonday + weekdayOffsetFromMonday)
  }
  let offset = weekdayIndex - current
  if (offset <= 0) {
    offset += 7
  }
  return formatDateOffset(today, offset)
}

function resolveWeekPhraseDate(normalized, today) {
  let match = normalized.match(/(?:下周|下星期|下礼拜)([一二三四五六日天])/)
  if (match) {
    const weekday = getWeekdayIndex(match[1])
    if (weekday !== null) return resolveNextWeekday(today, weekday, true)
  }

  match = normalized.match(/(?:本周|这周|这个周|本星期|这星期|这个星期|本礼拜|这礼拜|这个礼拜)([一二三四五六日天])/)
  if (match) {
    const weekday = getWeekdayIndex(match[1])
    if (weekday !== null) return resolveNextWeekday(today, weekday, false)
  }

  match = normalized.match(/(?:^|[^每下本这个])(?:周|星期|礼拜)([一二三四五六日天])/)
  if (match) {
    const weekday = getWeekdayIndex(match[1])
    if (weekday !== null) return resolveNextWeekday(today, weekday, false)
  }
  return ''
}

function resolveRelativeDate(text, options) {
  const normalized = normalizeSentence(text)
  const today = startOfDay(options && options.now)
  if (/大后天/.test(normalized)) return formatDateOffset(today, 3)
  if (/后天/.test(normalized)) return formatDateOffset(today, 2)
  if (/明天/.test(normalized)) return formatDateOffset(today, 1)
  if (/今天|今晚/.test(normalized)) return formatDateOffset(today, 0)

  const weekDate = resolveWeekPhraseDate(normalized, today)
  if (weekDate) return weekDate

  const monthDay = normalized.match(/(\d{1,2})月(\d{1,2})[日号]?/)
  if (monthDay) {
    const month = Math.min(12, Math.max(1, Number(monthDay[1]) || 1))
    const day = Math.min(31, Math.max(1, Number(monthDay[2]) || 1))
    const candidate = new Date(today.getFullYear(), month - 1, day)
    if (candidate.getTime() < today.getTime()) {
      candidate.setFullYear(candidate.getFullYear() + 1)
    }
    return formatDate(candidate)
  }

  const dayOfMonth = normalized.match(/(^|[^每月个])(\d{1,2})号/)
  if (dayOfMonth) {
    const day = Math.min(31, Math.max(1, Number(dayOfMonth[2]) || 1))
    const candidate = new Date(today.getFullYear(), today.getMonth(), day)
    if (candidate.getTime() < today.getTime()) {
      candidate.setMonth(candidate.getMonth() + 1)
    }
    return formatDate(candidate)
  }
  return ''
}

function inferScheduleType(rawType, text) {
  const given = String(rawType || '').trim()
  if (VALID_SCHEDULE_TYPES.includes(given)) return given
  const normalized = normalizeSentence(text)
  if (/每天|每日|天天/.test(normalized)) return 'daily'
  if (/每周|每星期|每礼拜/.test(normalized)) return 'weekly'
  if (/每月|每个月/.test(normalized)) return 'monthly'
  return 'once'
}

function normalizeWeekdays(rawWeekdays, text, scheduleType) {
  const fromRaw = Array.isArray(rawWeekdays)
    ? rawWeekdays.map(item => Number(item)).filter(item => item >= 0 && item <= 6)
    : []
  if (fromRaw.length > 0) return Array.from(new Set(fromRaw)).slice(0, 7)
  if (scheduleType !== 'weekly') return []
  const normalized = normalizeSentence(text)
  const match = normalized.match(/每(?:周|星期|礼拜)([一二三四五六日天])?/)
  if (!match || !match[1]) return []
  const weekday = getWeekdayIndex(match[1])
  return weekday === null ? [] : [weekday]
}

function hasExplicitReminderIntent(normalized) {
  return /(记得提醒我|提醒我一下|提醒一下我|提醒我|提醒一下|提醒下我|提醒下|帮我提醒|帮忙提醒|帮提醒|叫我|告诉我|通知我|到时候提醒我|到时候叫我|别忘了提醒我|别忘提醒我)/.test(normalized)
}

function hasReminderNoise(normalized) {
  if (!normalized) return true
  if (/(怎么|咋|如何).{0,8}(吃药|服药|提醒|设置提醒)/.test(normalized)) return true
  if (/(提醒|叫我|通知我|告诉我).{0,8}(吗|么|不|行不行|可以吗|\?)/.test(normalized)) return true
  if (/(不用|不要|别|取消|不需要).{0,8}(提醒|叫我|通知|告诉)/.test(normalized)) return true
  if (/(谢谢|多谢|辛苦).{0,8}(提醒|叫我|通知)/.test(normalized)) return true
  if (/(已经|已|刚刚|刚才).{0,8}(完成|做完|办好|弄好|处理好|吃了|测了)/.test(normalized)) return true
  return false
}

function hasPlanStatementIntent(normalized) {
  const hasFutureTime = /(今天|今晚|明天|后天|大后天|下周|本周|这周|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]?|\d{1,2}号)/.test(normalized)
  const hasAction = /(要去|得去|想去|准备去|去|复查|复诊|看医生|门诊|医院|吃药|服药|测血压|测血糖|锻炼|散步|买菜|取药|出门|起床|关煤气|缴费|打电话|联系|预约|挂号)/.test(normalized)
  return hasFutureTime && hasAction
}

function removeTimePrefix(text) {
  let result = String(text || '')
  const timeWordPrefix = /^(?:(今天|今晚|明天|后天|大后天|下周[一二三四五六日天]?|本周[一二三四五六日天]?|这周[一二三四五六日天]?|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|每天|每日|天天|每周[一二三四五六日天]?|每星期[一二三四五六日天]?|每礼拜[一二三四五六日天]?|每月|每个月|\d{1,2}月\d{1,2}[日号]?|\d{1,2}号|凌晨|早上|上午|中午|下午|晚上|夜里|夜间|清晨)[，。！？、\s]*)+/u
  const timeClockPrefix = /^(\d{1,2}([:：]\d{1,2})?|[零〇一二两三四五六七八九十]{1,3})(点(半|[零〇一二两三四五六七八九十\d]{1,3}分?)?(?:钟)?)?[，。！？、\s]*/u
  let changed = true
  while (changed) {
    const before = result
    result = result
      .replace(/^[，。！？、\s]+/, '')
      .replace(timeWordPrefix, '')
      .replace(/^[，。！？、\s]+/, '')
      .replace(timeClockPrefix, '')
      .replace(/^[，。！？、\s]+/, '')
      .replace(/^(?:[零〇一二两三四五六七八九十\d]{0,2})点(半|[零〇一二两三四五六七八九十\d]{1,3}分?)?(?:钟)?/, '')
      .replace(/^[，。！？、\s]+/, '')
    changed = result !== before
  }
  return result
}

function stripReminderTrigger(text) {
  const raw = String(text || '').trim()
  const trigger = /(记得提醒我|提醒我一下|提醒一下我|提醒我|提醒一下|提醒下我|提醒下|帮我提醒|帮忙提醒|帮提醒|叫我|告诉我|通知我|到时候提醒我|到时候叫我|别忘了提醒我|别忘提醒我)/
  const match = raw.match(trigger)
  if (!match || typeof match.index !== 'number') return raw
  return raw.slice(match.index)
}

function normalizeTitle(text, isExplicitIntent) {
  const raw = isExplicitIntent ? stripReminderTrigger(text) : String(text || '').trim()
  let title = raw
    .replace(/^[，。！？、\s]+/, '')
    .replace(/^(请)?(帮忙)?(帮)?提醒(一下)?[，。！？、\s]*/u, '')
    .replace(/^(?:老[\u4e00-\u9fa5]{1,2}|[\u4e00-\u9fa5]{1,3}(?:叔叔|阿姨|爷爷|奶奶|伯伯|大爷|大妈|老师|医生|先生|女士|哥哥|姐姐|弟弟|妹妹))[，。！？、\s]*/u, '')
    .replace(/^(您|你|我)[，。！？、\s]*/u, '')
    .replace(/^(请)?(帮我)?(记得)?(到时候)?(一定)?(提醒我一下|提醒一下我|提醒我|提醒下我|提醒下|记得提醒我|叫我|告诉我|通知我)[，。！？、\s]*/u, '')
    .replace(/^(我)?(到时候)?(一定)?(记得)?(要|得|想|准备)?[，。！？、\s]*/u, '')

  title = removeTimePrefix(title)
    .replace(/^(我)?(要|得|想|准备)?去/u, '')
    .replace(/^(要|得|想|准备)(去|做)?/u, '')
    .replace(/^(一趟|一下|一声)[，。！？、\s]*/u, '')
    .replace(/^[，。！？、\s]+/, '')
    .replace(/[。！？!?,，、；;]+$/g, '')

  if (/^吃药$/.test(title)) return title
  if (/^服药$/.test(title)) return '吃药'
  if (/^复查$/.test(title)) return '医院复查'
  if (/^复诊$/.test(title)) return '医院复诊'
  if (/怎么|如何|什么|吗|么/.test(title)) return ''
  return title
}

function hasSpecificActionTitle(title) {
  const normalized = normalizeSentence(title)
  if (!normalized || normalized.length < 2) return false
  if (/^(一下|一声|提醒|记得|到时候|今天|明天|后天|大后天)$/.test(normalized)) return false
  return true
}

function normalizeMissingFields(fields) {
  if (!Array.isArray(fields)) return []
  const seen = {}
  const result = []
  fields.forEach(item => {
    const text = String(item || '').trim()
    if (!text || seen[text]) return
    seen[text] = true
    result.push(text)
  })
  return result.slice(0, 4)
}

function buildReminderCandidateFromText(text, options) {
  const opts = options || {}
  const rawText = String(text || '').trim()
  const normalized = normalizeSentence(rawText)
  if (!normalized || hasReminderNoise(normalized)) return null

  const explicitIntent = hasExplicitReminderIntent(normalized)
  const planStatement = !explicitIntent && hasPlanStatementIntent(normalized)
  if (!explicitIntent && !planStatement) return null

  const scheduleType = inferScheduleType('', normalized)
  const timeInfo = normalizeTime('', normalized)
  const remindDate = scheduleType === 'once' ? resolveRelativeDate(normalized, opts) : ''
  const weekdays = normalizeWeekdays([], normalized, scheduleType)
  const title = normalizeTitle(rawText, explicitIntent)
  if (!hasSpecificActionTitle(title)) return null

  const missingFields = []
  if (scheduleType === 'once' && !remindDate) missingFields.push('date')
  if (!timeInfo.hasConcreteTime) missingFields.push('time')
  if (scheduleType === 'weekly' && weekdays.length === 0 && /每周|每星期|每礼拜/.test(normalized)) {
    missingFields.push('weekday')
  }

  const hasCompleteSchedule = missingFields.length === 0
  const autoEligible = explicitIntent && hasCompleteSchedule
  const confidence = autoEligible
    ? 0.9
    : (explicitIntent ? 0.7 : 0.66)

  return {
    title,
    scheduleType,
    timeOfDay: timeInfo.timeOfDay,
    remindDate,
    weekdays,
    confidence,
    needsConfirmation: !autoEligible,
    intentType: explicitIntent ? 'explicit_reminder' : 'schedule_statement',
    missingFields,
    evidence: rawText,
  }
}

function normalizeReminderCandidate(candidate, options) {
  if (!candidate || typeof candidate !== 'object') return null
  const rawEvidence = String(candidate.evidence || candidate.title || '').trim()
  const normalizedEvidence = normalizeSentence(rawEvidence)
  if (hasReminderNoise(normalizedEvidence)) return null
  const rawTitle = String(candidate.title || '').trim()
  if (!rawTitle) return null

  const explicitIntent = candidate.intentType
    ? String(candidate.intentType) === 'explicit_reminder'
    : hasExplicitReminderIntent(normalizedEvidence)
  const title = normalizeTitle(rawTitle, explicitIntent)
  if (!hasSpecificActionTitle(title)) return null

  const sourceText = `${rawTitle}${rawEvidence}`
  const scheduleType = inferScheduleType(candidate.scheduleType, sourceText)
  const sourceTimeInfo = normalizeTime('', sourceText)
  const rawTimeInfo = normalizeTime(candidate.timeOfDay, sourceText)
  const timeInfo = sourceTimeInfo.hasConcreteTime ? sourceTimeInfo : rawTimeInfo
  const remindDate = normalizeCandidateDate(candidate.remindDate, scheduleType, sourceText, options)
  const weekdays = normalizeWeekdays(candidate.weekdays, sourceText, scheduleType)
  const missingFields = normalizeMissingFields(candidate.missingFields)
  if (scheduleType === 'once' && !remindDate && missingFields.indexOf('date') < 0) missingFields.push('date')
  if (!sourceTimeInfo.hasConcreteTime && missingFields.indexOf('time') < 0) {
    missingFields.push('time')
  }

  const intentType = String(candidate.intentType || (explicitIntent ? 'explicit_reminder' : 'model_candidate')).trim()
  const confidence = clampConfidence(candidate.confidence, explicitIntent ? 0.72 : 0.62)
  const needsConfirmation = Boolean(candidate.needsConfirmation)
    || missingFields.length > 0
    || intentType !== 'explicit_reminder'
    || confidence < 0.78

  return {
    title,
    scheduleType,
    timeOfDay: timeInfo.timeOfDay,
    remindDate,
    weekdays,
    confidence: Number(confidence.toFixed(3)),
    needsConfirmation,
    intentType,
    missingFields,
    evidence: rawEvidence || rawTitle,
  }
}

function normalizeCandidateDate(rawDate, scheduleType, text, options) {
  const given = String(rawDate || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(given)) return given
  if (scheduleType !== 'once') return ''
  return resolveRelativeDate(text, options)
}

module.exports = {
  DEFAULT_TIME_OF_DAY,
  normalizeSentence,
  normalizeTime,
  inferScheduleType,
  resolveRelativeDate,
  normalizeCandidateDate,
  normalizeReminderCandidate,
  buildReminderCandidateFromText,
  hasReminderNoise,
}
