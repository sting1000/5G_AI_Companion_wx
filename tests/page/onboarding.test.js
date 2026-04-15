const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('onboarding 页面离线流程', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/onboarding/onboarding.js')

  function createStoreMock() {
    return {
      getElderConfig: jest.fn(() => null),
      getElderKey: jest.fn((config) => (config && config.parentName ? 'elder:new:0001' : 'elder:old:0001')),
      saveElderConfig: jest.fn(),
      initMemoryBundle: jest.fn(),
      clearDialogId: jest.fn(),
      updateProfile: jest.fn(),
    }
  }

  function loadPageWithStore(storeMock) {
    jest.resetModules()
    jest.doMock('../../miniprogram/utils/store', () => storeMock)
    return loadPageModule(pagePath)
  }

  test('validateStep1: 缺少姓名时提示错误', () => {
    const storeMock = createStoreMock()
    const page = loadPageWithStore(storeMock)
    page.setData({ parentName: '', phone: '13800138000' })

    const valid = page.validateStep1()
    expect(valid).toBe(false)
    expect(page.data.errors.parentName).toContain('请输入父母姓名')
    expect(wx.showToast).toHaveBeenCalled()
  })

  test('nextStep 校验通过后会直接保存并跳转 dashboard', () => {
    const storeMock = createStoreMock()
    const page = loadPageWithStore(storeMock)
    page.setData({ parentName: '王阿姨', phone: '13800138000' })

    page.nextStep()
    expect(storeMock.saveElderConfig).toHaveBeenCalled()
    expect(storeMock.initMemoryBundle).toHaveBeenCalled()
    expect(wx.reLaunch).toHaveBeenCalledWith({
      url: '/pages/dashboard/dashboard',
    })
  })

  test('nextStep 会按选中兴趣与健康信息写入 profile', () => {
    const storeMock = createStoreMock()
    const page = loadPageWithStore(storeMock)

    page.setData({
      parentName: '王阿姨',
      phone: '13800138000',
      health: '血压偏高',
      titleIndex: 0,
      interestTags: [
        { name: '太极拳', selected: true },
        { name: '书法', selected: false },
      ],
    })

    page.nextStep()

    expect(storeMock.saveElderConfig).toHaveBeenCalled()
    expect(storeMock.initMemoryBundle).toHaveBeenCalled()
    expect(storeMock.updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      hobbies: ['太极拳'],
      health: '血压偏高',
    }))
    expect(wx.reLaunch).toHaveBeenCalledWith({
      url: '/pages/dashboard/dashboard',
    })
  })
})
