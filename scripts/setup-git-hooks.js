const fs = require('fs')
const path = require('path')

function writePreCommitHook() {
  const projectRoot = path.resolve(__dirname, '..')
  const gitDir = path.join(projectRoot, '.git')
  const hooksDir = path.join(gitDir, 'hooks')
  const preCommitPath = path.join(hooksDir, 'pre-commit')

  if (!fs.existsSync(gitDir)) {
    throw new Error('未找到 .git 目录，请在 git 仓库根目录执行该命令。')
  }

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true })
  }

  const hookContent = `#!/bin/sh
set -e

echo "[pre-commit] 运行离线测试校验..."
npm run verify
`

  fs.writeFileSync(preCommitPath, hookContent, 'utf8')
  fs.chmodSync(preCommitPath, 0o755)
  console.log('[setup:hooks] 已安装 .git/hooks/pre-commit')
}

try {
  writePreCommitHook()
} catch (err) {
  console.error('[setup:hooks] 安装失败:', err.message)
  process.exit(1)
}
