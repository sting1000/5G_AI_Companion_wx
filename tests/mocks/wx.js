function createRecorderManagerMock() {
  const handlers = {
    onStart: null,
    onFrameRecorded: null,
    onError: null,
    onStop: null,
  }
  return {
    start: jest.fn(() => {
      if (handlers.onStart) handlers.onStart()
    }),
    stop: jest.fn(() => {
      if (handlers.onStop) handlers.onStop()
    }),
    onStart: jest.fn((cb) => { handlers.onStart = cb }),
    onFrameRecorded: jest.fn((cb) => { handlers.onFrameRecorded = cb }),
    onError: jest.fn((cb) => { handlers.onError = cb }),
    onStop: jest.fn((cb) => { handlers.onStop = cb }),
    offStart: jest.fn((cb) => {
      if (!cb || handlers.onStart === cb) handlers.onStart = null
    }),
    offFrameRecorded: jest.fn((cb) => {
      if (!cb || handlers.onFrameRecorded === cb) handlers.onFrameRecorded = null
    }),
    offError: jest.fn((cb) => {
      if (!cb || handlers.onError === cb) handlers.onError = null
    }),
    offStop: jest.fn((cb) => {
      if (!cb || handlers.onStop === cb) handlers.onStop = null
    }),
    __emitFrame(frameBuffer) {
      if (handlers.onFrameRecorded) handlers.onFrameRecorded({ frameBuffer })
    },
    __emitError(err) {
      if (handlers.onError) handlers.onError(err)
    },
  }
}

function createInnerAudioContextMock() {
  const handlers = {
    onPlay: null,
    onCanplay: null,
    onWaiting: null,
    onEnded: null,
    onError: null,
  }
  return {
    src: '',
    play: jest.fn(),
    stop: jest.fn(),
    destroy: jest.fn(),
    onPlay: jest.fn((cb) => { handlers.onPlay = cb }),
    onCanplay: jest.fn((cb) => { handlers.onCanplay = cb }),
    onWaiting: jest.fn((cb) => { handlers.onWaiting = cb }),
    onEnded: jest.fn((cb) => { handlers.onEnded = cb }),
    onError: jest.fn((cb) => { handlers.onError = cb }),
    __emitPlay() {
      if (handlers.onPlay) handlers.onPlay()
    },
    __emitCanplay() {
      if (handlers.onCanplay) handlers.onCanplay()
    },
    __emitWaiting() {
      if (handlers.onWaiting) handlers.onWaiting()
    },
    __emitEnded() {
      if (handlers.onEnded) handlers.onEnded()
    },
    __emitError(err) {
      if (handlers.onError) handlers.onError(err)
    },
  }
}

function createWebAudioContextMock() {
  const sources = []
  const context = {
    state: 'running',
    currentTime: 0,
    destination: {},
    createBuffer: jest.fn((channels, length, sampleRate) => {
      const channelData = new Float32Array(length)
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: jest.fn(() => channelData),
      }
    }),
    createBufferSource: jest.fn(() => {
      const source = {
        buffer: null,
        onended: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        __emitEnded() {
          if (source.onended) source.onended()
        },
      }
      sources.push(source)
      return source
    }),
    resume: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    __sources: sources,
  }
  return context
}

function createSocketTaskMock() {
  const handlers = {
    open: null,
    message: null,
    error: null,
    close: null,
  }
  return {
    send: jest.fn(),
    close: jest.fn(),
    onOpen: jest.fn((cb) => { handlers.open = cb }),
    onMessage: jest.fn((cb) => { handlers.message = cb }),
    onError: jest.fn((cb) => { handlers.error = cb }),
    onClose: jest.fn((cb) => { handlers.close = cb }),
    __emitOpen(payload = {}) {
      if (handlers.open) handlers.open(payload)
    },
    __emitMessage(data) {
      if (handlers.message) handlers.message({ data })
    },
    __emitError(err) {
      if (handlers.error) handlers.error(err)
    },
    __emitClose(payload = {}) {
      if (handlers.close) handlers.close(payload)
    },
  }
}

function createVideoContextMock() {
  return {
    play: jest.fn(),
    pause: jest.fn(),
    stop: jest.fn(),
    seek: jest.fn(),
  }
}

function createWxMock() {
  const storage = {}
  const recorder = createRecorderManagerMock()
  const audioContexts = []
  const videoContexts = {}
  const webAudioContext = createWebAudioContextMock()
  const socketTask = createSocketTaskMock()

  let autoCompleteWrites = true
  const pendingWrites = []
  const savedFiles = new Set()
  const fsMock = {
    __savedFiles: savedFiles,
    accessSync: jest.fn((filePath) => {
      if (savedFiles.has(filePath)) return
      const err = new Error('no such file or directory')
      err.errMsg = 'accessSync:fail no such file or directory'
      throw err
    }),
    copyFile: jest.fn(({ destPath, success }) => {
      if (destPath) savedFiles.add(destPath)
      if (success) success()
    }),
    writeFile: jest.fn((options) => {
      if (autoCompleteWrites) {
        if (options.success) options.success()
        return
      }
      pendingWrites.push(options)
    }),
    unlink: jest.fn(({ filePath, success }) => {
      if (filePath) savedFiles.delete(filePath)
      if (success) success()
    }),
    __setAutoComplete(value) {
      autoCompleteWrites = Boolean(value)
    },
    __completeNextWrite() {
      const options = pendingWrites.shift()
      if (options && options.success) options.success()
    },
    __failNextWrite(error = { errMsg: 'write failed' }) {
      const options = pendingWrites.shift()
      if (options && options.fail) options.fail(error)
    },
  }

  let wx = null
  wx = {
    env: {
      USER_DATA_PATH: '/tmp',
    },
    __storage: storage,
    __recorder: recorder,
    __audioContext: null,
    __audioContexts: audioContexts,
    __videoContexts: videoContexts,
    __webAudioContext: webAudioContext,
    __socketTask: socketTask,
    __fs: fsMock,
    getStorageSync: jest.fn((key) => storage[key]),
    setStorageSync: jest.fn((key, value) => {
      storage[key] = value
    }),
    removeStorageSync: jest.fn((key) => {
      delete storage[key]
    }),
    connectSocket: jest.fn(() => socketTask),
    getRecorderManager: jest.fn(() => recorder),
    createInnerAudioContext: jest.fn(() => {
      const audioContext = createInnerAudioContextMock()
      audioContexts.push(audioContext)
      wx.__audioContext = audioContext
      return audioContext
    }),
    setInnerAudioOption: jest.fn(({ success }) => {
      if (success) success()
    }),
    createWebAudioContext: jest.fn(() => webAudioContext),
    createVideoContext: jest.fn((id) => {
      const videoContext = createVideoContextMock()
      videoContexts[id] = videoContext
      return videoContext
    }),
    downloadFile: jest.fn(({ url, filePath, success }) => {
      if (typeof success !== 'function') return
      const name = String(url || '').split('?')[0].split('/').pop()
      const tempFilePath = filePath || `/tmp/${name || 'video.mp4'}`
      if (filePath) savedFiles.add(filePath)
      success({
        tempFilePath,
        statusCode: 200,
      })
    }),
    cloud: {
      getTempFileURL: jest.fn(({ fileList, success }) => {
        if (typeof success !== 'function') return
        success({
          fileList: (fileList || []).map((fileID) => ({
            fileID,
            tempFileURL: `https://cdn.example.test/${String(fileID).split('/').pop()}`,
            status: 0,
          })),
        })
      }),
      downloadFile: jest.fn(({ fail }) => {
        if (typeof fail === 'function') {
          fail({ errCode: -403003, errMsg: 'empty download url' })
        }
      }),
    },
    getFileSystemManager: jest.fn(() => fsMock),
    getWindowInfo: jest.fn(() => ({
      statusBarHeight: 20,
      screenHeight: 844,
      safeArea: { bottom: 810 },
    })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({
      top: 24,
      bottom: 56,
      height: 32,
      left: 278,
      right: 365,
      width: 87,
    })),
    getNetworkType: jest.fn(({ success }) => {
      if (success) success({ networkType: 'wifi' })
    }),
    getSetting: jest.fn(({ success }) => {
      if (success) {
        success({
          authSetting: {},
          subscriptionsSetting: { itemSettings: {} },
        })
      }
    }),
    authorize: jest.fn(({ success }) => {
      if (success) success()
    }),
    requestSubscribeMessage: jest.fn(({ tmplIds, success }) => {
      if (!success) return
      const result = {}
      ;(tmplIds || []).forEach((id) => {
        result[id] = 'accept'
      })
      success(result)
    }),
    showModal: jest.fn(({ success }) => {
      if (success) success({ confirm: true })
    }),
    openSetting: jest.fn(({ success }) => {
      if (success) success({ authSetting: { 'scope.record': true } })
    }),
    openPrivacyContract: jest.fn(({ success }) => {
      if (success) success()
    }),
    navigateBack: jest.fn(),
    navigateTo: jest.fn(),
    redirectTo: jest.fn(),
    switchTab: jest.fn(),
    reLaunch: jest.fn(),
    showToast: jest.fn(),
  }
  return wx
}

function createAppMock() {
  return {
    globalData: {
      elderConfig: null,
      dialogId: '',
      callHistory: [],
    },
  }
}

module.exports = {
  createWxMock,
  createAppMock,
}
