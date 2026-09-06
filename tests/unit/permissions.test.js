describe('permissions 权限适配', () => {
  function loadPermissions() {
    jest.resetModules()
    return require('../../miniprogram/utils/permissions')
  }

  test('占位通知模板视为未配置，且不发起订阅请求', async () => {
    const permissions = loadPermissions()

    const result = await permissions.requestReminderSubscription()

    expect(permissions.getReminderTemplateId()).toBe('')
    expect(result).toEqual({
      state: 'unconfigured',
      templateConfigured: false,
    })
    expect(wx.requestSubscribeMessage).not.toHaveBeenCalled()
  })

  test('读取麦克风拒绝状态并保留通知未配置状态', async () => {
    wx.getSetting.mockImplementationOnce(({ success }) => success({
      authSetting: { 'scope.record': false },
      subscriptionsSetting: { itemSettings: {} },
    }))
    const permissions = loadPermissions()

    await expect(permissions.getPermissionSnapshot()).resolves.toEqual({
      microphone: 'denied',
      notification: 'unconfigured',
      templateConfigured: false,
    })
  })

  test('麦克风拒绝后会复核设置页结果', async () => {
    wx.authorize.mockImplementation(({ fail }) => fail(new Error('denied')))
    wx.showModal.mockImplementation(({ success }) => success({ confirm: true }))
    const permissions = loadPermissions()

    wx.openSetting.mockImplementationOnce(({ success }) => success({
      authSetting: { 'scope.record': false },
    }))
    await expect(permissions.ensureRecordPermission()).resolves.toEqual({
      state: 'denied',
    })

    wx.openSetting.mockImplementationOnce(({ success }) => success({
      authSetting: { 'scope.record': true },
    }))
    await expect(permissions.ensureRecordPermission()).resolves.toEqual({
      state: 'granted',
    })
  })

  test('用户取消设置引导时不会打开设置页', async () => {
    wx.authorize.mockImplementation(({ fail }) => fail(new Error('denied')))
    wx.showModal.mockImplementation(({ success }) => success({ confirm: false }))
    const permissions = loadPermissions()

    await expect(permissions.ensureRecordPermission()).resolves.toEqual({
      state: 'denied',
    })
    expect(wx.openSetting).not.toHaveBeenCalled()
  })

  test('通知总开关关闭时返回 blocked', () => {
    const permissions = loadPermissions()
    expect(permissions.resolveNotificationState({
      subscriptionsSetting: {
        mainSwitch: false,
        itemSettings: {},
      },
    }, 'template-id')).toBe('blocked')
  })
})
