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
const USE_LOW_LATENCY_TTS = true
const TTS_START_BUFFER_MS = 240
const PLAYBACK_WATCHDOG_MS = 20000
const FLOW_LOG_PREFIX = '[AudioFlow]'

/**
 * 录音管理器封装
 */
class AudioRecorder {
  constructor() {
    this.recorder = wx.getRecorderManager()
    this.onFrameData = null // (pcmBuffer: ArrayBuffer) => {}
    this.recording = false

    this.recorder.onStart(() => {
      console.log('[AudioRecorder] 录音已启动')
    })

    this.recorder.onFrameRecorded((res) => {
      if (res.frameBuffer && this.onFrameData) {
        this.onFrameData(res.frameBuffer)
      }
    })

    this.recorder.onError((err) => {
      console.error('[AudioRecorder] error:', JSON.stringify(err))
      this.recording = false
    })

    this.recorder.onStop(() => {
      console.log('[AudioRecorder] 录音已停止')
      this.recording = false
    })
  }

  start() {
    this.recording = true
    console.log('[AudioRecorder] 调用 recorder.start, format=PCM, sampleRate=' + SAMPLE_RATE + ', frameSize=1')
    this.recorder.start({
      sampleRate: SAMPLE_RATE,
      numberOfChannels: CHANNELS,
      encodeBitRate: 48000,
      format: 'PCM',
      frameSize: 1,
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
    this.playWatchdogTimer = null
    this._fileIndex = 0
    this.onPlayStart = null
    this.onPlayEnd = null

    this._ensureAudioContext()
  }

  /**
   * 添加 PCM 音频数据块
   */
  appendChunk(pcmBuffer) {
    const chunk = new Uint8Array(pcmBuffer)
    this.pcmChunks.push(chunk)

    if (!USE_LOW_LATENCY_TTS) return
    this.pendingChunks.push(chunk)
    this.pendingBytes += chunk.byteLength

    // 仅首段低延迟起播，后续数据留到句末一次性播放，避免多段切换导致“卡顿感”
    if (!this.hasStartedStreamPlayback && this.pendingBytes >= this._bytesFromMs(TTS_START_BUFFER_MS)) {
      this._flushPendingToQueue(false)
      this._tryPlayNextSegment()
      this.hasStartedStreamPlayback = true
    }
  }

  /**
   * 将缓冲的 PCM 数据合并，写 WAV 临时文件并播放
   */
  playBuffered() {
    if (this.pcmChunks.length === 0) return

    if (USE_LOW_LATENCY_TTS) {
      this._flushPendingToQueue(true)
      this._tryPlayNextSegment()
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
        console.log(FLOW_LOG_PREFIX, '开始播放整句缓冲音频')
        if (!this._playFile(filePath)) {
          this.playing = false
          this._clearPlayWatchdog()
          return
        }
        if (this.onPlayStart) this.onPlayStart()
      },
      fail: (err) => {
        console.error('[AudioPlayer] write file error:', err)
        this.playing = false
      },
    })
  }

  _bytesFromMs(ms) {
    return Math.floor((SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8) * ms) / 1000)
  }

  _flushPendingToQueue(forceFlush) {
    if (this.pendingBytes <= 0) return
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
    this.segmentQueue.push(pcmData.buffer)
  }

  _tryPlayNextSegment() {
    if (!USE_LOW_LATENCY_TTS) return
    if (this.playing || this.segmentQueue.length === 0) return

    const nextPcmBuffer = this.segmentQueue.shift()
    console.log(FLOW_LOG_PREFIX, '开始播放分段音频', {
      remainQueue: this.segmentQueue.length,
    })
    const wavBuffer = addWavHeader(nextPcmBuffer, SAMPLE_RATE, BIT_DEPTH, CHANNELS)
    const filePath = `${wx.env.USER_DATA_PATH}/tts_${this._fileIndex++}.wav`
    const fs = wx.getFileSystemManager()
    fs.writeFile({
      filePath,
      data: wavBuffer,
      encoding: 'binary',
      success: () => {
        this.playing = true
        this._armPlayWatchdog()
        if (!this._playFile(filePath)) {
          this.playing = false
          this._clearPlayWatchdog()
          this._tryPlayNextSegment()
          return
        }
        if (this.onPlayStart) this.onPlayStart()
      },
      fail: (err) => {
        console.error('[AudioPlayer] write segment error:', err)
        this.playing = false
        // 当前片段写失败时尝试继续后续片段，避免整句静音
        this._tryPlayNextSegment()
      },
    })
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
      console.log(FLOW_LOG_PREFIX, 'onEnded，尝试播放下一段', {
        queueSize: this.segmentQueue.length,
      })
      this._tryPlayNextSegment()
      if (!this.playing && this.segmentQueue.length === 0 && this.onPlayEnd) {
        this.onPlayEnd()
      }
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
