const partner = require('../../utils/partner')

Page({
  data: {
    inviteCode: '',
    inputCode: '',
    isAdding: false
  },

  onLoad() {
    this.loadInviteCode()
  },

  async loadInviteCode() {
    try {
      const code = await partner.ensureInviteCode()
      this.setData({ inviteCode: code })
    } catch (err) {
      console.error('获取邀请码失败', err)
    }
  },

  onCodeInput(e) {
    this.setData({
      inputCode: e.detail.value.toUpperCase()
    })
  },

  onCopyCode() {
    wx.setClipboardData({
      data: this.data.inviteCode,
      success: () => {
        wx.showToast({ title: '邀请码已复制', icon: 'success' })
      }
    })
  },

  async onAddPartner() {
    const code = this.data.inputCode.trim()
    if (code.length !== 6) {
      wx.showToast({ title: '请输入6位邀请码', icon: 'none' })
      return
    }

    this.setData({ isAdding: true })

    try {
      const res = await partner.addPartnerByCode(code)
      if (res.code === 0) {
        wx.showToast({ title: '添加成功', icon: 'success' })
        setTimeout(() => {
          wx.navigateBack()
        }, 1000)
      } else {
        wx.showToast({ title: res.msg || '添加失败', icon: 'none' })
      }
    } catch (err) {
      console.error('添加伙伴失败', err)
      wx.showToast({ title: '添加失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isAdding: false })
    }
  },

  onShareAppMessage() {
    return {
      title: '来和我一起刷题打卡',
      path: `/pages/add-partner/add-partner?code=${this.data.inviteCode}`,
      imageUrl: ''
    }
  }
})