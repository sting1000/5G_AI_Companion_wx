const { AudioRecorder } = require('./audio')
const { RealtimeAPIClient } = require('./realtime-api')

const RECOGNITION_TIMEOUT_MS = 20000
const STOP_TIMEOUT_MS = 5000

class OnboardingSpeechRecognizer {
  constructor(options = {}) {
    this.ClientClass = options.ClientClass || RealtimeAPIClient
    this.RecorderClass = options.RecorderClass || AudioRecorder
    this.client = null
    this.recorder = null
    this.callbacks = {}
    this.active = false
    this.starting = false
    this.stopping = false
    this.destroyed = false
    this.latestFinalText = ''
    this.recognitionTimer = null
    this.stopTimer = null
    this.generation = 0
  }

  async start(callbacks = {}) {
    if (this.active || this.starting) return false
    this.destroyed = false
    this.starting = true
    this.callbacks = callbacks
    this.latestFinalText = ''
    const generation = ++this.generation
    this.client = new this.ClientClass()
    this.recorder = new this.RecorderClass()
    this._bindCallbacks(generation)

    try {
      await this.client.connect()
      if (this.destroyed || generation !== this.generation) return false
      await this.client.startSession({
        botName: '小林',
        systemRole: '只识别用户说出的称呼，不主动回答，不扩展对话。',
        speakingStyle: '不主动回答。',
        inputMode: 'push_to_talk',
        asrConfig: {
          enableCustomVad: true,
          endSmoothWindowMs: 800,
          enableAsrTwopass: true,
        },
      })
      if (this.destroyed || generation !== this.generation) return false

      this.active = true
      this.starting = false
      this.recorder.start()
      if (this.callbacks.onListening) this.callbacks.onListening()
      this.recognitionTimer = setTimeout(() => {
        this._fail(new Error('语音识别超时'), generation)
      }, RECOGNITION_TIMEOUT_MS)
      return true
    } catch (error) {
      this.starting = false
      this._cleanup()
      throw error
    }
  }

  stop() {
    if (!this.active || this.stopping) return
    this.stopping = true
    if (this.recorder) this.recorder.stop()
    try {
      if (this.client && this.client.sessionActive) this.client.endASR()
    } catch (err) {
      this._fail(err, this.generation)
      return
    }
    this._clearRecognitionTimer()
    this._clearStopTimer()
    const generation = this.generation
    this.stopTimer = setTimeout(() => {
      if (this.latestFinalText) {
        this._complete(this.latestFinalText, generation)
      } else {
        this._fail(new Error('没有识别到称呼'), generation)
      }
    }, STOP_TIMEOUT_MS)
  }

  destroy() {
    this.destroyed = true
    this.generation += 1
    this._cleanup()
  }

  _bindCallbacks(generation) {
    this.recorder.onFrameData = (buffer) => {
      if (!this.active || generation !== this.generation) return
      this.client.sendAudio(buffer)
    }
    this.recorder.onError = (error) => {
      this._fail(error || new Error('录音失败'), generation)
    }
    this.client.onASRText = (text, isFinal) => {
      if (generation !== this.generation) return
      const normalized = String(text || '').trim()
      if (!normalized) return
      if (isFinal) {
        this.latestFinalText = normalized
        this._complete(normalized, generation)
        return
      }
      if (this.callbacks.onInterim) this.callbacks.onInterim(normalized)
    }
    this.client.onASREnd = () => {
      if (generation !== this.generation) return
      if (this.latestFinalText) {
        this._complete(this.latestFinalText, generation)
      } else {
        this._fail(new Error('没有识别到称呼'), generation)
      }
    }
    this.client.onError = (error) => this._fail(error, generation)
    this.client.onDisconnect = () => {
      if (this.active || this.starting) {
        this._fail(new Error('语音连接已断开'), generation)
      }
    }
  }

  _complete(text, generation) {
    if (generation !== this.generation) return
    const callback = this.callbacks.onResult
    this._cleanup()
    if (callback) callback(text)
  }

  _fail(error, generation) {
    if (generation !== this.generation) return
    const callback = this.callbacks.onError
    this._cleanup()
    if (callback) callback(error || new Error('语音识别失败'))
  }

  _cleanup() {
    this._clearRecognitionTimer()
    this._clearStopTimer()
    this.active = false
    this.starting = false
    this.stopping = false
    if (this.recorder) {
      this.recorder.onFrameData = null
      this.recorder.onError = null
      if (typeof this.recorder.destroy === 'function') {
        this.recorder.destroy()
      } else {
        this.recorder.stop()
      }
    }
    if (this.client) {
      this.client.onASRText = null
      this.client.onASREnd = null
      this.client.onError = null
      this.client.onDisconnect = null
      if (this.client.sessionActive) this.client.finishSession()
      this.client.disconnect()
    }
    this.recorder = null
    this.client = null
  }

  _clearRecognitionTimer() {
    if (!this.recognitionTimer) return
    clearTimeout(this.recognitionTimer)
    this.recognitionTimer = null
  }

  _clearStopTimer() {
    if (!this.stopTimer) return
    clearTimeout(this.stopTimer)
    this.stopTimer = null
  }
}

module.exports = {
  OnboardingSpeechRecognizer,
  RECOGNITION_TIMEOUT_MS,
  STOP_TIMEOUT_MS,
}
