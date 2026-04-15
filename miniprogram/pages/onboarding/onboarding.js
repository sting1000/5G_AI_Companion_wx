const store = require('../../utils/store')

Page({
  data: {
    currentStep: 1, // 当前步骤: 1, 2
    titleOptions: ['阿姨', '叔叔', '爷爷', '奶奶'],
    titleIndex: 0,
    // 表单数据
    parentName: '',
    phone: '',
    health: '',
    // 兴趣标签
    interestTags: [
      { name: '太极拳', selected: false },
      { name: '书法', selected: false },
      { name: '烹饪', selected: false },
      { name: '广场舞', selected: false },
      { name: '养生', selected: false },
      { name: '看电视剧', selected: false },
      { name: '棋牌', selected: false },
    ],
    errors: {
      parentName: '',
      phone: '',
    },
  },

  onLoad() {
    // 如果已有配置，回填表单
    const config = store.getElderConfig()
    if (config) {
      const tagNames = config.hobbies || []
      const tags = this.data.interestTags.map(t => ({
        ...t,
        selected: tagNames.includes(t.name),
      }))
      this.setData({
        parentName: config.parentName || '',
        phone: config.phone || '',
        health: config.health || '',
        titleIndex: config.titleIndex || 0,
        interestTags: tags,
      })
    }
  },

  // ===== 表单输入处理 =====
  onNameInput(e) {
    this.setData({
      parentName: e.detail.value,
      'errors.parentName': '',
    })
  },

  onPhoneInput(e) {
    this.setData({
      phone: e.detail.value,
      'errors.phone': '',
    })
  },

  onHealthInput(e) {
    this.setData({ health: e.detail.value })
  },

  onTitleChange(e) {
    this.setData({ titleIndex: parseInt(e.detail.value) })
  },

  // 兴趣标签点击切换
  toggleInterest(e) {
    const idx = e.currentTarget.dataset.idx
    const key = `interestTags[${idx}].selected`
    this.setData({
      [key]: !this.data.interestTags[idx].selected,
    })
  },

  // ===== 步骤导航 =====
  nextStep() {
    if (this.data.currentStep === 1) {
      if (this.validateStep1()) {
        this.setData({ currentStep: 2 })
      }
    } else if (this.data.currentStep === 2) {
      this.saveConfig()
      wx.reLaunch({
        url: '/pages/dashboard/dashboard'
      })
    }
  },

  prevStep() {
    if (this.data.currentStep > 1) {
      this.setData({ currentStep: this.data.currentStep - 1 })
    }
  },

  validateStep1() {
    const name = this.data.parentName.trim()
    const phone = this.data.phone.trim()
    const errors = { parentName: '', phone: '' }

    if (!name) {
      errors.parentName = '请输入父母姓名'
    }

    if (phone && !/^1\d{10}$/.test(phone)) {
      errors.phone = '手机号格式不正确，请输入11位手机号'
    }

    this.setData({ errors })

    if (errors.parentName || errors.phone) {
      wx.showToast({
        title: errors.parentName || errors.phone,
        icon: 'none',
      })
      return false
    }

    return true
  },

  saveConfig() {
    const previousConfig = store.getElderConfig()
    const selectedHobbies = this.data.interestTags
      .filter(t => t.selected)
      .map(t => t.name)

    const titleSuffix = this.data.titleOptions[this.data.titleIndex]

    const config = {
      parentName: this.data.parentName.trim(),
      phone: this.data.phone.trim(),
      titleSuffix: titleSuffix,
      titleIndex: this.data.titleIndex,
      hobbies: selectedHobbies,
      health: this.data.health.trim(),
      role: '小林',
      createdAt: new Date().toISOString(),
    }

    const previousElderKey = store.getElderKey(previousConfig)
    const nextElderKey = store.getElderKey(config)

    store.saveElderConfig(config)
    store.initMemoryBundle(nextElderKey, {
      health: config.health,
      hobbies: selectedHobbies,
      preferredAddress: `${config.parentName.charAt(0)}${titleSuffix}`,
    })

    if (previousElderKey !== nextElderKey) {
      // 切换到新老人时，不复用旧通话上下文
      store.clearDialogId(nextElderKey)
    }

    // 如果有兴趣爱好或健康信息，也更新 profile
    if (selectedHobbies.length > 0 || config.health) {
      store.updateProfile({
        hobbies: selectedHobbies,
        health: config.health,
      })
    }

    console.log('[Onboarding] 配置已保存:', JSON.stringify(config))
  },
})
