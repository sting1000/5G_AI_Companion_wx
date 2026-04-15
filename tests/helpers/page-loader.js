function applySetData(target) {
  target.setData = function setData(patch) {
    Object.keys(patch || {}).forEach((path) => {
      if (!path.includes('.') && !path.includes('[')) {
        this.data[path] = patch[path]
        return
      }
      const normalized = path.replace(/\[(\d+)\]/g, '.$1')
      const keys = normalized.split('.')
      let cursor = this.data
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i]
        if (!Object.prototype.hasOwnProperty.call(cursor, key) || typeof cursor[key] !== 'object') {
          cursor[key] = {}
        }
        cursor = cursor[key]
      }
      cursor[keys[keys.length - 1]] = patch[path]
    })
  }
}

function attachMethods(target, pageDef) {
  Object.keys(pageDef).forEach((key) => {
    if (typeof pageDef[key] === 'function') {
      target[key] = pageDef[key].bind(target)
    }
  })
}

function loadPageModule(absPath) {
  let capturedPage = null
  const prevPage = global.Page
  global.Page = (def) => {
    capturedPage = def
  }

  jest.isolateModules(() => {
    require(absPath)
  })
  global.Page = prevPage

  if (!capturedPage) {
    throw new Error(`无法捕获 Page 定义: ${absPath}`)
  }

  const instance = {
    data: JSON.parse(JSON.stringify(capturedPage.data || {})),
  }
  applySetData(instance)
  attachMethods(instance, capturedPage)
  return instance
}

module.exports = {
  loadPageModule,
}
