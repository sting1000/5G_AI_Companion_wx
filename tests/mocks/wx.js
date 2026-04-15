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
    onEnded: null,
    onError: null,
  }
  return {
    src: '',
    play: jest.fn(),
    stop: jest.fn(),
    destroy: jest.fn(),
    onEnded: jest.fn((cb) => { handlers.onEnded = cb }),
    onError: jest.fn((cb) => { handlers.onError = cb }),
    __emitEnded() {
      if (handlers.onEnded) handlers.onEnded()
    },
    __emitError(err) {
      if (handlers.onError) handlers.onError(err)
    },
  }
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

function createWxMock() {
  const storage = {}
  const recorder = createRecorderManagerMock()
  const audioContext = createInnerAudioContextMock()
  const socketTask = createSocketTaskMock()

  const fsMock = {
    writeFile: jest.fn(({ success }) => {
      if (success) success()
    }),
  }

  const wx = {
    env: {
      USER_DATA_PATH: '/tmp',
    },
    __storage: storage,
    __recorder: recorder,
    __audioContext: audioContext,
    __socketTask: socketTask,
    getStorageSync: jest.fn((key) => storage[key]),
    setStorageSync: jest.fn((key, value) => {
      storage[key] = value
    }),
    removeStorageSync: jest.fn((key) => {
      delete storage[key]
    }),
    connectSocket: jest.fn(() => socketTask),
    getRecorderManager: jest.fn(() => recorder),
    createInnerAudioContext: jest.fn(() => audioContext),
    getFileSystemManager: jest.fn(() => fsMock),
    authorize: jest.fn(({ success }) => {
      if (success) success()
    }),
    showModal: jest.fn(({ success }) => {
      if (success) success({ confirm: true })
    }),
    openSetting: jest.fn(({ success }) => {
      if (success) success()
    }),
    navigateBack: jest.fn(),
    navigateTo: jest.fn(),
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
