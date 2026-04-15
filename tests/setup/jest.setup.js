const { createWxMock, createAppMock } = require('../mocks/wx')

beforeEach(() => {
  global.wx = createWxMock()
  global.__appMock = createAppMock()
  global.getApp = jest.fn(() => global.__appMock)
  jest.useRealTimers()
})

afterEach(() => {
  delete global.wx
  delete global.__appMock
  delete global.getApp
})
