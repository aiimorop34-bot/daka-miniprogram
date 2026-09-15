const partner = require('../../utils/partner')
const { createShareConfig } = require('../../utils/share')
const app = getApp()

const CACHE_KEYS = {
  partners: 'me_page_partners',
  reminder: 'me_page_reminder'
}

function getCache(key) {
  try {
    return wx.getStorageSync(key)
  } catch (e) {
    return null
  }
}

function setCache(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    console.error('缓存失败', key, e)
  }
}

function normalizeUserInfo(info) {
  return {
    nickname: (info && info.nickname || '').trim(),
    avatarUrl: (info && info.avatarUrl || '').trim()
  }
}

Page({
  ...createShareConfig({
    title: '来和我一起刷题打卡',
    timelineTitle: '来和我一起刷题打卡',
    path: '/pages/index/index'
  }),

  data: {
    userInfo: {},
    originalUserInfo: null,
    hasChanges: false,
    isUserModified: false,
    inviteCode: '',
    partners: [],
    reminder: null,
    isLoading: false,
    isSaving: false,
    isUploadingAvatar: false,
    isTogglingReminder: false,
    showRemoveId: ''
  },

  computeHasChanges(current, original) {
    if (!original) return false
    const cur = normalizeUserInfo(current)
    const orig = normalizeUserInfo(original)
    return cur.nickname !== orig.nickname || cur.avatarUrl !== orig.avatarUrl
  },

  onShow() {
    this.loadData()
  },

  onPullDownRefresh() {
    this.loadData({ pullDown: true }).finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  async loadData(options = {}) {
    const cachedUserInfo = partner.getUserInfo()
    const cachedInviteCode = partner.getInviteCode()
    const cachedPartners = getCache(CACHE_KEYS.partners) || []
    const cachedReminder = getCache(CACHE_KEYS.reminder) || null

    const hasCache = cachedUserInfo.nickname || cachedUserInfo.avatarUrl || cachedPartners.length > 0

    // 1. 先展示缓存，用户不必对着空白页等待
    // 初始状态作为"未改动"的参照
    this.setData({
      userInfo: cachedUserInfo,
      originalUserInfo: cachedUserInfo,
      hasChanges: false,
      isUserModified: false,
      inviteCode: cachedInviteCode,
      partners: cachedPartners,
      reminder: cachedReminder,
      isLoading: !hasCache
    })

    try {
      // 2. 并行发起三个无依赖的云端请求
      const [profileRes, partnersRes, reminderRes] = await Promise.all([
        partner.getUserProfile().catch(err => {
          console.error('拉取云端资料失败', err)
          return { code: -1 }
        }),
        partner.getPartners().catch(err => {
          console.error('拉取伙伴列表失败', err)
          return { list: [] }
        }),
        partner.getReminderSubscription().catch(err => {
          console.error('拉取提醒状态失败', err)
          return { code: -1 }
        })
      ])

      let userInfo = cachedUserInfo
      let inviteCode = cachedInviteCode

      if (profileRes.code === 0 && profileRes.data) {
        userInfo = {
          nickname: profileRes.data.nickname || '',
          avatarUrl: profileRes.data.avatarUrl || ''
        }
        inviteCode = profileRes.data.inviteCode || ''
        partner.setUserInfo(userInfo)
        partner.setInviteCode(inviteCode)
      }

      // 3. 如果云端仍无邀请码，再异步确保生成（不影响页面主要内容展示）
      if (!inviteCode) {
        try {
          inviteCode = await partner.ensureInviteCode()
        } catch (err) {
          console.error('生成邀请码失败', err)
        }
      }

      const partners = partnersRes.list || []
      const reminder = reminderRes.code === 0 ? reminderRes.data : cachedReminder

      setCache(CACHE_KEYS.partners, partners)
      setCache(CACHE_KEYS.reminder, reminder)

      // 如果用户已经在云端数据返回前手动修改过资料，保留当前输入；
      // 否则用云端最新数据刷新页面，并把云端数据设为新的参照状态。
      const isModified = this.data.isUserModified
      const currentUserInfo = isModified ? this.data.userInfo : userInfo
      this.setData({
        userInfo: currentUserInfo,
        originalUserInfo: userInfo,
        hasChanges: this.computeHasChanges(currentUserInfo, userInfo),
        inviteCode,
        partners,
        reminder
      })
    } catch (err) {
      console.error('加载我的页面失败', err)
      if (!hasCache && !options.pullDown) {
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    } finally {
      this.setData({ isLoading: false })
    }
  },

  async onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    if (!avatarUrl) return

    this.setData({ isUploadingAvatar: true })
    wx.showLoading({ title: '上传头像中' })

    try {
      const openid = app.globalData.openid || ''
      const suffix = avatarUrl.match(/\.\w+$/) ? avatarUrl.match(/\.\w+$/)[0] : '.png'
      const cloudPath = openid
        ? `avatars/${openid}_${Date.now()}${suffix}`
        : `avatars/${Date.now()}_${Math.random().toString(36).slice(2)}${suffix}`

      // 先压缩再上传，避免原图过大导致安全检测接口超限
      const compressRes = await new Promise((resolve, reject) => {
        wx.compressImage({
          src: avatarUrl,
          quality: 80,
          compressedWidth: 400,
          compressedHeight: 400,
          success: resolve,
          fail: reject
        })
      })
      const compressedPath = compressRes.tempFilePath

      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: compressedPath
      })

      const userInfo = { ...this.data.userInfo, avatarUrl: uploadRes.fileID }
      this.setData({
        userInfo,
        isUserModified: true,
        hasChanges: this.computeHasChanges(userInfo, this.data.originalUserInfo)
      })
      wx.showToast({ title: '头像已上传，记得保存', icon: 'none' })
    } catch (err) {
      console.error('上传头像失败', err)
      wx.showToast({ title: '头像上传失败，请重试', icon: 'none' })
    } finally {
      this.setData({ isUploadingAvatar: false })
      wx.hideLoading()
    }
  },

  onNicknameInput(e) {
    const nickname = e.detail.value
    const userInfo = { ...this.data.userInfo, nickname }
    this.setData({
      userInfo,
      isUserModified: true,
      hasChanges: this.computeHasChanges(userInfo, this.data.originalUserInfo)
    })
  },

  async onSaveProfile() {
    const { userInfo, hasChanges } = this.data

    if (!hasChanges) {
      wx.showToast({ title: '当前没有需要保存的改动', icon: 'none' })
      return
    }

    if (!userInfo.nickname.trim() && !userInfo.avatarUrl) {
      wx.showToast({ title: '请填写昵称或选择头像', icon: 'none' })
      return
    }

    this.setData({ isSaving: true })

    try {
      const res = await partner.saveUserProfile({
        nickname: userInfo.nickname.trim(),
        avatarUrl: userInfo.avatarUrl
      })

      if (res.result && res.result.code === 0) {
        const savedUserInfo = normalizeUserInfo(userInfo)
        this.setData({
          userInfo: savedUserInfo,
          originalUserInfo: savedUserInfo,
          hasChanges: false,
          isUserModified: false
        })
        wx.showToast({ title: '保存成功', icon: 'success' })
      } else {
        throw new Error(res.result && res.result.msg)
      }
    } catch (err) {
      console.error('保存资料失败', err)
      const msg = err.message || err.errMsg || '保存失败，请重试'
      wx.showToast({ title: msg, icon: 'none' })
    } finally {
      this.setData({ isSaving: false })
    }
  },

  onCopyCode() {
    wx.setClipboardData({
      data: this.data.inviteCode,
      success: () => {
        wx.showToast({ title: '邀请码已复制', icon: 'success' })
      }
    })
  },

  onAddPartner() {
    wx.navigateTo({
      url: '/pages/add-partner/add-partner'
    })
  },

  onViewRank() {
    wx.navigateTo({
      url: '/pages/partner-rank/partner-rank'
    })
  },

  onToggleRemove(e) {
    const { openid } = e.currentTarget.dataset
    this.setData({
      showRemoveId: this.data.showRemoveId === openid ? '' : openid
    })
  },

  onRemovePartner(e) {
    const { openid } = e.currentTarget.dataset
    wx.showModal({
      title: '移除学习伙伴',
      content: '确定不再与这位伙伴互相查看学习数据吗？',
      confirmColor: '#ff3b30',
      success: (res) => {
        if (res.confirm) {
          partner.removePartner(openid).then(() => {
            wx.showToast({ title: '已移除', icon: 'success' })
            this.loadData()
          }).catch(() => {
            wx.showToast({ title: '移除失败', icon: 'none' })
          })
        }
      }
    })
  },

  async onToggleReminder() {
    if (this.data.isTogglingReminder) return

    const { reminder } = this.data
    console.log('[me] 点击提醒开关，当前状态:', reminder ? '已开启' : '未开启')

    // 当前已开启，则取消
    if (reminder) {
      this.setData({ isTogglingReminder: true })
      try {
        const res = await partner.saveReminderSubscription({
          isSubscribed: false
        })
        if (res.code === 0) {
          wx.showToast({ title: '已取消提醒', icon: 'success' })
          this.setData({ reminder: null })
        } else {
          throw new Error(res.msg)
        }
      } catch (err) {
        console.error('[me] 取消提醒失败:', err)
        wx.showToast({ title: '取消失败，请重试', icon: 'none' })
      } finally {
        this.setData({ isTogglingReminder: false })
      }
      return
    }

    // 当前未开启，则请求订阅
    const templateId = partner.getReminderTemplateId()
    console.log('[me] 准备开启提醒，模板 ID:', templateId)

    if (!templateId || templateId.indexOf('YOUR_TEMPLATE_ID') > -1) {
      wx.showModal({
        title: '模板 ID 未配置',
        content: '请在 utils/partner.js 中把 REMINDER_TEMPLATE_ID 替换为微信公众平台申请到的真实模板 ID。',
        showCancel: false
      })
      return
    }

    try {
      const authRes = await partner.requestReminderSubscription()
      console.log('[me] 订阅授权结果:', authRes)

      if (authRes[templateId] === 'reject') {
        wx.showToast({ title: '你拒绝了订阅授权', icon: 'none' })
        return
      }

      if (authRes[templateId] !== 'accept') {
        wx.showToast({ title: '需要授权才能开启提醒', icon: 'none' })
        return
      }

      this.setData({ isTogglingReminder: true })
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const remindDate = this.formatDate(tomorrow)

      const res = await partner.saveReminderSubscription({
        remindDate,
        remindTime: '21:00',
        isSubscribed: true
      })

      if (res.code === 0) {
        wx.showToast({ title: '已开启明日提醒', icon: 'success' })
        const reminderRes = await partner.getReminderSubscription()
        this.setData({
          reminder: reminderRes.code === 0 ? reminderRes.data : null
        })
      } else {
        throw new Error(res.msg || '保存订阅记录失败')
      }
    } catch (err) {
      console.error('[me] 开启提醒失败:', err)
      wx.showModal({
        title: '开启提醒失败',
        content: err.message || err.errMsg || '请检查云函数是否已部署、集合权限是否正确。',
        showCancel: false
      })
    } finally {
      this.setData({ isTogglingReminder: false })
    }
  },

  formatDate(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
})
