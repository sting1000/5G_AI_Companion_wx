const unavailableFunctions = {}

function hasCloudRuntime() {
  return typeof wx !== 'undefined'
    && wx
    && wx.cloud
    && typeof wx.cloud.callFunction === 'function'
}

function getErrorText(err) {
  if (!err) return ''
  if (typeof err === 'string') return err
  const parts = []
  if (err.message) parts.push(String(err.message))
  if (err.errMsg) parts.push(String(err.errMsg))
  if (err.error) parts.push(String(err.error))
  try {
    parts.push(JSON.stringify(err))
  } catch (e) {}
  return parts.join(' ')
}

function isResourceNotFoundError(err) {
  if (!err) return false
  const code = Number(err.errCode || err.code)
  if (code === -501000) return true
  const text = getErrorText(err)
  return text.includes('-501000')
    || /reource is not found/i.test(text)
    || /resource is not found/i.test(text)
}

function createExpectedFallbackError(code, functionName, cause) {
  const err = new Error(`${functionName || 'cloud'} unavailable`)
  err.code = code
  err.functionName = functionName || ''
  err.cause = cause || null
  err.expectedFallback = true
  return err
}

function canCallFunction(name) {
  return hasCloudRuntime() && !unavailableFunctions[name]
}

function callFunction(name, data) {
  if (!hasCloudRuntime()) {
    return Promise.reject(createExpectedFallbackError('cloud_unavailable', name))
  }
  if (unavailableFunctions[name]) {
    return Promise.reject(createExpectedFallbackError('cloud_function_unavailable', name))
  }

  try {
    return wx.cloud.callFunction({ name, data }).catch((err) => {
      if (isResourceNotFoundError(err)) {
        unavailableFunctions[name] = true
        throw createExpectedFallbackError('cloud_function_unavailable', name, err)
      }
      throw err
    })
  } catch (err) {
    return Promise.reject(err)
  }
}

function isExpectedFallbackError(err) {
  return !!(err && (
    err.expectedFallback
    || err.code === 'cloud_unavailable'
    || err.code === 'cloud_function_unavailable'
  ))
}

function _resetUnavailableFunctionsForTest() {
  Object.keys(unavailableFunctions).forEach((name) => {
    delete unavailableFunctions[name]
  })
}

module.exports = {
  canCallFunction,
  callFunction,
  isExpectedFallbackError,
  isResourceNotFoundError,
  _resetUnavailableFunctionsForTest,
}
