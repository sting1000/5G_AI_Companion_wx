const fs = require('fs')
const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('onboarding S0 首次设置', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/onboarding/onboarding.js')

  function createStoreMock(existingConfig = null) {
    return {
      getElderConfig: jest.fn(() => existingConfig),
      getElderKey: jest.fn((config) => {
        const name = config && (config.parentName || config.preferredAddress)
        return name ? `elder:${name}:0001` : 'elder:old:0001'
      }),
      saveElderConfig: jest.fn(),
      initMemoryBundle: jest.fn(),
      clearDialogId: jest.fn(),
    }
  }

  function createPermissionsMock() {
    return {
      authorizeRecord: jest.fn(() => Promise.resolve({ state: 'granted' })),
      getPermissionSnapshot: jest.fn(() => Promise.resolve({
        microphone: 'initial',
        notification: 'unconfigured',
        templateConfigured: false,
      })),
      getReminderTemplateId: jest.fn(() => ''),
      openAppSettings: jest.fn(() => Promise.resolve({ authSetting: {} })),
      requestReminderSubscription: jest.fn(() => Promise.resolve({
        state: 'unconfigured',
        templateConfigured: false,
      })),
      resolveNotificationState: jest.fn(() => 'initial'),
    }
  }

  function createSpeechMock() {
    const instances = []
    class SpeechRecognizerMock {
      constructor() {
        this.start = jest.fn(() => Promise.resolve(true))
        this.stop = jest.fn()
        this.destroy = jest.fn()
        instances.push(this)
      }
    }
    return { SpeechRecognizerMock, instances }
  }

  function loadPage(options = {}) {
    const storeMock = options.storeMock || createStoreMock()
    const permissionsMock = options.permissionsMock || createPermissionsMock()
    const speechMock = options.speechMock || createSpeechMock()
    jest.resetModules()
    jest.doMock('../../miniprogram/utils/store', () => storeMock)
    jest.doMock('../../miniprogram/utils/permissions', () => permissionsMock)
    jest.doMock('../../miniprogram/utils/onboarding-speech', () => ({
      OnboardingSpeechRecognizer: speechMock.SpeechRecognizerMock,
    }))
    return {
      page: loadPageModule(pagePath),
      storeMock,
      permissionsMock,
      speechMock,
    }
  }

  test.each([
    ['', '请告诉小林怎么称呼您'],
    ['！', '称呼请只使用中文'],
    ['一二三四五六七八九十甲', '称呼最多 10 个中文字符'],
  ])('拒绝无效称呼 %p', async (address, expectedError) => {
    const { page, storeMock } = loadPage()
    page.setData({ address })

    await page.onSaveAddress()

    expect(page.data.validationError).toBe(expectedError)
    expect(storeMock.saveElderConfig).not.toHaveBeenCalled()
  })

  test('点击建议称呼会填入输入框', () => {
    const { page } = loadPage()

    page.onSuggestionTap({ currentTarget: { dataset: { value: '李叔叔' } } })

    expect(page.data.address).toBe('李叔叔')
    expect(page.data.validationError).toBe('')
  })

  test('保存称呼后进入权限说明，再由进入今天跳转 dashboard', async () => {
    const { page, storeMock } = loadPage()
    page.setData({ address: '王阿姨' })

    await page.onSaveAddress()

    expect(storeMock.saveElderConfig).not.toHaveBeenCalled()
    expect(page.pendingConfig).toEqual(expect.objectContaining({
      preferredAddress: '王阿姨',
      parentName: '王阿姨',
      role: '小林',
    }))
    expect(page.data.step).toBe(2)

    page.enterToday()
    expect(storeMock.saveElderConfig).toHaveBeenCalledWith(expect.objectContaining({
      preferredAddress: '王阿姨',
    }))
    expect(storeMock.initMemoryBundle).toHaveBeenCalledWith(
      'elder:王阿姨:0001',
      expect.objectContaining({ preferredAddress: '王阿姨' })
    )
    expect(wx.reLaunch).toHaveBeenCalledWith({
      url: '/pages/dashboard/dashboard',
    })
  })

  test('更新称呼时保留旧手机号、健康和兴趣数据', async () => {
    const oldConfig = {
      parentName: '王秀兰',
      phone: '13800138000',
      health: '血压偏高',
      hobbies: ['太极拳'],
      titleSuffix: '阿姨',
      customLegacyField: 'keep',
    }
    const storeMock = createStoreMock(oldConfig)
    const { page } = loadPage({ storeMock })
    page.setData({ address: '老王' })

    await page.onSaveAddress()
    page.enterToday()

    expect(storeMock.saveElderConfig).toHaveBeenCalledWith(expect.objectContaining({
      parentName: '王秀兰',
      preferredAddress: '老王',
      phone: '13800138000',
      health: '血压偏高',
      hobbies: ['太极拳'],
      customLegacyField: 'keep',
    }))
  })

  test('从设置修改称呼会立即保存并返回，不进入权限步骤', async () => {
    const oldConfig = {
      parentName: '王秀兰',
      preferredAddress: '王阿姨',
      phone: '13800138000',
      customLegacyField: 'keep',
    }
    const storeMock = createStoreMock(oldConfig)
    const { page } = loadPage({ storeMock })

    page.onLoad({ mode: 'edit', step: '1' })
    page.setData({ address: '老王' })
    await page.onSaveAddress()

    expect(page.data.isEditMode).toBe(true)
    expect(page.data.step).toBe(1)
    expect(storeMock.saveElderConfig).toHaveBeenCalledWith(expect.objectContaining({
      parentName: '王秀兰',
      preferredAddress: '老王',
      phone: '13800138000',
      customLegacyField: 'keep',
    }))
    expect(wx.navigateBack).toHaveBeenCalled()
    expect(wx.reLaunch).not.toHaveBeenCalled()
  })

  test('麦克风允许、拒绝后通过设置恢复都有真实状态', async () => {
    const permissionsMock = createPermissionsMock()
    const { page } = loadPage({ permissionsMock })

    await page.onMicrophonePermissionTap()
    expect(page.data.microphoneState).toBe('granted')

    page.setData({ microphoneState: 'denied' })
    permissionsMock.openAppSettings.mockResolvedValueOnce({
      authSetting: { 'scope.record': true },
    })
    await page.onMicrophonePermissionTap()

    expect(permissionsMock.openAppSettings).toHaveBeenCalled()
    expect(page.data.microphoneState).toBe('granted')
  })

  test('麦克风拒绝时保留进入首页能力并说明影响', async () => {
    const permissionsMock = createPermissionsMock()
    permissionsMock.authorizeRecord.mockResolvedValueOnce({ state: 'denied' })
    const { page } = loadPage({ permissionsMock })

    await page.onMicrophonePermissionTap()

    expect(page.data.microphoneState).toBe('denied')
    expect(page.data.permissionImpactText).toContain('暂时不能和小林通话')
    page.enterToday()
    expect(wx.reLaunch).toHaveBeenCalled()
  })

  test('通知模板未配置时不会虚假显示已允许', async () => {
    const permissionsMock = createPermissionsMock()
    const { page } = loadPage({ permissionsMock })
    page.setData({
      notificationState: 'initial',
      templateConfigured: false,
    })

    await page.onNotificationPermissionTap()

    expect(page.data.notificationState).toBe('unconfigured')
    expect(page.data.templateConfigured).toBe(false)
    expect(page.data.permissionImpactText).toContain('尚未配置通知模板')
  })

  test('页面卸载时释放称呼语音识别资源', () => {
    const { page } = loadPage()
    const recognizer = { destroy: jest.fn() }
    page.speechRecognizer = recognizer

    page.onUnload()

    expect(recognizer.destroy).toHaveBeenCalled()
    expect(page.speechRecognizer).toBe(null)
  })

  test('手工输入会停止仍在运行的语音识别，防止回调覆盖', () => {
    const { page } = loadPage()
    const recognizer = { destroy: jest.fn() }
    page.speechRecognizer = recognizer

    page.onAddressInput({ detail: { value: '老张' } })

    expect(recognizer.destroy).toHaveBeenCalled()
    expect(page.data.address).toBe('老张')
  })

  test('全局标题为叮嘱且 app.json 不再包含 tabBar', () => {
    const appJson = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../miniprogram/app.json'),
      'utf8'
    ))
    expect(appJson.window.navigationBarTitleText).toBe('叮嘱')
    expect(appJson.pages[0]).toBe('pages/dashboard/dashboard')
    expect(appJson.tabBar).toBeUndefined()
  })
})
