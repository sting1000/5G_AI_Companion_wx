function resolveEnvVersion() {
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.getAccountInfoSync === 'function') {
      const info = wx.getAccountInfoSync()
      const mp = info && info.miniProgram ? info.miniProgram : {}
      return mp.envVersion || 'release'
    }
  } catch (err) {
    // ignore
  }
  return 'release'
}

function shouldPrintInfo() {
  const envVersion = resolveEnvVersion()
  return envVersion !== 'release'
}

function createLogger(scope) {
  const prefix = scope ? `[${scope}]` : ''
  return {
    info(...args) {
      if (!shouldPrintInfo()) return
      console.log(prefix, ...args)
    },
    warn(...args) {
      console.warn(prefix, ...args)
    },
    error(...args) {
      console.error(prefix, ...args)
    },
  }
}

module.exports = {
  createLogger,
  shouldPrintInfo,
}
