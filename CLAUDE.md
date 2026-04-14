# 5G AI Companion - MVP 小程序

## 项目概述
面向空巢老人的 AI 语音陪伴小程序 MVP。核心闭环：子女配置 → 老人语音对话 → 跨通话记忆 → 通话摘要。

## 技术栈
- **前端**：微信小程序原生开发（WXML + WXSS + JS）
- **语音对话**：豆包端到端实时语音大模型 API（WebSocket 二进制协议）
- **通话摘要**：火山方舟 LLM API（HTTP）
- **数据存储**：微信云开发 CloudBase（云数据库 + 云函数）
- **不使用**：Taro、uni-app、React、npm 框架

## 项目结构
```
5G_AI_Companion/
├── CLAUDE.md
├── .gitignore
├── miniprogram/
│   ├── app.js / app.json / app.wxss
│   ├── config.local.js          # 凭证配置（gitignored）
│   ├── config.local.example.js  # 凭证模板
│   ├── pages/
│   │   ├── onboarding/          # 子女配置（4字段）
│   │   ├── call/                # 语音通话界面
│   │   ├── dashboard/           # 主页（通话记录+档案）
│   │   └── summary/             # 通话摘要详情
│   ├── components/              # 可复用组件
│   ├── utils/
│   │   ├── realtime-api.js      # 火山语音 WebSocket 协议封装
│   │   ├── audio.js             # 录音 & 播放工具
│   │   └── store.js             # 本地数据管理（后续迁移云数据库）
│   └── assets/                  # 图片等静态资源
├── cloudfunctions/
│   └── generateSummary/         # 调方舟 API 生成摘要
└── project.config.json
```

## 开发规范

### 命名
- 页面目录：小写英文，如 `onboarding`、`call`
- 组件目录：小写连字符，如 `tab-bar`
- 工具文件：小写连字符，如 `realtime-api.js`
- 变量/函数：camelCase
- 常量：UPPER_SNAKE_CASE
- CSS 类名：小写连字符

### 密钥管理
- 所有凭证放 `config.local.js`，该文件在 `.gitignore` 中
- `config.local.example.js` 提供占位模板，可提交
- 云函数中的密钥通过环境变量注入，不硬编码
- 绝不在控制台 console.log 输出密钥

### 代码风格
- 默认中文注释，变量名用英文
- 页面 JS 使用 Page() 构造器
- 组件使用 Component() 构造器
- 异步操作使用 Promise，不用回调地狱
- wx API 统一封装为 Promise（在 utils 中）

### Git
- commit message 用英文
- 不自动 push，等明确指令
- 不用 `git add .`，只 stage 相关文件

### 验证
- 改完在微信开发者工具编译验证
- WebSocket 连接变更后手动测试连通性
