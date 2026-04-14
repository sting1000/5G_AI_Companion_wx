// 复制此文件为 config.local.js 并填入真实凭证
// config.local.js 已在 .gitignore 中，不会被提交

module.exports = {
  // 豆包语音端到端实时语音 API
  speech: {
    appId: 'YOUR_APP_ID',
    accessKey: 'YOUR_ACCESS_KEY',
  },
  // 火山方舟 LLM API（用于通话摘要）
  ark: {
    apiKey: 'YOUR_ARK_API_KEY',
  },
}
