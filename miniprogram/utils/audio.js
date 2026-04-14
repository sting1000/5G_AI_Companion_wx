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
    this.audioCtx = wx.createInnerAudioContext()
    this.pcmChunks = []
    this.playing = false
    this._fileIndex = 0

    this.audioCtx.onEnded(() => {
      this.playing = false
    })

    this.audioCtx.onError((err) => {
      console.error('[AudioPlayer] error:', err)
      this.playing = false
    })
  }

  /**
   * 添加 PCM 音频数据块
   */
  appendChunk(pcmBuffer) {
    this.pcmChunks.push(new Uint8Array(pcmBuffer))
  }

  /**
   * 将缓冲的 PCM 数据合并，写 WAV 临时文件并播放
   */
  playBuffered() {
    if (this.pcmChunks.length === 0) return

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
        this.audioCtx.src = filePath
        this.audioCtx.play()
      },
      fail: (err) => {
        console.error('[AudioPlayer] write file error:', err)
      },
    })
  }

  /**
   * 停止播放（用于用户打断）
   */
  stop() {
    this.audioCtx.stop()
    this.pcmChunks = []
    this.playing = false
  }

  destroy() {
    this.audioCtx.destroy()
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
