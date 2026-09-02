/**
 * 陪伴形象视频：启动时预下载并落到 USER_DATA_PATH，通话页命中本地文件即可播。
 */

const LOG_PREFIX = '[CompanionVideo]'

const memoryReady = Object.create(null)
const inflightWaiters = Object.create(null)

function readCompanionVideoSources() {
  try {
    const localConfig = require('../config.local')
    const videos = localConfig && localConfig.companionVideos
    const idle = String((videos && videos.idle) || '').trim()
    const speaking = String((videos && videos.speaking) || '').trim()
    return { idle, speaking }
  } catch (err) {
    return { idle: '', speaking: '' }
  }
}

function cloudFileIdToCdnUrl(fileID) {
  const matched = String(fileID || '').match(/^cloud:\/\/([^/]+)\/(.+)$/)
  if (!matched) return ''
  const host = matched[1]
  const objectPath = matched[2]
  const dot = host.indexOf('.')
  if (dot < 0 || !objectPath) return ''
  const bucket = host.slice(dot + 1)
  if (!bucket) return ''
  return `https://${bucket}.tcb.qcloud.la/${objectPath}`
}

function videoSrcHost(src) {
  const text = String(src || '')
  const schemeIdx = text.indexOf('://')
  if (schemeIdx < 0) {
    const slash = text.lastIndexOf('/')
    return slash < 0 ? text : text.slice(slash + 1)
  }
  const rest = text.slice(schemeIdx + 3)
  const slash = rest.indexOf('/')
  return slash < 0 ? rest : rest.slice(0, slash)
}

function cacheFileName(fileID) {
  const text = String(fileID || '').split('?')[0]
  const slash = text.lastIndexOf('/')
  const raw = slash < 0 ? text : text.slice(slash + 1)
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, '_')
  return safe || 'companion-video.mp4'
}

function cachePathForFileID(fileID) {
  const root = wx.env && wx.env.USER_DATA_PATH ? String(wx.env.USER_DATA_PATH) : ''
  if (!root || !fileID) return ''
  return `${root}/${cacheFileName(fileID)}`
}

function localPathExists(filePath) {
  if (!filePath) return false
  try {
    const fs = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
    if (!fs || typeof fs.accessSync !== 'function') return false
    fs.accessSync(filePath)
    return true
  } catch (err) {
    return false
  }
}

function peekCachedCompanionVideoSrc(fileID) {
  if (!fileID) return ''
  if (memoryReady[fileID]) return memoryReady[fileID]
  const localPath = cachePathForFileID(fileID)
  if (localPathExists(localPath)) {
    memoryReady[fileID] = localPath
    return localPath
  }
  return ''
}

function notifyWaiters(fileID, src, cached) {
  if (src) memoryReady[fileID] = src
  const waiters = inflightWaiters[fileID] || []
  delete inflightWaiters[fileID]
  waiters.forEach((onDone) => {
    if (typeof onDone === 'function') onDone(src, cached)
  })
}

function persistTempFile(tempPath, destPath, onDone) {
  if (!tempPath) {
    onDone('')
    return
  }
  if (!destPath || tempPath === destPath) {
    onDone(tempPath)
    return
  }
  const fs = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
  if (!fs || typeof fs.copyFile !== 'function') {
    onDone(tempPath)
    return
  }
  fs.copyFile({
    srcPath: tempPath,
    destPath,
    success: () => onDone(destPath),
    fail: () => onDone(tempPath),
  })
}

function downloadToLocal(httpsUrl, destPath, onDone) {
  if (!httpsUrl) {
    onDone('')
    return
  }
  if (typeof wx.downloadFile !== 'function') {
    onDone(httpsUrl)
    return
  }
  const finishDownload = (res) => {
    const path = res && res.tempFilePath ? String(res.tempFilePath) : ''
    const statusCode = Number(res && res.statusCode)
    if (path && (!statusCode || statusCode === 200)) {
      persistTempFile(path, destPath, onDone)
      return
    }
    onDone(httpsUrl)
  }
  const fallbackDownload = () => {
    wx.downloadFile({
      url: httpsUrl,
      success: finishDownload,
      fail: (err) => {
        console.warn(LOG_PREFIX, 'HTTP 下载失败，改用 HTTPS 直链', {
          host: videoSrcHost(httpsUrl),
          errMsg: err && err.errMsg,
        })
        onDone(httpsUrl)
      },
    })
  }
  if (!destPath) {
    fallbackDownload()
    return
  }
  wx.downloadFile({
    url: httpsUrl,
    filePath: destPath,
    success: finishDownload,
    fail: fallbackDownload,
  })
}

function resolveHttpsThenDownload(fileID, onDone) {
  const destPath = cachePathForFileID(fileID)
  const fallbackHttps = cloudFileIdToCdnUrl(fileID)
  const startDownload = (httpsUrl) => {
    if (!httpsUrl) {
      console.warn(LOG_PREFIX, '没有可用的 HTTPS 地址，跳过 cloud:// 直链')
      onDone('')
      return
    }
    downloadToLocal(httpsUrl, destPath, onDone)
  }
  if (!wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
    startDownload(fallbackHttps)
    return
  }
  wx.cloud.getTempFileURL({
    fileList: [fileID],
    success: (res) => {
      const item = ((res && res.fileList) || [])[0] || {}
      const tempUrl = item.tempFileURL ? String(item.tempFileURL) : ''
      console.log(LOG_PREFIX, '临时地址', {
        status: item.status,
        hasUrl: Boolean(tempUrl),
        host: videoSrcHost(tempUrl || fallbackHttps),
      })
      startDownload(tempUrl || fallbackHttps)
    },
    fail: (err) => {
      console.warn(LOG_PREFIX, '临时地址失败', err && err.errMsg)
      startDownload(fallbackHttps)
    },
  })
}

function resolveCompanionVideoSrc(fileID, onDone) {
  const finish = (src, cached) => {
    if (typeof onDone === 'function') onDone(src || '', Boolean(cached))
  }
  if (!fileID) {
    finish('', false)
    return
  }
  if (fileID.indexOf('cloud://') !== 0) {
    finish(fileID, false)
    return
  }
  const cached = peekCachedCompanionVideoSrc(fileID)
  if (cached) {
    finish(cached, true)
    return
  }
  if (inflightWaiters[fileID]) {
    inflightWaiters[fileID].push(finish)
    return
  }
  inflightWaiters[fileID] = [finish]
  resolveHttpsThenDownload(fileID, (src) => {
    notifyWaiters(fileID, src, false)
  })
}

function prefetchOne(fileID, role, onComplete) {
  if (!fileID) {
    if (typeof onComplete === 'function') onComplete()
    return
  }
  resolveCompanionVideoSrc(fileID, (src, cached) => {
    console.log(LOG_PREFIX, cached ? `${role} 命中本地缓存` : `${role} 预下载完成`, {
      ready: Boolean(src),
      host: videoSrcHost(src),
    })
    if (typeof onComplete === 'function') onComplete()
  })
}

function prefetchCompanionVideos() {
  const sources = readCompanionVideoSources()
  // 首句是问候，先下完 speaking 再下 idle，避免两段抢带宽
  prefetchOne(sources.speaking, 'speaking', () => {
    prefetchOne(sources.idle, 'idle')
  })
}

function resetCompanionVideoState() {
  Object.keys(memoryReady).forEach((key) => {
    delete memoryReady[key]
  })
  Object.keys(inflightWaiters).forEach((key) => {
    delete inflightWaiters[key]
  })
}

module.exports = {
  readCompanionVideoSources,
  cloudFileIdToCdnUrl,
  videoSrcHost,
  cachePathForFileID,
  peekCachedCompanionVideoSrc,
  resolveCompanionVideoSrc,
  prefetchCompanionVideos,
  resetCompanionVideoState,
}
