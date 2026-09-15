const partner = require('../../utils/partner')
const evaluate = require('../../utils/evaluate')
const storage = require('../../utils/storage')
const syncQueue = require('../../utils/syncQueue')
const { createShareConfig } = require('../../utils/share')

const CACHE_KEY = 'index_page_plans'

function getCache() {
  try {
    return wx.getStorageSync(CACHE_KEY)
  } catch (e) {
    return null
  }
}

function setCache(value) {
  try {
    wx.setStorageSync(CACHE_KEY, value)
  } catch (e) {
    console.error('[index] 缓存失败', e)
  }
}

Page({
  ...createShareConfig({
    title: '刷题打卡 - 保持节奏，每天进步',
    timelineTitle: '来和我一起刷题打卡',
    path: '/pages/index/index'
  }),

  data: {
    plans: [],
    loading: true,
    errorMsg: '',
    pendingCount: 0,
    failedCount: 0,
    calendarState: {}
  },

  onShow() {
    this.setData({
      pendingCount: syncQueue.getPendingCount(),
      failedCount: syncQueue.getFailedCount()
    })
    this.loadData()

    // 刷新已展开的月历，确保本地待同步记录能及时体现
    const calendarState = this.data.calendarState || {}
    Object.keys(calendarState).forEach(planId => {
      const state = calendarState[planId]
      if (state.expanded && state.year && state.month) {
        this.loadMonthCalendar(planId, state.year, state.month)
      }
    })
  },

  async onPullDownRefresh() {
    try {
      await this.loadData()
    } finally {
      wx.stopPullDownRefresh()
    }
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
      // 重新加载数据，确保页面状态与队列一致
      this.loadData()
    }
  },

  async loadData() {
    const cached = getCache()
    if (cached && cached.length > 0) {
      this.setData({ plans: cached, loading: false, errorMsg: '' })
    } else {
      this.setData({ loading: true, errorMsg: '' })
    }

    try {
      const plansRes = await partner.getPlans()
      if (plansRes.code !== 0) {
        throw new Error(plansRes.msg || '获取计划列表失败')
      }

      const plans = plansRes.plans || []
      if (plans.length === 0) {
        this.setData({ plans: [], loading: false })
        setCache([])
        return
      }

      const planIds = plans.map(p => p._id)
      const statsRes = await partner.getCheckinStatsForPlans(planIds)
      if (statsRes.code !== 0) {
        throw new Error(statsRes.msg || '获取打卡统计失败')
      }

      const statsMap = statsRes.stats || {}
      const today = storage.formatDate(new Date())

      const planCards = plans.map(plan => {
        const stats = statsMap[plan._id] || {}
        const todayRecord = stats.todayRecord || null
        const checkedInToday = !!(todayRecord && todayRecord.subjects && todayRecord.subjects.length > 0)

        let evaluation = null
        if (checkedInToday) {
          evaluation = evaluate.getEvaluationToday(todayRecord, [], plan._id, stats.historyStats)
        }

        return {
          ...plan,
          streak: stats.streak || 0,
          weekCount: stats.weekCount || 0,
          totalDays: stats.totalDays || 0,
          totalRecords: stats.totalRecords || 0,
          totalQuestions: stats.totalQuestions || 0,
          totalCorrect: stats.totalCorrect || 0,
          avgAccuracy: stats.avgAccuracy || 0,
          avgVolume: stats.avgVolume || 0,
          checkedInDates: stats.checkedInDates || [],
          subjectStats: stats.subjectStats || {},
          todayRecord,
          checkedInToday,
          todaySummary: storage.buildTodaySummary(todayRecord),
          evaluation
        }
      })

      // 合并本地待同步记录，避免云端尚未同步时覆盖乐观数据
      const mergedPlanCards = this.mergePendingIntoPlanCards(planCards)

      // 云端同步延迟保护：若云端未返回今日记录但本地缓存有今日记录，则保留本地状态
      const protectedPlanCards = this.protectTodayRecord(mergedPlanCards)

      // 排序：默认计划排最前，其余按创建时间倒序
      protectedPlanCards.sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1
        if (!a.isDefault && b.isDefault) return 1
        return (b.createdAt || 0) - (a.createdAt || 0)
      })

      this.setData({
        plans: protectedPlanCards,
        loading: false,
        errorMsg: ''
      })
      setCache(protectedPlanCards)
    } catch (err) {
      console.error('[index] 加载首页数据失败', err)
      const detail = err.message || err.errMsg || String(err)
      const hasCache = this.data.plans && this.data.plans.length > 0
      this.setData({
        loading: false,
        errorMsg: hasCache ? '' : '加载失败：' + detail
      })
      if (!hasCache) {
        wx.showToast({
          title: '加载失败，请查看控制台日志',
          icon: 'none',
          duration: 3000
        })
      }
    }
  },

  // 保护今日记录不因云端读取延迟而回退为"未打卡"
  protectTodayRecord(planCards) {
    const cached = getCache() || []
    const cachedMap = {}
    cached.forEach(p => { cachedMap[p._id] = p })

    const today = storage.formatDate(new Date())
    return planCards.map(card => {
      if (card.todayRecord && card.todayRecord.date === today) return card

      const cachedCard = cachedMap[card._id]
      if (cachedCard && cachedCard.todayRecord && cachedCard.todayRecord.date === today) {
        const todayRecord = cachedCard.todayRecord
        const historyStats = {
          totalRecords: card.totalRecords,
          totalQuestions: card.totalQuestions,
          totalCorrect: card.totalCorrect,
          checkedInDates: card.checkedInDates,
          subjectStats: card.subjectStats
        }
        return {
          ...card,
          todayRecord,
          checkedInToday: true,
          todaySummary: storage.buildTodaySummary(todayRecord),
          evaluation: evaluate.getEvaluationToday(todayRecord, [], card._id, historyStats)
        }
      }
      return card
    })
  },

  mergePendingIntoPlanCards(planCards) {
    const pendingMap = {}
    const localItems = [
      ...syncQueue.getPendingItems(),
      ...syncQueue.getSyncingItems()
    ]
    localItems.forEach(item => {
      const planId = item.record.planId
      if (!pendingMap[planId]) pendingMap[planId] = []
      pendingMap[planId].push(item.record)
    })

    if (Object.keys(pendingMap).length === 0) return planCards

    return planCards.map(card => {
      const pendingRecords = pendingMap[card._id]
      if (!pendingRecords || pendingRecords.length === 0) return card

      const baseStats = {
        streak: card.streak || 0,
        weekCount: card.weekCount || 0,
        totalDays: card.totalDays || 0,
        totalRecords: card.totalRecords || 0,
        totalQuestions: card.totalQuestions || 0,
        totalCorrect: card.totalCorrect || 0,
        avgAccuracy: card.avgAccuracy || 0,
        avgVolume: card.avgVolume || 0,
        checkedInDates: card.checkedInDates || [],
        subjectStats: card.subjectStats || {}
      }

      const stats = storage.applyRecordsToStats(baseStats, pendingRecords)

      const today = storage.formatDate(new Date())
      const todayPending = pendingRecords.filter(r => r.date === today)
      const todayRecord = todayPending.length > 0
        ? storage.mergeTodayRecords([...(card.todayRecord ? [card.todayRecord] : []), ...todayPending])
        : card.todayRecord

      const historyStats = {
        totalRecords: stats.totalRecords,
        totalQuestions: stats.totalQuestions,
        totalCorrect: stats.totalCorrect,
        checkedInDates: stats.checkedInDates,
        subjectStats: stats.subjectStats
      }

      const checkedInToday = !!(todayRecord && todayRecord.subjects && todayRecord.subjects.length > 0)
      const evaluation = checkedInToday
        ? evaluate.getEvaluationToday(todayRecord, [], card._id, historyStats)
        : card.evaluation

      return {
        ...card,
        streak: stats.streak,
        weekCount: stats.weekCount,
        totalDays: stats.totalDays,
        totalRecords: stats.totalRecords,
        totalQuestions: stats.totalQuestions,
        totalCorrect: stats.totalCorrect,
        avgAccuracy: stats.avgAccuracy,
        avgVolume: stats.avgVolume,
        checkedInDates: stats.checkedInDates,
        subjectStats: stats.subjectStats,
        todayRecord,
        checkedInToday,
        todaySummary: storage.buildTodaySummary(todayRecord),
        evaluation
      }
    })
  },

  getCurrentMonthInfo() {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    return {
      year,
      month,
      monthText: `${year}年${month}月`
    }
  },

  compareYearMonth(a, b) {
    if (a.year !== b.year) return a.year - b.year
    return a.month - b.month
  },

  getMonthCacheKey(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`
  },

  buildCalendarDays(dailyTotals, year, month) {
    const firstDayWeek = new Date(year, month - 1, 1).getDay()
    const mondayOffset = (firstDayWeek + 6) % 7
    const daysInMonth = new Date(year, month, 0).getDate()
    const totalCells = Math.ceil((mondayOffset + daysInMonth) / 7) * 7
    const todayStr = storage.formatDate(new Date())

    const days = []
    for (let i = 0; i < totalCells; i++) {
      const dayIndex = i - mondayOffset
      if (dayIndex < 0 || dayIndex >= daysInMonth) {
        days.push({ day: null, questions: '', isFuture: false, date: '' })
        continue
      }

      const day = dayIndex + 1
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const questions = dailyTotals[dateStr] || 0
      const isFuture = dateStr > todayStr

      days.push({
        day,
        date: dateStr,
        questions: (!isFuture && questions > 0) ? String(questions) : '',
        isFuture
      })
    }

    return days
  },

  mergePendingIntoCalendar(dailyTotals, planId, year, month) {
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
    const localItems = [
      ...syncQueue.getPendingItems(),
      ...syncQueue.getSyncingItems()
    ]
    const pendingItems = localItems.filter(item => {
      const record = item && item.record
      return record && record.planId === planId && record.date && record.date.startsWith(monthPrefix)
    })

    pendingItems.forEach(item => {
      const record = item.record
      let total = 0
      ;(record.subjects || []).forEach(s => {
        total += Number(s.total) || 0
      })
      if (total > 0) {
        dailyTotals[record.date] = (dailyTotals[record.date] || 0) + total
      }
    })

    return dailyTotals
  },

  computeNavigationState(state) {
    const current = this.getCurrentMonthInfo()
    const yearMonth = { year: state.year || current.year, month: state.month || current.month }
    const earliestDate = state.earliestDate || null

    let minYearMonth = null
    if (earliestDate) {
      const parts = earliestDate.split('-')
      minYearMonth = { year: Number(parts[0]), month: Number(parts[1]) }
    }

    const prevDisabled = !minYearMonth || this.compareYearMonth(yearMonth, minYearMonth) <= 0
    const nextDisabled = this.compareYearMonth(yearMonth, current) >= 0

    return { prevDisabled, nextDisabled }
  },

  getCalendarNavigationState(planId) {
    return this.computeNavigationState(this.data.calendarState[planId] || {})
  },

  async loadMonthCalendar(planId, targetYear, targetMonth) {
    const year = Number(targetYear)
    const month = Number(targetMonth)
    const cacheKey = this.getMonthCacheKey(year, month)
    const prevState = this.data.calendarState[planId] || {}
    const cache = prevState.cache || {}
    const current = this.getCurrentMonthInfo()
    const isCurrentMonth = year === current.year && month === current.month

    this.setData({
      [`calendarState.${planId}`]: {
        ...prevState,
        expanded: true,
        year,
        month,
        monthText: `${year}年${month}月`,
        loading: true,
        error: ''
      }
    })

    // 命中本地缓存：直接复用，不再请求云端（当前月不缓存，避免打卡后返回 stale）
    if (cache[cacheKey] && !isCurrentMonth) {
      const dailyTotals = { ...(cache[cacheKey].dailyTotals || {}) }
      const mergedTotals = this.mergePendingIntoCalendar(dailyTotals, planId, year, month)
      const days = this.buildCalendarDays(mergedTotals, year, month)
      const nav = this.computeNavigationState({ ...prevState, year, month })
      this.setData({
        [`calendarState.${planId}`]: {
          ...prevState,
          expanded: true,
          year,
          month,
          monthText: `${year}年${month}月`,
          loading: false,
          loaded: true,
          error: '',
          days,
          prevDisabled: nav.prevDisabled,
          nextDisabled: nav.nextDisabled,
          cache
        }
      })
      return
    }

    try {
      const res = await partner.getMonthDailyTotals(planId, year, month)
      if (res.code !== 0) {
        throw new Error(res.msg || '获取月历数据失败')
      }

      const dailyTotals = res.dailyTotals || {}
      const mergedTotals = this.mergePendingIntoCalendar(dailyTotals, planId, year, month)
      const days = this.buildCalendarDays(mergedTotals, year, month)
      const earliestDate = res.earliestDate || prevState.earliestDate || null
      const nav = this.computeNavigationState({ ...prevState, year, month, earliestDate })

      this.setData({
        [`calendarState.${planId}`]: {
          ...prevState,
          expanded: true,
          year,
          month,
          monthText: `${year}年${month}月`,
          loading: false,
          loaded: true,
          error: '',
          days,
          earliestDate,
          prevDisabled: nav.prevDisabled,
          nextDisabled: nav.nextDisabled,
          cache: isCurrentMonth ? cache : {
            ...cache,
            [cacheKey]: { dailyTotals }
          }
        }
      })
    } catch (err) {
      console.error('[index] 加载月历失败', err)
      this.setData({
        [`calendarState.${planId}`]: {
          ...prevState,
          expanded: true,
          year,
          month,
          monthText: `${year}年${month}月`,
          loading: false,
          loaded: false,
          error: err.message || '加载失败',
          cache
        }
      })
    }
  },

  toggleCalendar(e) {
    const planId = e.currentTarget.dataset.planId
    const state = this.data.calendarState[planId] || {}

    if (state.expanded) {
      this.setData({
        [`calendarState.${planId}.expanded`]: false
      })
      return
    }

    // 展开时恢复到上次浏览的年月；首次展开则默认当前月
    if (state.year && state.month) {
      this.loadMonthCalendar(planId, state.year, state.month)
    } else {
      const current = this.getCurrentMonthInfo()
      this.loadMonthCalendar(planId, current.year, current.month)
    }
  },

  goToPrevMonth(e) {
    const planId = e.currentTarget.dataset.planId
    const state = this.data.calendarState[planId] || {}
    const { prevDisabled } = this.getCalendarNavigationState(planId)

    if (state.loading || prevDisabled) return

    let year = Number(state.year)
    let month = Number(state.month) - 1
    if (month < 1) {
      month = 12
      year--
    }
    this.loadMonthCalendar(planId, year, month)
  },

  goToNextMonth(e) {
    const planId = e.currentTarget.dataset.planId
    const state = this.data.calendarState[planId] || {}
    const { nextDisabled } = this.getCalendarNavigationState(planId)

    if (state.loading || nextDisabled) return

    let year = Number(state.year)
    let month = Number(state.month) + 1
    if (month > 12) {
      month = 1
      year++
    }
    this.loadMonthCalendar(planId, year, month)
  },

  onCheckin(e) {
    const planId = e.currentTarget.dataset.planId
    wx.navigateTo({
      url: `/pages/checkin/checkin?planId=${planId}`
    })
  },

  onViewData(e) {
    const planId = e.currentTarget.dataset.planId
    const app = getApp()
    app.globalData.dataPlanId = planId
    wx.switchTab({
      url: '/pages/data/data'
    })
  },

  onGoToPlans() {
    wx.navigateTo({
      url: '/pages/plans/plans'
    })
  },

  onCreatePlan() {
    wx.navigateTo({
      url: '/pages/plans/plans?action=create'
    })
  }
})
