const store = require('../../utils/store')

Page({
  data: {
    elderTitle: '',
    memories: [],
    hasMemories: false,
    showEditor: false,
    editingId: '',
    editText: '',
  },

  onShow() {
    this._loadMemories()
  },

  _loadMemories() {
    const elderKey = store.getElderKey()
    const elderTitle = store.getElderTitle()
    const bundle = store.getMemoryBundle(elderKey)
    const memories = (bundle.memoryItems || [])
      .filter(item => item && item.text)
      .map(item => Object.assign({}, item, {
        typeLabel: this._typeLabel(item.type),
        statusLabel: this._statusLabel(item),
        sensitivityLabel: this._sensitivityLabel(item),
        statusClass: this._statusClass(item),
        evidenceText: item.evidence || '暂无证据',
        sourceText: this._sourceText(item),
      }))
      .sort((a, b) => {
        const statusRank = { pending: 3, confirmed: 2, rejected: 1 }
        const ar = statusRank[a.status] || 0
        const br = statusRank[b.status] || 0
        if (br !== ar) return br - ar
        return Date.parse(b.updatedAt || b.createdAt || '') - Date.parse(a.updatedAt || a.createdAt || '')
      })
    this.setData({
      elderTitle,
      memories,
      hasMemories: memories.length > 0,
    })
  },

  _typeLabel(type) {
    if (type === 'interest') return '兴趣'
    if (type === 'healthNote') return '健康'
    if (type === 'routineNote') return '习惯'
    if (type === 'recentEvent') return '事件'
    if (type === 'followUp') return '跟进'
    if (type === 'tabooTopic') return '慎提'
    return '记忆'
  },

  _statusLabel(item) {
    if (item.status === 'pending' || item.needsConfirmation) return '待确认'
    if (item.status === 'rejected') return '已忽略'
    return '已确认'
  },

  _statusClass(item) {
    if (item.status === 'pending' || item.needsConfirmation) return 'status-pending'
    if (item.status === 'rejected') return 'status-rejected'
    return 'status-confirmed'
  },

  _sensitivityLabel(item) {
    if (item.sensitivity === 'sensitive') return '敏感'
    if (item.type === 'healthNote') return '健康'
    return '普通'
  },

  _sourceText(item) {
    const source = item.source === 'cloud_ark'
      ? '模型抽取'
      : (item.source === 'local_rule' ? '本地规则' : (item.source || '摘要'))
    const date = item.observedAt || item.createdAt || ''
    if (!date) return source
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) return source
    return `${source} · ${parsed.getMonth() + 1}月${parsed.getDate()}日`
  },

  onConfirmMemory(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    store.confirmMemoryItem(store.getElderKey(), id, true)
    this._loadMemories()
    wx.showToast({ title: '已确认', icon: 'success' })
  },

  onRejectMemory(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    store.confirmMemoryItem(store.getElderKey(), id, false)
    this._loadMemories()
    wx.showToast({ title: '已忽略', icon: 'none' })
  },

  onDeleteMemory(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除记忆',
      content: '删除后小林不会再主动使用这条记忆。',
      success: (res) => {
        if (!res.confirm) return
        store.deleteMemoryItem(store.getElderKey(), id)
        this._loadMemories()
        wx.showToast({ title: '已删除', icon: 'none' })
      },
    })
  },

  onEditMemory(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.memories.find(memory => memory.id === id)
    if (!item) return
    this.setData({
      showEditor: true,
      editingId: id,
      editText: item.text || '',
    })
  },

  onEditInput(e) {
    this.setData({ editText: e.detail.value })
  },

  onCloseEditor() {
    this.setData({ showEditor: false, editingId: '', editText: '' })
  },

  onEditorTap() {
    // 阻止点击编辑面板时关闭
  },

  onSaveEdit() {
    const text = String(this.data.editText || '').trim()
    if (!text) {
      wx.showToast({ title: '请输入记忆内容', icon: 'none' })
      return
    }
    store.updateMemoryItem(store.getElderKey(), this.data.editingId, {
      text,
      status: 'confirmed',
      needsConfirmation: false,
      confirmedAt: new Date().toISOString(),
      lastConfirmedAt: new Date().toISOString(),
    })
    this.onCloseEditor()
    this._loadMemories()
    wx.showToast({ title: '已保存', icon: 'success' })
  },
})
