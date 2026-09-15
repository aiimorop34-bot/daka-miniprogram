const storage = require('../../utils/storage')
const evaluate = require('../../utils/evaluate')
const partner = require('../../utils/partner')
const syncQueue = require('../../utils/syncQueue')

const CHECKIN_PLAN_CACHE_PREFIX = 'checkin_plan_cache_'

function getPlanCacheKey(planId) {
  return `${CHECKIN_PLAN_CACHE_PREFIX}${planId}`
}

function getPlanCache(planId) {
  if (!planId) return null
  try {
    const cached = wx.getStorageSync(getPlanCacheKey(planId))
    if (cached && Array.isArray(cached.subjects) && cached.subjects.length > 0) {
      return cached
    }
  } catch (e) {
    console.error('[checkin] 读取计划缓存失败', planId, e)
  }
  return null
}

function setPlanCache(planId, plan) {
  if (!planId || !plan) return
  try {
    wx.setStorageSync(getPlanCacheKey(planId), {
      _id: planId,
      name: plan.name || '',
      subjects: plan.subjects || [],
      cachedAt: Date.now()
    })
  } catch (e) {
    console.error('[checkin] 写入计划缓存失败', planId, e)
  }
}

Page({
  data: {
    planId: '',
    planName: '',
    subjects: [],
    hasSelected: false,
    saving: false,
    showEvaluation: false,
    showReminderButton: false,
    evalEmoji: '',
    evalText: '',
    pendingCount: 0,
    failedCount: 0,
    numberOptions: []
  },

  onShow() {
    this.setData({
      pendingCount: syncQueue.getPendingCount(),
      failedCount: syncQueue.getFailedCount()
    })
  },

  async onSyncIndicatorTap() {
    const action = await syncQueue.showFailedRecordsModal()
    if (action === 'retry' || action === 'abandon') {
      if (action === 'abandon') {
        storage.clearOptimisticCaches()
      }
      this.setData({
        pendingCount: syncQueue.getPendingCount(),
        failedCount: syncQueue.getFailedCount()
      })
      if (action === 'retry') {
        const app = getApp()
        if (app && app.processPendingQueue) {
          app.processPendingQueue()
        }
      }
    }
  },

  async onLoad(options) {
    const numberOptions = []
    for (let i = 0; i <= 300; i += 5) {
      numberOptions.push(i)
    }
    this.setData({ numberOptions })

    const planId = options.planId || ''
    this.setData({ planId })
    await this.loadPlan(planId)
  },

  async loadPlan(planId) {
    const cachedPlan = getPlanCache(planId)

    // 1. 缓存优先：如果有缓存，立即渲染，不等待云端
    if (cachedPlan) {
      this.setData({
        planId,
        planName: cachedPlan.name,
        subjects: this.buildSubjects(cachedPlan.subjects)
      })
    }

    // 2. 后台请求云端，返回后静默刷新，保留用户已填内容
    try {
      const res = await partner.getPlans()
      if (res.code !== 0) {
        throw new Error(res.msg || '获取计划失败')
      }

      const plans = res.plans || []
      if (plans.length === 0) {
        if (!cachedPlan) {
          throw new Error('没有可用的打卡计划')
        }
        return
      }

      let plan = plans.find(p => p._id === planId)
      if (!plan) {
        plan = plans.find(p => p.isDefault) || plans[0]
      }

      // 更新缓存
      setPlanCache(plan._id, plan)

      // 合并云端板块与当前用户输入，保留已填数字
      const subjects = this.mergeSubjects(plan.subjects || [], this.data.subjects)

      this.setData({
        planId: plan._id,
        planName: plan.name,
        subjects
      })
    } catch (err) {
      console.error('[checkin] 加载计划失败', err)
      // 如果缓存已成功渲染，就不打扰用户；只有无缓存且失败时才提示
      if (!cachedPlan) {
        wx.showToast({
          title: err.message || '加载计划失败',
          icon: 'none',
          duration: 2500
        })
      }
    }
  },

  buildSubjects(subjects) {
    return (subjects || []).map((s, index) => ({
      label: s.name,
      name: s.name,
      total: 0,
      correct: 0,
      selected: false,
      accuracy: 0,
      accuracyClass: '',
      index
    }))
  },

  mergeSubjects(cloudSubjects, currentSubjects) {
    if (!cloudSubjects || cloudSubjects.length === 0) {
      return currentSubjects.length > 0 ? currentSubjects : []
    }

    const currentMap = {}
    currentSubjects.forEach(s => {
      currentMap[s.name] = s
    })

    return cloudSubjects.map((s, index) => {
      const existing = currentMap[s.name]
      if (existing) {
        // 保留用户已填的 total/correct/selected/accuracy，只更新 label/name/index
        return {
          ...existing,
          label: s.name,
          name: s.name,
          index
        }
      }
      return {
        label: s.name,
        name: s.name,
        total: 0,
        correct: 0,
        selected: false,
        accuracy: 0,
        accuracyClass: '',
        index
      }
    })
  },

  onToggleSubject(e) {
    const index = e.currentTarget.dataset.index
    const subjects = this.data.subjects
    subjects[index].selected = !subjects[index].selected

    this.updateSubject(subjects, index)
  },

  onTotalInput(e) {
    const index = e.currentTarget.dataset.index
    const subjects = this.data.subjects
    subjects[index].total = parseInt(e.detail.value) || 0
    this.updateSubject(subjects, index)
  },

  onCorrectInput(e) {
    const index = e.currentTarget.dataset.index
    const subjects = this.data.subjects
    subjects[index].correct = parseInt(e.detail.value) || 0
    this.updateSubject(subjects, index)
  },

  onPickerChange(e) {
    const index = e.currentTarget.dataset.index
    const field = e.currentTarget.dataset.field
    const selectedIndex = e.detail.value
    const value = this.data.numberOptions[selectedIndex]

    const subjects = this.data.subjects
    subjects[index][field] = value
    this.updateSubject(subjects, index)
  },

  updateSubject(subjects, index) {
    const s = subjects[index]
    const total = s.total || 0
    const correct = s.correct || 0
    if (total > 0) {
      s.accuracy = Math.round((correct / total) * 100)
      if (s.accuracy >= 80) s.accuracyClass = 'high'
      else if (s.accuracy >= 60) s.accuracyClass = 'mid'
      else s.accuracyClass = 'low'
    } else {
      s.accuracy = 0
      s.accuracyClass = ''
    }

    const hasSelected = subjects.some(item => item.selected)
    this.setData({ subjects, hasSelected })
  },

  async onSave() {
    if (this.data.saving) return

    const selectedSubjects = this.data.subjects.filter(s => s.selected)
    if (selectedSubjects.length === 0) {
      wx.showToast({ title: '请至少选择一个板块', icon: 'none' })
      return
    }

    const activeSubjects = selectedSubjects.map(s => ({
      name: s.name,
      total: Number(s.total) || 0,
      correct: Number(s.correct) || 0
    }))

    const invalid = activeSubjects.some(s => s.correct > s.total)
    if (invalid) {
      wx.showToast({ title: '正确数不能大于总题数', icon: 'none' })
      return
    }

    this.setData({ saving: true })

    try {
      const record = {
        id: Date.now().toString(),
        date: storage.formatDate(new Date()),
        timestamp: Date.now(),
        planId: this.data.planId,
        subjects: activeSubjects
      }

      // 乐观保存：立即返回本地结果并更新缓存，后台异步同步云端
      const saveRes = await storage.saveRecordOptimistic(record)

      const todayRecord = saveRes.todayRecord || null
      const historyStats = saveRes.historyStats || null
      const evaluation = evaluate.saveEvaluationToday(todayRecord, [], this.data.planId, historyStats)

      this.setData({
        saving: false,
        showEvaluation: true,
        showReminderButton: !storage.getReminderPromptShown(),
        evalEmoji: evaluation.emoji || '🎉',
        evalText: evaluation.text || '打卡成功！继续保持！',
        pendingCount: syncQueue.getPendingCount(),
        failedCount: syncQueue.getFailedCount()
      })
    } catch (err) {
      // 乐观保存正常情况下不会抛错（失败仅标记为待同步），
      // 但如果出现本地异常（缓存写入失败等），仍给出提示。
      console.error('[checkin] 保存失败', err)
      this.setData({ saving: false })
      wx.showToast({
        title: '保存失败，请检查存储空间后重试',
        icon: 'none',
        duration: 2500
      })
    }
  },

  onEvalClose() {
    this.setData({ showEvaluation: false })
    wx.switchTab({ url: '/pages/data/data' })
  },

  async onEnableReminder() {
    try {
      const res = await partner.requestReminderSubscription()
      console.log('[checkin] 订阅消息结果', res)
      if (res && res[partner.getReminderTemplateId()] === 'accept') {
        await partner.saveReminderSubscription({
          remindDate: storage.formatDate(new Date()),
          isSubscribed: true
        })
      }
    } catch (err) {
      console.error('[checkin] 订阅提醒失败', err)
    } finally {
      storage.setReminderPromptShown(true)
      this.setData({ showReminderButton: false })
    }
  }
})
