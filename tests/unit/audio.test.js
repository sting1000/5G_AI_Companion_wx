describe('audio 离线播放与录音', () => {
  function loadAudioModule() {
    jest.resetModules()
    return require('../../miniprogram/utils/audio')
  }

  test('扬声器路由使用微信真实音频选项', async () => {
    const { isSpeakerRouteSupported, setSpeakerEnabled } = loadAudioModule()

    expect(isSpeakerRouteSupported()).toBe(true)
    await setSpeakerEnabled(false)

    expect(wx.setInnerAudioOption).toHaveBeenCalledWith(expect.objectContaining({
      speakerOn: false,
    }))
  })

  test('微信不支持音频路由时明确拒绝切换', async () => {
    const setInnerAudioOption = wx.setInnerAudioOption
    delete wx.setInnerAudioOption
    const { isSpeakerRouteSupported, setSpeakerEnabled } = loadAudioModule()

    expect(isSpeakerRouteSupported()).toBe(false)
    await expect(setSpeakerEnabled(true)).rejects.toThrow('不支持切换扬声器')
    wx.setInnerAudioOption = setInnerAudioOption
  })

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
    expect(onStart).not.toHaveBeenCalled()
    wx.__audioContext.__emitPlay()
    expect(onStart).toHaveBeenCalled()
    wx.__audioContext.__emitEnded()
    expect(wx.__fs.unlink).toHaveBeenCalledWith(expect.objectContaining({
      filePath: expect.stringContaining('tts_'),
    }))
    player.stop()
  })

  test('AudioPlayer 只在 InnerAudioContext onPlay 后报告真实播放', () => {
    const { AudioPlayer } = loadAudioModule()
    const player = new AudioPlayer()
    const onStart = jest.fn()
    player.onPlayStart = onStart

    player.appendChunk(new Uint8Array(640).buffer)
    player.playBuffered()

    expect(wx.__audioContext.play).toHaveBeenCalledTimes(1)
    expect(onStart).not.toHaveBeenCalled()
    wx.__audioContext.__emitPlay()
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      source: 'inner_audio_on_play',
      authoritative: true,
    }))
    player.stop()
  })

  test('AudioPlayer.stop 会使迟到的写盘成功回调失效', () => {
    const { AudioPlayer } = loadAudioModule()
    wx.__fs.__setAutoComplete(false)
    const player = new AudioPlayer()
    const onStart = jest.fn()
    player.onPlayStart = onStart

    player.appendChunk(new Uint8Array(640).buffer)
    player.playBuffered()
    expect(wx.__audioContext.play).not.toHaveBeenCalled()

    player.stop()
    wx.__fs.__completeNextWrite()
    wx.__audioContext.__emitPlay()

    expect(wx.__audioContext.play).not.toHaveBeenCalled()
    expect(onStart).not.toHaveBeenCalled()
  })

  test('旧写盘成功回调不能清除新一轮 preparing 或启动旧音频', () => {
    const { AudioPlayer } = loadAudioModule()
    wx.__fs.__setAutoComplete(false)
    const player = new AudioPlayer()

    player.appendChunk(new Uint8Array(640).buffer)
    player.playBuffered()
    const oldContext = wx.__audioContext
    player.stop()
    player.appendChunk(new Uint8Array(640).buffer)
    player.playBuffered()
    expect(player.preparingSegment).toBe(true)

    wx.__fs.__completeNextWrite()
    expect(player.preparingSegment).toBe(true)
    expect(oldContext.play).not.toHaveBeenCalled()

    wx.__fs.__completeNextWrite()
    const newContext = wx.__audioContext
    expect(player.preparingSegment).toBe(false)
    expect(newContext.play).toHaveBeenCalledTimes(1)
    player.stop()
  })

  test('AudioPlayer 写盘失败会明确报错并结束本轮，不会卡死', () => {
    const { AudioPlayer } = loadAudioModule()
    wx.__fs.__setAutoComplete(false)
    const player = new AudioPlayer()
    const onError = jest.fn()
    const onEnd = jest.fn()
    player.onPlayError = onError
    player.onPlayEnd = onEnd

    player.appendChunk(new Uint8Array(640).buffer)
    player.playBuffered()
    wx.__fs.__failNextWrite({ errMsg: 'disk full' })

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'write',
    }))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(player.playing).toBe(false)
    expect(wx.__fs.unlink).toHaveBeenCalled()
  })

  test('旧 InnerAudioContext 的迟到事件不能破坏新一轮播放', () => {
    const { AudioPlayer } = loadAudioModule()
    const player = new AudioPlayer()

    player.appendChunk(new Uint8Array(640).buffer)
    player.playBuffered()
    const oldContext = wx.__audioContext
    player.stop()

    player.appendChunk(new Uint8Array(640).buffer)
    player.playBuffered()
    const newContext = wx.__audioContext
    expect(newContext).not.toBe(oldContext)
    expect(player.playing).toBe(true)

    oldContext.__emitPlay()
    oldContext.__emitEnded()
    oldContext.__emitError({ errMsg: 'old error' })

    expect(player.playing).toBe(true)
    expect(newContext.play).toHaveBeenCalledTimes(1)
    newContext.__emitPlay()
    newContext.__emitEnded()
  })

  test('WebAudio 模式按同一时间轴连续调度 PCM 且不伪造真实 onPlay', () => {
    const {
      AudioPlayer,
      PLAYBACK_MODE_WEB_AUDIO,
    } = loadAudioModule()
    const player = new AudioPlayer({ playbackMode: PLAYBACK_MODE_WEB_AUDIO })
    const onStart = jest.fn()
    const onScheduled = jest.fn()
    const onEnd = jest.fn()
    player.onPlayStart = onStart
    player.onPlaybackScheduled = onScheduled
    player.onPlayEnd = onEnd

    player.appendChunk(new Uint8Array(24000).buffer)
    player.appendChunk(new Uint8Array(6400).buffer)
    player.playBuffered()

    const sources = wx.__webAudioContext.__sources
    expect(sources).toHaveLength(2)
    expect(onScheduled).toHaveBeenCalledWith(expect.objectContaining({
      source: 'web_audio_schedule',
      authoritative: false,
    }))
    expect(onStart).not.toHaveBeenCalled()
    for (let i = 1; i < sources.length; i += 1) {
      const previous = sources[i - 1].start.mock.calls[0][0]
        + sources[i - 1].buffer.duration
      const current = sources[i].start.mock.calls[0][0]
      expect(current).toBeCloseTo(previous, 6)
    }

    sources.forEach(source => source.__emitEnded())
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  test('WebAudio stop 会停止所有已调度 source', () => {
    const {
      AudioPlayer,
      PLAYBACK_MODE_WEB_AUDIO,
    } = loadAudioModule()
    const player = new AudioPlayer({ playbackMode: PLAYBACK_MODE_WEB_AUDIO })

    player.appendChunk(new Uint8Array(24000).buffer)
    const sources = wx.__webAudioContext.__sources
    expect(sources).toHaveLength(1)

    player.stop()
    expect(sources[0].stop).toHaveBeenCalledTimes(1)
    expect(sources[0].disconnect).toHaveBeenCalledTimes(1)
    expect(player.playing).toBe(false)
  })

  test('旧 WebAudio resume 回调不能清除新一轮 preparing 状态', async () => {
    const {
      AudioPlayer,
      PLAYBACK_MODE_WEB_AUDIO,
    } = loadAudioModule()
    const resolves = []
    wx.__webAudioContext.state = 'suspended'
    wx.__webAudioContext.resume.mockImplementation(() => new Promise(resolve => {
      resolves.push(resolve)
    }))
    const player = new AudioPlayer({ playbackMode: PLAYBACK_MODE_WEB_AUDIO })

    player.appendChunk(new Uint8Array(24000).buffer)
    expect(player.webPreparing).toBe(true)
    player.stop()
    player.appendChunk(new Uint8Array(24000).buffer)
    expect(player.webPreparing).toBe(true)

    resolves[0]()
    await Promise.resolve()
    expect(player.webPreparing).toBe(true)

    resolves[1]()
    await Promise.resolve()
    expect(player.webPreparing).toBe(false)
    player.stop()
  })

  test('WebAudio source.start 抛错会回滚并明确结束失败轮次', () => {
    const {
      AudioPlayer,
      PLAYBACK_MODE_WEB_AUDIO,
    } = loadAudioModule()
    const failingSource = {
      buffer: null,
      onended: null,
      connect: jest.fn(),
      disconnect: jest.fn(),
      start: jest.fn(() => {
        throw new Error('start failed')
      }),
      stop: jest.fn(),
    }
    wx.__webAudioContext.createBufferSource.mockImplementationOnce(() => failingSource)
    const player = new AudioPlayer({ playbackMode: PLAYBACK_MODE_WEB_AUDIO })
    const onError = jest.fn()
    const onEnd = jest.fn()
    player.onPlayError = onError
    player.onPlayEnd = onEnd

    player.appendChunk(new Uint8Array(24000).buffer)
    player.playBuffered()

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'web_audio_start',
    }))
    expect(failingSource.disconnect).toHaveBeenCalled()
    expect(player.webActiveSources).toHaveLength(0)
    expect(player.playing).toBe(false)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  test('WebAudio 丢失 onended 时 watchdog 会释放并结束密封轮次', () => {
    jest.useFakeTimers()
    const {
      AudioPlayer,
      PLAYBACK_MODE_WEB_AUDIO,
    } = loadAudioModule()
    const player = new AudioPlayer({ playbackMode: PLAYBACK_MODE_WEB_AUDIO })
    const onError = jest.fn()
    const onEnd = jest.fn()
    player.onPlayError = onError
    player.onPlayEnd = onEnd

    player.appendChunk(new Uint8Array(24000).buffer)
    player.playBuffered()
    jest.advanceTimersByTime(6000)

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'web_audio_watchdog',
    }))
    expect(player.webActiveSources).toHaveLength(0)
    expect(player.playing).toBe(false)
    expect(onEnd).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
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

  test('AudioPlayer.stop 会取消待执行的 InnerAudio 重试', () => {
    jest.useFakeTimers()
    const { AudioPlayer } = loadAudioModule()
    const player = new AudioPlayer()
    player.appendChunk(new Uint8Array(640).buffer)
    player.playBuffered()
    wx.__audioContext.__emitError({ errMsg: 'audioInstance is not set' })
    expect(player.playRetryTimer).toBeTruthy()

    player.stop()
    expect(player.playRetryTimer).toBe(null)
    expect(player.playing).toBe(false)
    const playCalls = wx.__audioContexts.reduce((sum, ctx) => sum + ctx.play.mock.calls.length, 0)
    jest.advanceTimersByTime(80)
    const playCallsAfter = wx.__audioContexts.reduce((sum, ctx) => sum + ctx.play.mock.calls.length, 0)
    expect(playCallsAfter).toBe(playCalls)
    expect(player.playing).toBe(false)
    jest.useRealTimers()
  })
})
