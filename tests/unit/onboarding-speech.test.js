const {
  OnboardingSpeechRecognizer,
} = require('../../miniprogram/utils/onboarding-speech')

describe('OnboardingSpeechRecognizer', () => {
  function createDependencies() {
    const client = {
      connected: true,
      sessionActive: true,
      connect: jest.fn(() => Promise.resolve()),
      startSession: jest.fn(() => Promise.resolve('dialog-test')),
      sendAudio: jest.fn(),
      endASR: jest.fn(),
      finishSession: jest.fn(),
      disconnect: jest.fn(),
      onASRText: null,
      onASREnd: null,
      onError: null,
      onDisconnect: null,
    }
    const recorder = {
      recording: false,
      onFrameData: null,
      onError: null,
      start: jest.fn(() => { recorder.recording = true }),
      stop: jest.fn(() => { recorder.recording = false }),
      destroy: jest.fn(() => { recorder.recording = false }),
    }
    const ClientClass = jest.fn(() => client)
    const RecorderClass = jest.fn(() => recorder)
    return { client, recorder, ClientClass, RecorderClass }
  }

  test('复用实时 ASR，把录音帧送入客户端并返回最终称呼', async () => {
    const deps = createDependencies()
    const recognizer = new OnboardingSpeechRecognizer(deps)
    const onResult = jest.fn()

    await recognizer.start({ onResult })
    const frame = new ArrayBuffer(16)
    deps.recorder.onFrameData(frame)
    deps.client.onASRText('王阿姨', true)

    expect(deps.client.startSession).toHaveBeenCalledWith(expect.objectContaining({
      inputMode: 'push_to_talk',
    }))
    expect(deps.client.sendAudio).toHaveBeenCalledWith(frame)
    expect(onResult).toHaveBeenCalledWith('王阿姨')
    expect(deps.recorder.destroy).toHaveBeenCalled()
    expect(deps.client.finishSession).toHaveBeenCalled()
    expect(deps.client.disconnect).toHaveBeenCalled()
  })

  test('destroy 会停止录音并断开识别连接', async () => {
    const deps = createDependencies()
    const recognizer = new OnboardingSpeechRecognizer(deps)

    await recognizer.start()
    recognizer.destroy()

    expect(deps.recorder.destroy).toHaveBeenCalled()
    expect(deps.client.finishSession).toHaveBeenCalled()
    expect(deps.client.disconnect).toHaveBeenCalled()
    expect(recognizer.active).toBe(false)
  })
})
