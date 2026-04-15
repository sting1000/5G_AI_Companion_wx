describe('audio 离线播放与录音', () => {
  function loadAudioModule() {
    jest.resetModules()
    return require('../../miniprogram/utils/audio')
  }

  test('AudioRecorder.start 会以 PCM 参数启动录音', () => {
    const { AudioRecorder } = loadAudioModule()
    const recorder = new AudioRecorder()
    recorder.start()

    expect(wx.__recorder.start).toHaveBeenCalledWith(expect.objectContaining({
      sampleRate: 16000,
      numberOfChannels: 1,
      format: 'PCM',
      frameSize: 1,
      audioSource: 'voice_communication',
    }))
  })

  test('AudioRecorder.onFrameData 可接收帧回调', () => {
    const { AudioRecorder } = loadAudioModule()
    const recorder = new AudioRecorder()
    const onFrame = jest.fn()
    recorder.onFrameData = onFrame

    const frame = new Uint8Array([1, 2, 3]).buffer
    wx.__recorder.__emitFrame(frame)
    expect(onFrame).toHaveBeenCalledWith(frame)
  })

  test('AudioPlayer.playBuffered 会写入 wav 并触发播放', () => {
    const { AudioPlayer } = loadAudioModule()
    const player = new AudioPlayer()
    const onStart = jest.fn()
    player.onPlayStart = onStart

    player.appendChunk(new Uint8Array(640).buffer)
    player.playBuffered()

    const fs = wx.getFileSystemManager()
    expect(fs.writeFile).toHaveBeenCalled()
    expect(wx.__audioContext.play).toHaveBeenCalled()
    expect(onStart).toHaveBeenCalled()
  })

  test('AudioPlayer.stop 会清空状态并调用 audioCtx.stop', () => {
    const { AudioPlayer } = loadAudioModule()
    const player = new AudioPlayer()
    player.appendChunk(new Uint8Array(640).buffer)
    player.playBuffered()

    player.stop()
    expect(wx.__audioContext.stop).toHaveBeenCalled()
    expect(player.playing).toBe(false)
    expect(player.segmentQueue).toHaveLength(0)
  })
})
