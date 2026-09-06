const PARENTHETICAL_CONTENT_PATTERN = /（([^（）]*)）|\(([^()]*)\)/g
const CHINESE_STAGE_DIRECTION_PATTERN = /^(?:(?:轻轻|轻声|温柔|开心|小声|低声|缓慢)地?)?(?:说|说道|回应|笑|微笑|轻笑|大笑|叹气|叹息|咳嗽|咳嗽声|吸气|呼气|抽泣|哭泣|停顿|沉默|点头|摇头)(?:着|着说|着说道)?$/
const ENGLISH_STAGE_DIRECTION_PATTERN = /^(?:laugh(?:s|ing)?|chuckl(?:e|es|ing)|smil(?:e|es|ing)|sigh(?:s|ing)?|cough(?:s|ing)?|paus(?:e|es|ing)|silence|spe(?:ak|aks|aking) (?:softly|gently)|(?:softly|gently) spe(?:ak|aks|aking))$/i

function sanitizeTranscriptText(text) {
  if (!text) return ''
  const output = String(text).replace(
    PARENTHETICAL_CONTENT_PATTERN,
    (match, chineseContent, englishContent) => {
      const direction = String(chineseContent || englishContent || '').trim()
      const compactDirection = direction.replace(/\s+/g, '')
      const normalizedDirection = direction.replace(/\s+/g, ' ')
      const isStageDirection = CHINESE_STAGE_DIRECTION_PATTERN.test(compactDirection)
        || ENGLISH_STAGE_DIRECTION_PATTERN.test(normalizedDirection)
      return isStageDirection ? '' : match
    }
  )
  return output.replace(/\s+/g, ' ').trim()
}

module.exports = {
  sanitizeTranscriptText,
}
