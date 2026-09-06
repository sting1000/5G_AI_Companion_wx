const fs = require('fs')
const path = require('path')
const { loadPageModule } = require('../helpers/page-loader')

describe('settings 老人侧设置', () => {
  const pagePath = path.resolve(__dirname, '../../miniprogram/pages/settings/settings.js')

  function loadPage() {
    jest.resetModules()
    return loadPageModule(pagePath)
  }

  test('加载真实称呼和权限状态', async () => {
    const store = require('../../miniprogram/utils/store')
    store.saveElderConfig({
      parentName: '王',
      titleSuffix: '阿姨',
      preferredAddress: '王阿姨',
    })
    wx.getSetting.mockImplementation(({ success }) => success({
      authSetting: { 'scope.record': true },
      subscriptionsSetting: { itemSettings: {} },
    }))
    const page = loadPage()
    page.onLoad()

    await page.loadSettings()

    expect(page.data.preferredAddress).toBe('王阿姨')
    expect(page.data.microphoneText).toBe('已允许')
  })

  test('修改称呼进入可编辑的首次设置步骤', () => {
    const page = loadPage()
    page.editPreferredAddress()
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/onboarding/onboarding?mode=edit&step=1',
    })
  })

  test('麦克风和通知行执行真实权限恢复流程', async () => {
    const page = loadPage()
    page._isUnloaded = false
    page.setData({
      microphoneState: 'initial',
      notificationState: 'initial',
    })

    await page.recoverMicrophone()
    expect(wx.authorize).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'scope.record',
    }))
    expect(page.data.microphoneState).toBe('granted')

    await page.recoverNotification()
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: '提醒服务尚未配置',
    }))

    page.setData({ notificationState: 'blocked' })
    await page.recoverNotification()
    expect(wx.openSetting).toHaveBeenCalled()
  })

  test('隐私优先打开微信隐私合同，失败时明确说明', () => {
    const page = loadPage()
    page.openPrivacy()
    expect(wx.openPrivacyContract).toHaveBeenCalled()

    wx.openPrivacyContract.mockImplementation(({ fail }) => fail())
    page.openPrivacy()
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: '暂时无法打开隐私说明',
      showCancel: false,
    }))
  })

  test('关于入口展示真实静态产品信息', () => {
    const page = loadPage()
    page.openAbout()
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: '关于叮嘱',
      content: expect.stringContaining('语音陪伴小程序'),
    }))
  })

  test('正式 WXML 只保留五项设置且没有开发入口', () => {
    const wxml = fs.readFileSync(
      path.resolve(__dirname, '../../miniprogram/pages/settings/settings.wxml'),
      'utf8'
    )
    expect((wxml.match(/class="setting-row"/g) || []).length).toBe(5)
    expect(wxml).not.toMatch(/测试工具|清空本地测试数据|开发调试|小林记忆|模拟来电|AI角色/)
  })
})
