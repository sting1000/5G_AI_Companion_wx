const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('call 页面离线关键分支', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/call/call.js')

  function loadPage() {
    jest.resetModules()
    return loadPageModule(pagePath)
  }

  test('onAccept 首次点击会设置接听态并触发 _startCall', () => {
    const page = loadPage()
    page._startCall = jest.fn()

    page.onAccept()

    expect(page.data.isIncomingAnswering).toBe(true)
    expect(page.data.connectionPhase).toBe('dialing')
    expect(page._startCall).toHaveBeenCalledTimes(1)
  })

  test('onAccept 在重复点击时会直接返回', () => {
    const page = loadPage()
    page._startCall = jest.fn()
    page.setData({ isIncomingAnswering: true })

    page.onAccept()
    expect(page._startCall).not.toHaveBeenCalled()
  })

  test('onDecline 在可拒接状态会返回上一页', () => {
    const page = loadPage()
    page.setData({ isIncomingAnswering: false })
    page.onDecline()
    expect(wx.navigateBack).toHaveBeenCalled()
  })

  test('_setConnectionPhase 会根据呼叫模式写入提示语', () => {
    const page = loadPage()

    page.setData({ callMode: 'outgoing' })
    page._setConnectionPhase('dialing')
    expect(page.data.connectionHint).toBe('正在呼叫小林...')

    page.setData({ callMode: 'incoming' })
    page._setConnectionPhase('dialing')
    expect(page.data.connectionHint).toBe('正在接听，马上就好...')
  })

  test('_authorize 失败且用户取消时会 reject', async () => {
    const page = loadPage()
    wx.authorize.mockImplementation(({ fail }) => fail())
    wx.showModal.mockImplementation(({ success }) => success({ confirm: false }))

    await expect(page._authorize()).rejects.toThrow('用户拒绝麦克风权限')
  })

  test('首句仅走 SAY_HELLO/TTS 时也会落字幕和消息', () => {
    const page = loadPage()
    page._markCallConnectedIfNeeded = jest.fn()
    page.client = {}
    page.recorder = {}
    page.player = {
      appendChunk: jest.fn(),
      playBuffered: jest.fn(),
      stop: jest.fn(),
      playing: false,
    }
    page.messages = []
    page.chatBuffer = ''
    page.pendingAssistantDraft = '您好呀，我是小林。'
    page.currentTurnBoundaryViolated = false
    page.assistantTurnCount = 0
    page.isBoundaryRepairing = false
    page.currentLatencyTurn = null
    page.setData({
      currentAssistantDraft: '您好呀，我是小林。',
      transcriptItems: [],
    })

    page._setupCallbacks()
    page.client.onTTSStart('')
    page.client.onTTSEnd()

    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].role).toBe('assistant')
    expect(page.messages[0].content).toBe('您好呀，我是小林。')
    expect(page.data.transcriptItems).toHaveLength(1)
    expect(page.data.transcriptItems[0].role).toBe('assistant')
    expect(page.data.transcriptItems[0].content).toBe('您好呀，我是小林。')
  })
})
