// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ARK_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'

/**
 * 生成通话摘要
 * @param {object} event
 * @param {Array} event.messages - 通话消息 [{role, content}]
 * @param {string} event.elderName - 老人姓名
 */
exports.main = async (event, context) => {
  const { messages, elderName } = event

  if (!messages || messages.length === 0) {
    return {
      success: false,
      error: '没有通话内容',
    }
  }

  // 从环境变量获取 API Key，如果没有则使用 event 中传入的
  const apiKey = process.env.ARK_API_KEY || event.apiKey
  if (!apiKey) {
    // 没有 API Key 时，使用本地规则生成简易摘要
    return generateLocalSummary(messages, elderName)
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
  "moodEmoji": "😊/😌/😢/😟"
}`

    const response = await callArkAPI(apiKey, prompt)

    if (response) {
      // 尝试解析 JSON
      const jsonStr = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const result = JSON.parse(jsonStr)
      return {
        success: true,
        data: result,
      }
    }

    return generateLocalSummary(messages, elderName)
  } catch (err) {
    console.error('摘要生成失败:', err)
    return generateLocalSummary(messages, elderName)
  }
}

/**
 * 调用火山方舟 LLM API
 */
async function callArkAPI(apiKey, prompt) {
  // 使用 Node.js 内置 https 模块（云函数环境不保证有 fetch）
  const https = require('https')
  const url = new URL(ARK_API_URL)

  const requestBody = JSON.stringify({
    model: 'ep-20250413164107-vnfhm',
    messages: [
      { role: 'system', content: '你是通话摘要分析助手，请严格按照JSON格式输出。' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 500,
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
    req.write(requestBody)
    req.end()
  })
}

/**
 * 本地规则生成简易摘要（无需 API Key 的 fallback）
 */
function generateLocalSummary(messages, elderName) {
  const name = elderName || '老人'
  const aiMessages = messages.filter(m => m.role === 'assistant').map(m => m.content)
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
    data: {
      summary,
      topics: topics.length > 0 ? topics : ['日常聊天'],
      highlights: userMessages.slice(0, 3),
      mood: '开心',
      moodEmoji: '😊',
    },
  }
}
