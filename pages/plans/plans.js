const partner = require('../../utils/partner')

function clearCache(key) {
  try {
    wx.removeStorageSync(key)
  } catch (e) {
    console.error('[plans] 清除缓存失败', key, e)
  }
}

function clearPlanCaches() {
  clearCache('index_page_plans')
  clearCache('data_page_plans')
}

function checkNetwork() {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success(res) {
        resolve(res.networkType !== 'none')
      },
      fail() {
        resolve(true)
      }
    })
  })
}

Page({
  data: {
    plans: [],
    loading: true,
    modalVisible: false,
    modalTitle: '新建计划',
    editingPlanId: '',
    planName: '',
    subjects: [''],
    saving: false
  },

  onLoad(options) {
    if (options && options.action === 'create') {
      this.onShowCreate()
    }
  },

  onShow() {
    this.loadPlans()
  },

  async loadPlans() {
    this.setData({ loading: true })
    try {
      const res = await partner.getPlans()
      if (res.code !== 0) {
        throw new Error(res.msg || '获取计划列表失败')
      }
      this.setData({ plans: res.plans || [], loading: false })
    } catch (err) {
      console.error('[plans] 加载失败', err)
      this.setData({ loading: false })
      wx.showToast({
        title: err.message || '网络异常，请检查网络后重试',
        icon: 'none',
        duration: 2500
      })
    }
  },

  onShowCreate() {
    this.setData({
      modalVisible: true,
      modalTitle: '新建计划',
      editingPlanId: '',
      planName: '',
      subjects: ['']
    })
  },

  onShowEdit(e) {
    const { plan } = e.currentTarget.dataset
    // 统一按对象数组 [{name: '...'}, ...] 处理，编辑弹窗需要字符串数组
    const subjectNames = (plan.subjects || []).map(s => (s && s.name) || s)
    this.setData({
      modalVisible: true,
      modalTitle: '编辑计划',
      editingPlanId: plan._id,
      planName: plan.name,
      subjects: subjectNames.length > 0 ? [...subjectNames] : ['']
    })
  },

  onCloseModal() {
    if (this.data.saving) return
    this.setData({ modalVisible: false })
  },

  onPlanNameInput(e) {
    this.setData({ planName: e.detail.value })
  },

  onSubjectInput(e) {
    const { index } = e.currentTarget.dataset
    const value = e.detail.value
    const subjects = this.data.subjects
    subjects[index] = value
    this.setData({ subjects })
  },

  onAddSubject() {
    const subjects = this.data.subjects
    if (subjects.length >= 20) {
      wx.showToast({ title: '最多添加20个板块', icon: 'none' })
      return
    }
    subjects.push('')
    this.setData({ subjects })
  },

  onRemoveSubject(e) {
    const { index } = e.currentTarget.dataset
    const subjects = this.data.subjects
    if (subjects.length <= 1) {
      wx.showToast({ title: '至少需要保留1个板块', icon: 'none' })
      return
    }
    subjects.splice(index, 1)
    this.setData({ subjects })
  },

  validateForm() {
    const { planName, subjects } = this.data
    const name = planName.trim()

    if (!name) {
      wx.showToast({ title: '计划名称不能为空', icon: 'none' })
      return null
    }
    if (name.length > 10) {
      wx.showToast({ title: '计划名称不能超过10个字', icon: 'none' })
      return null
    }

    const trimmedSubjects = subjects.map(s => String(s).trim()).filter(Boolean)
    if (trimmedSubjects.length === 0) {
      wx.showToast({ title: '至少需要1个板块', icon: 'none' })
      return null
    }
    if (trimmedSubjects.some(s => s.length > 10)) {
      wx.showToast({ title: '板块名称不能超过10个字', icon: 'none' })
      return null
    }
    if (new Set(trimmedSubjects).size !== trimmedSubjects.length) {
      wx.showToast({ title: '板块名称不能重复', icon: 'none' })
      return null
    }

    return { name, subjects: trimmedSubjects }
  },

  async onSave() {
    if (this.data.saving) return

    const form = this.validateForm()
    if (!form) return

    const hasNetwork = await checkNetwork()
    if (!hasNetwork) {
      wx.showToast({
        title: '当前无网络，请连接网络后重试',
        icon: 'none',
        duration: 2500
      })
      return
    }

    this.setData({ saving: true })

    try {
      const { editingPlanId } = this.data
      let res

      if (editingPlanId) {
        res = await partner.updatePlan(editingPlanId, form.name, form.subjects)
      } else {
        res = await partner.createPlan(form.name, form.subjects)
      }

      if (res.code !== 0) {
        throw new Error(res.msg || '保存失败')
      }

      wx.showToast({
        title: editingPlanId ? '修改成功' : '创建成功',
        icon: 'success'
      })

      clearPlanCaches()
      this.setData({ modalVisible: false, saving: false })
      this.loadPlans()
    } catch (err) {
      console.error('[plans] 保存计划失败', err)
      this.setData({ saving: false })
      wx.showToast({
        title: err.message || '网络异常，请检查网络后重试',
        icon: 'none',
        duration: 2500
      })
    }
  },

  onDelete(e) {
    const { plan } = e.currentTarget.dataset

    wx.showModal({
      title: '删除计划',
      content: `删除后，"${plan.name}" 计划下的所有打卡记录将无法查看，确定删除吗？`,
      confirmColor: '#ff3b30',
      success: async (res) => {
        if (!res.confirm) return

        try {
          const deleteRes = await partner.deletePlan(plan._id)
          if (deleteRes.code !== 0) {
            throw new Error(deleteRes.msg || '删除失败')
          }
          wx.showToast({ title: '删除成功', icon: 'success' })
          clearPlanCaches()
          this.loadPlans()
        } catch (err) {
          console.error('[plans] 删除计划失败', err)
          wx.showToast({
            title: err.message || '删除失败',
            icon: 'none',
            duration: 2500
          })
        }
      }
    })
  }
})
