const createLogger = (() => {
  try {
    const loggerModule = require('./logger')
    if (loggerModule && loggerModule.createLogger) return loggerModule.createLogger
  } catch (err) {}
  return (scope) => {
    const prefix = scope ? `[${scope}]` : ''
    return {
      info() {},
      warn(...args) { globalThis.console.warn(prefix, ...args) },
      error(...args) { globalThis.console.error(prefix, ...args) },
    }
  }
})()
/**
 * 小程序录音和音频播放工具
 *
 * 录音：使用 RecorderManager，输出 PCM 16kHz 16bit 单声道
 * 播放：将 PCM 数据添加 WAV 头，写入临时文件后播放
 */

const SAMPLE_RATE = 16000
const BIT_DEPTH = 16
const CHANNELS = 1
const FRAME_DURATION_MS = 20 // 每帧 20ms
const FRAME_SIZE = (SAMPLE_RATE * BIT_DEPTH * CHANNELS * FRAME_DURATION_MS) / (8 * 1000) // 640 bytes
const RECORDER_FRAME_SIZE_KB = 1
const USE_LOW_LATENCY_TTS = true
// 当前优先“连贯无卡顿”，单句只播放一个分段，避免“第三个字稳定卡”。
const FORCE_SINGLE_SEGMENT_PER_TURN = true
// 用户反馈优先“说话连贯”，因此进一步减少句内切段次数（目标 1~2 段）。
const TTS_START_BUFFER_MS = 680
const TTS_STREAM_SEGMENT_MS = 6000
const PLAYBACK_WATCHDOG_MS = 20000
const FLOW_LOG_PREFIX = '[AudioFlow]'
const DEBUG_AUDIO_TRACE = false
const AUDIO_STUTTER_WARN_SEGMENTS = 2
const AUDIO_STUTTER_WARN_SWITCH_AVG_MS = 80
const logger = createLogger('Audio')

/**
 * 录音管理器封装
 */
class AudioRecorder {
  constructor() {
    this.recorder = wx.getRecorderManager()
    this.onFrameData = null // (pcmBuffer: ArrayBuffer) => {}
    this.recording = false

    this.recorder.onStart(() => {
      logger.info('录音已启动')
    })

    this.recorder.onFrameRecorded((res) => {
      if (res.frameBuffer && this.onFrameData) {
        this.onFrameData(res.frameBuffer)
      }
    })

    this.recorder.onError((err) => {
      logger.error('AudioRecorder error:', JSON.stringify(err))
      this.recording = false
    })

    this.recorder.onStop(() => {
      logger.info('录音已停止')
      this.recording = false
    })
  }

  start() {
    this.recording = true
    logger.info('调用 recorder.start, format=PCM, sampleRate=' + SAMPLE_RATE + ', frameSize=' + RECORDER_FRAME_SIZE_KB + 'KB')
    this.recorder.start({
      sampleRate: SAMPLE_RATE,
      numberOfChannels: CHANNELS,
      encodeBitRate: 48000,
      format: 'PCM',
      frameSize: RECORDER_FRAME_SIZE_KB,
      // 优先启用通话音频源，系统会做更强的回声抑制/降噪处理
      audioSource: 'voice_communication',
    })
  }

  stop() {
    if (this.recording) {
      this.recorder.stop()
      this.recording = false
    }
  }
}

/**
 * PCM 音频播放器
 * 缓冲收到的 PCM 数据，合并后播放
 */
class AudioPlayer {
  constructor() {
    this.audioCtx = null
    this.pcmChunks = []
    this.pendingChunks = []
    this.pendingBytes = 0
    this.segmentQueue = []
    this.hasStartedStreamPlayback = false
    this.playing = false
    this.preparingSegment = false
    this.turnSealRequested = false
    this.playWatchdogTimer = null
    this._fileIndex = 0
    this.onPlayStart = null
    this.onPlayEnd = null
    this.traceState = null

    this._ensureAudioContext()
  }

  /**
   * 添加 PCM 音频数据块
   */
  appendChunk(pcmBuffer) {
    const chunk = new Uint8Array(pcmBuffer)
    this.pcmChunks.push(chunk)
    this.turnSealRequested = false
    this._ensureTraceState()
    this.traceState.inputBytes += chunk.byteLength

    if (FORCE_SINGLE_SEGMENT_PER_TURN) return

    if (!USE_LOW_LATENCY_TTS) return
    this.pendingChunks.push(chunk)
    this.pendingBytes += chunk.byteLength

    // 首段达到阈值即起播；后续不再持续切段，统一在句末一次性合并为尾段，
    // 以避免“第三个字附近”这类稳定切段卡顿。
    if (!this.hasStartedStreamPlayback && this.pendingBytes >= this._bytesFromMs(TTS_START_BUFFER_MS)) {
      this._flushPendingToQueue(false)
      this._tryPlayNextSegment()
      this.hasStartedStreamPlayback = true
      return
    }
  }

  /**
   * 将缓冲的 PCM 数据合并，写 WAV 临时文件并播放
   */
  playBuffered() {
    this.turnSealRequested = true
    if (this.pcmChunks.length === 0) {
      this._maybeFinishTurnPlayback()
      return
    }

    if (FORCE_SINGLE_SEGMENT_PER_TURN) {
      const totalLen = this.pcmChunks.reduce((sum, c) => sum + c.byteLength, 0)
      const pcmData = new Uint8Array(totalLen)
      let offset = 0
      for (const chunk of this.pcmChunks) {
        pcmData.set(chunk, offset)
        offset += chunk.byteLength
      }
      this.pcmChunks = []
      this.pendingChunks = []
      this.pendingBytes = 0
      this.segmentQueue = [pcmData.buffer]
      this.hasStartedStreamPlayback = false
      this._ensureTraceState()
      this.traceState.segmentEnqueueCount += 1
      this.traceState.queuePeak = Math.max(this.traceState.queuePeak, this.segmentQueue.length)
      this._tryPlayNextSegment()
      this._maybeFinishTurnPlayback()
      return
    }

    if (USE_LOW_LATENCY_TTS) {
      this._flushPendingToQueue(true)
      this._compactSegmentQueue()
      this._tryPlayNextSegment()
      this._maybeFinishTurnPlayback()
      this.pcmChunks = []
      this.hasStartedStreamPlayback = false
      return
    }

    // 合并所有 PCM chunks
    const totalLen = this.pcmChunks.reduce((sum, c) => sum + c.byteLength, 0)
    const pcmData = new Uint8Array(totalLen)
    let offset = 0
    for (const chunk of this.pcmChunks) {
      pcmData.set(chunk, offset)
      offset += chunk.byteLength
    }
    this.pcmChunks = []

    // 添加 WAV header
    const wavBuffer = addWavHeader(pcmData.buffer, SAMPLE_RATE, BIT_DEPTH, CHANNELS)

    // 写入临时文件
    const filePath = `${wx.env.USER_DATA_PATH}/tts_${this._fileIndex++}.wav`
    const fs = wx.getFileSystemManager()
    fs.writeFile({
      filePath,
      data: wavBuffer,
      encoding: 'binary',
      success: () => {
        this.playing = true
        this._armPlayWatchdog()
        logger.info(FLOW_LOG_PREFIX, '开始播放整句缓冲音频')
        if (!this._playFile(filePath)) {
          this.playing = false
          this._clearPlayWatchdog()
          return
        }
        if (this.onPlayStart) this.onPlayStart()
      },
      fail: (err) => {
        logger.error('AudioPlayer write file error:', err)
        this.playing = false
      },
    })
  }

  _bytesFromMs(ms) {
    return Math.floor((SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8) * ms) / 1000)
  }

  _flushPendingToQueue(forceFlush) {
    if (this.pendingBytes <= 0) return
    this._ensureTraceState()
    const minBytes = forceFlush ? 1 : this._bytesFromMs(TTS_START_BUFFER_MS)
    if (this.pendingBytes < minBytes) return

    const totalLen = this.pendingBytes
    const pcmData = new Uint8Array(totalLen)
    let offset = 0
    for (const chunk of this.pendingChunks) {
      pcmData.set(chunk, offset)
      offset += chunk.byteLength
    }
    this.pendingChunks = []
    this.pendingBytes = 0
    // 连续流式阶段优先并入队尾，减少过多短分段导致的“每几字一卡”。
    if (!forceFlush && this.segmentQueue.length > 0) {
      const lastIdx = this.segmentQueue.length - 1
      this.segmentQueue[lastIdx] = concatArrayBuffers([this.segmentQueue[lastIdx], pcmData.buffer])
      this.traceState.mergedAppendCount += 1
      this.traceState.queuePeak = Math.max(this.traceState.queuePeak, this.segmentQueue.length)
      return
    }
    this.segmentQueue.push(pcmData.buffer)
    this.traceState.segmentEnqueueCount += 1
    this.traceState.queuePeak = Math.max(this.traceState.queuePeak, this.segmentQueue.length)
  }

  _compactSegmentQueue() {
    if (this.segmentQueue.length <= 1) return
    // 平衡“首响快”与“播放连贯”：保留首段，其余全部合并为一个尾段，减少句内多次 onEnded 切换。
    if (this.playing) {
      if (this.segmentQueue.length <= 2) return
      const head = this.segmentQueue[0]
      const tail = concatArrayBuffers(this.segmentQueue.slice(1))
      this.segmentQueue = [head, tail]
      return
    }
    const merged = concatArrayBuffers(this.segmentQueue)
    this.segmentQueue = [merged]
  }

  _tryPlayNextSegment() {
    if (!USE_LOW_LATENCY_TTS) return
    if (this.playing || this.preparingSegment || this.segmentQueue.length === 0) {
      if (DEBUG_AUDIO_TRACE && this.segmentQueue.length > 0 && (this.playing || this.preparingSegment)) {
        console.log('[AudioTrace] segment-wait', {
          playing: this.playing,
          preparingSegment: this.preparingSegment,
          queueSize: this.segmentQueue.length,
        })
      }
      return
    }

    const nextPcmBuffer = this.segmentQueue.shift()
    this._ensureTraceState()
    const traceRef = this.traceState
    if (DEBUG_AUDIO_TRACE) {
      console.log(FLOW_LOG_PREFIX, '开始播放分段音频', {
        remainQueue: this.segmentQueue.length,
      })
    }
    const wavBuffer = addWavHeader(nextPcmBuffer, SAMPLE_RATE, BIT_DEPTH, CHANNELS)
    const filePath = `${wx.env.USER_DATA_PATH}/tts_${this._fileIndex++}.wav`
    const fs = wx.getFileSystemManager()
    const writeStartAt = Date.now()
    this.preparingSegment = true
    fs.writeFile({
      filePath,
      data: wavBuffer,
      encoding: 'binary',
      success: () => {
        this.preparingSegment = false
        // 仅在同一条 TTS trace 下继续，避免异步回调串到下一句。
        if (!this.traceState || this.traceState.traceId !== traceRef.traceId) {
          traceRef.staleCallbackCount += 1
          if (DEBUG_AUDIO_TRACE) {
            console.warn('[AudioTrace] stale-write-callback', {
              expectedTraceId: traceRef.traceId,
              currentTraceId: this.traceState ? this.traceState.traceId : '',
            })
          }
          this._tryPlayNextSegment()
          return
        }
        this.traceState.writeCostMs.push(Date.now() - writeStartAt)
        traceRef.playSegmentCount += 1
        if (traceRef.lastEndedAt) {
          traceRef.switchGapMs.push(Date.now() - traceRef.lastEndedAt)
        }
        this.playing = true
        this._armPlayWatchdog()
        if (!this._playFile(filePath)) {
          this.playing = false
          this._clearPlayWatchdog()
          this._tryPlayNextSegment()
          this._maybeFinishTurnPlayback()
          return
        }
        if (this.onPlayStart) this.onPlayStart()
      },
      fail: (err) => {
        this.preparingSegment = false
        if (!this.traceState || this.traceState.traceId !== traceRef.traceId) {
          traceRef.staleCallbackCount += 1
          if (DEBUG_AUDIO_TRACE) {
            console.warn('[AudioTrace] stale-write-fail-callback', {
              expectedTraceId: traceRef.traceId,
              currentTraceId: this.traceState ? this.traceState.traceId : '',
            })
          }
          this._tryPlayNextSegment()
          return
        }
        console.error('[AudioPlayer] write segment error:', err)
        this.playing = false
        // 当前片段写失败时尝试继续后续片段，避免整句静音
        this._tryPlayNextSegment()
        this._maybeFinishTurnPlayback()
      },
    })
  }

  _maybeFinishTurnPlayback() {
    if (!this.turnSealRequested) return false
    if (this.playing || this.preparingSegment) return false
    if (this.segmentQueue.length > 0) return false
    if (this.pendingBytes > 0) {
      this._flushPendingToQueue(true)
      this._compactSegmentQueue()
      this._tryPlayNextSegment()
      if (this.playing || this.preparingSegment || this.segmentQueue.length > 0) {
        return false
      }
    }
    if (this.traceState) this._flushTraceSummary()
    this.turnSealRequested = false
    if (this.onPlayEnd) this.onPlayEnd()
    return true
  }

  _armPlayWatchdog() {
    this._clearPlayWatchdog()
    this.playWatchdogTimer = setTimeout(() => {
      console.warn('[AudioPlayer] 播放超时，强制解锁播放状态')
      console.warn(FLOW_LOG_PREFIX, '播放 watchdog 触发，准备解锁并续播')
      this.playing = false
      try {
        this.audioCtx.stop()
      } catch (e) {}
      this._tryPlayNextSegment()
    }, PLAYBACK_WATCHDOG_MS)
  }

  _clearPlayWatchdog() {
    if (this.playWatchdogTimer) {
      clearTimeout(this.playWatchdogTimer)
      this.playWatchdogTimer = null
    }
  }

  /**
   * 停止播放（用于用户打断）
   */
  stop() {
    this._clearPlayWatchdog()
    if (this.audioCtx) {
      try { this.audioCtx.stop() } catch (e) {}
    }
    this.pcmChunks = []
    this.pendingChunks = []
    this.pendingBytes = 0
    this.segmentQueue = []
    this.hasStartedStreamPlayback = false
    this.playing = false
    this.preparingSegment = false
    this.turnSealRequested = false
  }

  destroy() {
    this._clearPlayWatchdog()
    if (this.audioCtx) {
      try { this.audioCtx.destroy() } catch (e) {}
      this.audioCtx = null
    }
  }

  _ensureAudioContext() {
    if (this.audioCtx) return
    const ctx = wx.createInnerAudioContext()
    this.audioCtx = ctx
    ctx.onEnded(() => {
      this.playing = false
      this._clearPlayWatchdog()
      if (this.traceState) {
        this.traceState.lastEndedAt = Date.now()
        this.traceState.endedCount += 1
      }
      if (DEBUG_AUDIO_TRACE) {
        console.log(FLOW_LOG_PREFIX, 'onEnded，尝试播放下一段', {
          queueSize: this.segmentQueue.length,
        })
      }
      this._tryPlayNextSegment()
      this._maybeFinishTurnPlayback()
    })
    ctx.onError((err) => {
      console.error('[AudioPlayer] error:', err)
      console.error(FLOW_LOG_PREFIX, '播放错误，尝试继续后续分段', err)
      const errMsg = String((err && err.errMsg) || '')
      let shouldDelayedRetry = false
      if (errMsg.includes('audioInstance is not set')) {
        try { ctx.destroy() } catch (e) {}
        this.audioCtx = null
        shouldDelayedRetry = true
      }
      this.playing = false
      this._clearPlayWatchdog()
      if (shouldDelayedRetry) {
        setTimeout(() => {
          this._tryPlayNextSegment()
        }, 80)
        return
      }
      this._tryPlayNextSegment()
    })
  }

  _playFile(filePath) {
    this._ensureAudioContext()
    if (!this.audioCtx) return false
    try {
      this.audioCtx.src = filePath
      this.audioCtx.play()
      return true
    } catch (err) {
      console.warn(FLOW_LOG_PREFIX, '播放异常，尝试重建播放器后重试', err)
      try { this.audioCtx.destroy() } catch (e) {}
      this.audioCtx = null
      this._ensureAudioContext()
      if (!this.audioCtx) return false
      try {
        this.audioCtx.src = filePath
        this.audioCtx.play()
        return true
      } catch (retryErr) {
        console.error(FLOW_LOG_PREFIX, '播放器重试仍失败', retryErr)
        return false
      }
    }
  }

  _ensureTraceState() {
    if (this.traceState) return
    this.traceState = {
      traceId: `tts_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      inputBytes: 0,
      segmentEnqueueCount: 0,
      playSegmentCount: 0,
      mergedAppendCount: 0,
      queuePeak: 0,
      endedCount: 0,
      writeCostMs: [],
      switchGapMs: [],
      staleCallbackCount: 0,
      lastEndedAt: 0,
    }
  }

  _flushTraceSummary() {
    if (!this.traceState) return
    const writeAvg = this.traceState.writeCostMs.length
      ? Math.round(this.traceState.writeCostMs.reduce((a, b) => a + b, 0) / this.traceState.writeCostMs.length)
      : 0
    const switchAvg = this.traceState.switchGapMs.length
      ? Math.round(this.traceState.switchGapMs.reduce((a, b) => a + b, 0) / this.traceState.switchGapMs.length)
      : 0
    console.log('[AudioTrace] summary', {
      traceId: this.traceState.traceId,
      inputBytes: this.traceState.inputBytes,
      enqueueSegments: this.traceState.segmentEnqueueCount,
      playedSegments: this.traceState.playSegmentCount,
      mergedAppendCount: this.traceState.mergedAppendCount,
      queuePeak: this.traceState.queuePeak,
      endedCount: this.traceState.endedCount,
      writeAvgMs: writeAvg,
      switchAvgMs: switchAvg,
      staleCallbackCount: this.traceState.staleCallbackCount,
    })
    if (this.traceState.playSegmentCount > AUDIO_STUTTER_WARN_SEGMENTS || switchAvg > AUDIO_STUTTER_WARN_SWITCH_AVG_MS) {
      console.warn('[AudioTrace] stutter-risk', {
        traceId: this.traceState.traceId,
        playedSegments: this.traceState.playSegmentCount,
        switchAvgMs: switchAvg,
        thresholds: {
          playedSegments: AUDIO_STUTTER_WARN_SEGMENTS,
          switchAvgMs: AUDIO_STUTTER_WARN_SWITCH_AVG_MS,
        },
      })
    }
    this.traceState = null
  }
}

/**
 * 给 PCM 数据添加 WAV 文件头
 */
function addWavHeader(pcmBuffer, sampleRate, bitDepth, channels) {
  const pcmLen = pcmBuffer.byteLength
  const wavLen = 44 + pcmLen
  const buffer = new ArrayBuffer(wavLen)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, wavLen - 8, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bitDepth / 8, true) // byte rate
  view.setUint16(32, channels * bitDepth / 8, true) // block align
  view.setUint16(34, bitDepth, true)

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, pcmLen, true)

  // 写入 PCM 数据
  new Uint8Array(buffer, 44).set(new Uint8Array(pcmBuffer))

  return buffer
}

function concatArrayBuffers(buffers) {
  const totalLen = (buffers || []).reduce((sum, buf) => sum + (buf ? buf.byteLength : 0), 0)
  const merged = new Uint8Array(totalLen)
  let offset = 0
  ;(buffers || []).forEach((buf) => {
    if (!buf || !buf.byteLength) return
    merged.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
  })
  return merged.buffer
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

module.exports = {
  AudioRecorder,
  AudioPlayer,
  SAMPLE_RATE,
  FRAME_SIZE,
}
