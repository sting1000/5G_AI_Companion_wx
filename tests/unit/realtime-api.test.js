const { EVENT, SERVER_EVENT } = require('../../miniprogram/utils/realtime-api')

function encodeUTF8(text) {
  return new Uint8Array(new TextEncoder().encode(text))
}

function concatUint8(...parts) {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  parts.forEach((p) => {
    out.set(p, offset)
    offset += p.byteLength
  })
  return out
}

function u32(num) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, num)
  return out
}

function buildServerFrame({ msgType, eventId, payload, sessionId = '', errorCode = 0, audioData }) {
  const flags = 0b0100
  const header = new Uint8Array(4)
  header[0] = (0b0001 << 4) | 0b0001
  header[1] = (msgType << 4) | flags
  header[2] = ((msgType === 0b1011 ? 0b0000 : 0b0001) << 4) | 0b0000

  const event = u32(eventId)
  const sidPart = eventId >= 100
    ? concatUint8(u32(encodeUTF8(sessionId).byteLength), encodeUTF8(sessionId))
    : new Uint8Array(0)

  if (msgType === 0b1111) {
    const payloadBytes = encodeUTF8(JSON.stringify(payload || {}))
    return concatUint8(header, event, sidPart, u32(errorCode), u32(payloadBytes.byteLength), payloadBytes).buffer
  }
  if (msgType === 0b1011) {
    const bytes = audioData ? new Uint8Array(audioData) : new Uint8Array(0)
    return concatUint8(header, event, sidPart, u32(bytes.byteLength), bytes).buffer
  }
  const payloadBytes = encodeUTF8(JSON.stringify(payload || {}))
  return concatUint8(header, event, sidPart, u32(payloadBytes.byteLength), payloadBytes).buffer
}

function getFrameEventId(frameBuffer) {
  const view = new DataView(frameBuffer)
  return view.getUint32(4)
}

describe('realtime-api 离线协议与生命周期', () => {
  function loadClient() {
    jest.resetModules()
    const { RealtimeAPIClient } = require('../../miniprogram/utils/realtime-api')
    return new RealtimeAPIClient()
  }

  test('connect 成功后会先发送 START_CONNECTION 帧', async () => {
    const client = loadClient()
    const connectPromise = client.connect()
    const socket = wx.__socketTask
    socket.__emitOpen()

    expect(socket.send).toHaveBeenCalledTimes(1)
    const firstFrame = socket.send.mock.calls[0][0].data
    expect(getFrameEventId(firstFrame)).toBe(EVENT.START_CONNECTION)

    socket.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.CONNECTION_STARTED,
      payload: {},
    }))
    await expect(connectPromise).resolves.toBeUndefined()
  })

  test('连接失败事件会 reject connect Promise', async () => {
    const client = loadClient()
    const connectPromise = client.connect()
    wx.__socketTask.__emitOpen()
    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.CONNECTION_FAILED,
      payload: { reason: 'auth failed' },
    }))
    await expect(connectPromise).rejects.toEqual({ reason: 'auth failed' })
  })

  test('startSession 收到 SESSION_STARTED 后返回 dialogId', async () => {
    const client = loadClient()
    const connectPromise = client.connect()
    wx.__socketTask.__emitOpen()
    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.CONNECTION_STARTED,
      payload: {},
    }))
    await connectPromise

    const startPromise = client.startSession({
      botName: '小林',
      systemRole: 'test-role',
      speakingStyle: 'safe',
      dialogId: 'dialog-old',
      speaker: 'voice_a',
    })

    const sessionFrame = wx.__socketTask.send.mock.calls[1][0].data
    expect(getFrameEventId(sessionFrame)).toBe(EVENT.START_SESSION)

    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1001,
      eventId: SERVER_EVENT.SESSION_STARTED,
      sessionId: 'sid-test',
      payload: { dialog_id: 'dialog-new' },
    }))
    await expect(startPromise).resolves.toBe('dialog-new')
  })

  test('错误帧会触发 onError 回调', () => {
    const client = loadClient()
    const onError = jest.fn()
    client.onError = onError

    // connect() registers the onMessage handler on the socket task;
    // without it, __emitMessage has no handler to call.
    client.connect()

    wx.__socketTask.__emitMessage(buildServerFrame({
      msgType: 0b1111,
      eventId: SERVER_EVENT.SESSION_FAILED,
      sessionId: 'sid-test',
      errorCode: 401,
      payload: { detail: 'invalid token' },
    }))
    expect(onError).toHaveBeenCalledWith({
      code: 401,
      detail: { detail: 'invalid token' },
    })
  })

  test('disconnect 在已连接时会发送 FINISH_CONNECTION 并关闭 socket', () => {
    jest.useFakeTimers()
    const client = loadClient()
    client.connected = true
    client.socket = wx.__socketTask

    client.disconnect()

    const sent = wx.__socketTask.send.mock.calls[0][0].data
    expect(getFrameEventId(sent)).toBe(EVENT.FINISH_CONNECTION)

    jest.advanceTimersByTime(500)
    expect(wx.__socketTask.close).toHaveBeenCalled()
  })
})
