const partner = require('./partner')
const syncQueue = require('./syncQueue')

// 内存中保存当前计划 ID（不写入本地缓存，启动时从云端获取）
let currentPlanId = ''

const REMINDER_PROMPT_KEY = 'reminder_prompt_shown'

function setCurrentPlanId(planId) {
  currentPlanId = planId || ''
}

function getCurrentPlanId() {
  return currentPlanId
}

// 确保存在当前计划 ID；内存中没有时，主动调用 ensureDefaultPlan 云函数获取
async function ensurePlanId() {
  if (currentPlanId) return currentPlanId

  const app = getApp()
  if (app.globalData.currentPlanId) {
    currentPlanId = app.globalData.currentPlanId
    return currentPlanId
  }

  const res = await wx.cloud.callFunction({ name: 'ensureDefaultPlan' })
  const result = res.result || {}
  if (result.code !== 0 || !result.planId) {
    throw new Error('获取默认计划失败：' + (result.msg || JSON.stringify(result)))
  }

  currentPlanId = result.planId
  app.globalData.currentPlanId = currentPlanId
  return currentPlanId
}

// ==================== 打卡记录：全部走云数据库 checkins 集合 ====================

async function getRecords() {
  const planId = await ensurePlanId()
  const res = await partner.getCheckins(planId)
  if (res.code !== 0) throw new Error(res.msg || '获取云端记录失败')
  return res.records || []
}

async function saveRecord(record) {
  if (!record.planId) {
    record.planId = await ensurePlanId()
  }
  const res = await partner.saveCheckin(record)
  if (res.code !== 0) throw new Error(res.msg || '保存打卡记录失败')
  return res
}

async function getTodayRecord() {
  const res = await partner.getCheckinStats(await ensurePlanId())
  if (res.code !== 0) throw new Error(res.msg || '获取今日记录失败')
  return res.todayRecord || null
}

async function getStreak() {
  const res = await partner.getCheckinStats(await ensurePlanId())
  if (res.code !== 0) throw new Error(res.msg || '获取连续天数失败')
  return res.streak || 0
}

async function getWeekCount() {
  const res = await partner.getCheckinStats(await ensurePlanId())
  if (res.code !== 0) throw new Error(res.msg || '获取周打卡数失败')
  return res.weekCount || 0
}

async function getTotalDays() {
  const res = await partner.getCheckinStats(await ensurePlanId())
  if (res.code !== 0) throw new Error(res.msg || '获取累计天数失败')
  return res.totalDays || 0
}

// 一次性拉取首页所需的全部统计数据，减少请求次数
async function loadStats() {
  const res = await partner.getCheckinStats(await ensurePlanId())
  if (res.code !== 0) throw new Error(res.msg || '获取统计数据失败')
  return {
    streak: res.streak || 0,
    weekCount: res.weekCount || 0,
    totalDays: res.totalDays || 0,
    todayRecord: res.todayRecord || null,
    totalRecords: res.totalRecords || 0
  }
}

// ==================== 纯工具函数（不依赖存储） ====================

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDateDisplay(dateStr) {
  const today = formatDate(new Date())
  if (dateStr === today) return '今天'
  return dateStr.replace(/-/g, '/')
}

function calcAccuracy(subjects) {
  if (!subjects || subjects.length === 0) return 0
  const total = subjects.reduce((sum, s) => sum + (s.total || 0), 0)
  const correct = subjects.reduce((sum, s) => sum + (s.correct || 0), 0)
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

// ==================== 提醒弹窗标记（非打卡记录，保留本地） ====================

function getReminderPromptShown() {
  return wx.getStorageSync(REMINDER_PROMPT_KEY) || false
}

function setReminderPromptShown(shown) {
  wx.setStorageSync(REMINDER_PROMPT_KEY, shown)
}

// ==================== 乐观更新工具函数 ====================

function getMonday(date) {
  const d = new Date(date)
  const day = d.getDay() || 7
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - day + 1)
  return d
}

function clone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj))
  } catch (e) {
    return obj
  }
}

function calcSingleAccuracy(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

function buildTodaySummary(todayRecord) {
  if (!todayRecord || !todayRecord.subjects || todayRecord.subjects.length === 0) {
    return ''
  }
  const total = todayRecord.subjects.reduce((sum, s) => sum + (s.total || 0), 0)
  const correct = todayRecord.subjects.reduce((sum, s) => sum + (s.correct || 0), 0)
  const accuracy = calcSingleAccuracy(correct, total)
  return `今天 ${todayRecord.subjects.length}个板块 · ${total}题 · 正确率${accuracy}%`
}

function mergeTodayRecords(records) {
  const merged = {
    date: records[0].date,
    subjects: []
  }
  const map = {}
  records.forEach(r => {
    r.subjects.forEach(s => {
      if (!map[s.name]) {
        map[s.name] = { name: s.name, total: 0, correct: 0 }
      }
      map[s.name].total += Number(s.total || 0)
      map[s.name].correct += Number(s.correct || 0)
    })
  })
  merged.subjects = Object.values(map).map(s => ({
    ...s,
    accuracy: calcSingleAccuracy(s.correct, s.total)
  }))
  return merged
}

function applyRecordsToStats(baseStats, records) {
  const stats = {
    streak: baseStats.streak || 0,
    weekCount: baseStats.weekCount || 0,
    totalDays: baseStats.totalDays || 0,
    totalRecords: baseStats.totalRecords || 0,
    totalQuestions: baseStats.totalQuestions || 0,
    totalCorrect: baseStats.totalCorrect || 0,
    avgAccuracy: baseStats.avgAccuracy || 0,
    avgVolume: baseStats.avgVolume || 0,
    checkedInDates: Array.isArray(baseStats.checkedInDates) ? [...baseStats.checkedInDates] : [],
    subjectStats: baseStats.subjectStats ? clone(baseStats.subjectStats) : {}
  }

  records.forEach(record => {
    let recordTotal = 0
    let recordCorrect = 0
    record.subjects.forEach(s => {
      recordTotal += Number(s.total || 0)
      recordCorrect += Number(s.correct || 0)
    })

    const isNewDay = !stats.checkedInDates.includes(record.date)
    if (isNewDay) {
      stats.checkedInDates.push(record.date)
    }

    stats.totalRecords += 1
    stats.totalQuestions += recordTotal
    stats.totalCorrect += recordCorrect

    record.subjects.forEach(s => {
      const existing = stats.subjectStats[s.name] || { count: 0, total: 0, correct: 0, avgAccuracy: 0 }
      existing.count += 1
      existing.total += Number(s.total || 0)
      existing.correct += Number(s.correct || 0)
      existing.avgAccuracy = calcSingleAccuracy(existing.correct, existing.total)
      stats.subjectStats[s.name] = existing
    })
  })

  stats.avgAccuracy = calcSingleAccuracy(stats.totalCorrect, stats.totalQuestions)
  stats.avgVolume = stats.totalRecords > 0 ? Math.round(stats.totalQuestions / stats.totalRecords) : 0
  stats.totalDays = stats.checkedInDates.length

  // 连续天数
  const evaluate = require('./evaluate')
  stats.streak = evaluate.calcStreak([], stats.checkedInDates)

  // 本周打卡数
  const monday = getMonday(new Date())
  stats.weekCount = stats.checkedInDates.filter(d => new Date(d) >= monday).length

  return stats
}

function computeOptimisticResult(record) {
  let cachedPlans = []
  try {
    cachedPlans = wx.getStorageSync('index_page_plans') || []
  } catch (e) {}

  const planCard = cachedPlans.find(p => p._id === record.planId)
  const baseStats = planCard || {
    streak: 0,
    weekCount: 0,
    totalDays: 0,
    totalRecords: 0,
    totalQuestions: 0,
    totalCorrect: 0,
    avgAccuracy: 0,
    avgVolume: 0,
    checkedInDates: [],
    subjectStats: {}
  }

  // 优先基于缓存做增量计算；若缓存不存在，则回退到用全部待同步记录计算
  const hasValidCache = !!(planCard && Array.isArray(planCard.checkedInDates))
  let recordsToApply = [record]
  if (!hasValidCache) {
    const pending = syncQueue.getPendingItems().map(item => item.record)
    recordsToApply = pending.filter(r => r.planId === record.planId)
  }

  const stats = applyRecordsToStats(baseStats, recordsToApply)

  // 今日记录：合并缓存里已有的今日记录和当前待同步记录
  const today = formatDate(new Date())
  const todayPending = syncQueue.getPendingItems()
    .map(item => item.record)
    .filter(r => r.planId === record.planId && r.date === today)
  const cachedTodayRecord = (planCard && planCard.todayRecord && planCard.todayRecord.date === today)
    ? [planCard.todayRecord]
    : []
  const todayRecord = (cachedTodayRecord.length > 0 || todayPending.length > 0)
    ? mergeTodayRecords([...cachedTodayRecord, ...todayPending])
    : null

  const historyStats = {
    totalRecords: stats.totalRecords,
    totalQuestions: stats.totalQuestions,
    totalCorrect: stats.totalCorrect,
    checkedInDates: stats.checkedInDates,
    subjectStats: stats.subjectStats
  }

  return {
    todayRecord,
    historyStats,
    stats
  }
}

function updateIndexCacheOptimistically(record, stats, todayRecord) {
  let cached = []
  try {
    cached = wx.getStorageSync('index_page_plans') || []
  } catch (e) {}

  const idx = cached.findIndex(p => p._id === record.planId)
  if (idx < 0) return

  const planCard = clone(cached[idx])
  planCard.streak = stats.streak
  planCard.weekCount = stats.weekCount
  planCard.totalDays = stats.totalDays
  planCard.totalRecords = stats.totalRecords
  planCard.totalQuestions = stats.totalQuestions
  planCard.totalCorrect = stats.totalCorrect
  planCard.avgAccuracy = stats.avgAccuracy
  planCard.avgVolume = stats.avgVolume
  planCard.checkedInDates = stats.checkedInDates
  planCard.subjectStats = stats.subjectStats
  planCard.todayRecord = todayRecord
  planCard.checkedInToday = !!(todayRecord && todayRecord.subjects && todayRecord.subjects.length > 0)
  planCard.todaySummary = buildTodaySummary(todayRecord)

  const evaluate = require('./evaluate')
  const historyStats = {
    totalRecords: stats.totalRecords,
    totalQuestions: stats.totalQuestions,
    totalCorrect: stats.totalCorrect,
    checkedInDates: stats.checkedInDates,
    subjectStats: stats.subjectStats
  }
  // 乐观更新时也要根据合并后的今日数据重新生成评语，避免沿用旧缓存
  planCard.evaluation = evaluate.saveEvaluationToday(todayRecord, [], record.planId, historyStats)

  cached[idx] = planCard
  try {
    wx.setStorageSync('index_page_plans', cached)
  } catch (e) {}
}

function updateDataCacheOptimistically(record) {
  const cacheKey = `data_page_records_${record.planId}`
  let records = []
  try {
    records = wx.getStorageSync(cacheKey) || []
  } catch (e) {}

  records.unshift({
    _id: record.id,
    id: record.id,
    date: record.date,
    timestamp: record.timestamp,
    planId: record.planId,
    subjects: record.subjects.map(s => ({
      name: s.name,
      total: Number(s.total || 0),
      correct: Number(s.correct || 0),
      accuracy: calcSingleAccuracy(Number(s.correct || 0), Number(s.total || 0))
    }))
  })

  try {
    wx.setStorageSync(cacheKey, records)
  } catch (e) {}
}

function updateCachesWithRealResult(planId, saveRes) {
  let cached = []
  try {
    cached = wx.getStorageSync('index_page_plans') || []
  } catch (e) {}

  const idx = cached.findIndex(p => p._id === planId)
  if (idx >= 0) {
    const planCard = clone(cached[idx])
    const stats = saveRes.stats || {}
    const historyStats = saveRes.historyStats || {}

    planCard.streak = stats.streak
    planCard.weekCount = stats.weekCount
    planCard.totalDays = stats.totalDays
    planCard.totalRecords = stats.totalRecords
    planCard.totalQuestions = stats.totalQuestions
    planCard.totalCorrect = stats.totalCorrect
    planCard.avgAccuracy = stats.avgAccuracy
    planCard.avgVolume = stats.avgVolume
    planCard.checkedInDates = historyStats.checkedInDates
    planCard.subjectStats = historyStats.subjectStats
    planCard.todayRecord = saveRes.todayRecord
    planCard.checkedInToday = !!(saveRes.todayRecord && saveRes.todayRecord.subjects && saveRes.todayRecord.subjects.length > 0)
    planCard.todaySummary = buildTodaySummary(saveRes.todayRecord)

    const evaluate = require('./evaluate')
    // 云端同步完成后必须用完整准确的今日数据重新生成评语并覆盖旧缓存
    planCard.evaluation = evaluate.saveEvaluationToday(saveRes.todayRecord, [], planId, historyStats)

    cached[idx] = planCard
    try {
      wx.setStorageSync('index_page_plans', cached)
    } catch (e) {}
  }

  // 数据页记录缓存直接清空，下次加载时从云端拉取准确数据
  try {
    wx.removeStorageSync(`data_page_records_${planId}`)
  } catch (e) {}
}

/**
 * 清空所有乐观更新相关的本地缓存
 * 通常在用户放弃 failed 记录后调用，避免显示已丢弃的临时数据
 */
function clearOptimisticCaches() {
  try {
    wx.removeStorageSync('index_page_plans')
    const info = wx.getStorageInfoSync()
    if (info && Array.isArray(info.keys)) {
      info.keys.forEach(key => {
        if (key.startsWith('data_page_records_')) {
          wx.removeStorageSync(key)
        }
      })
    }
  } catch (e) {
    console.error('[storage] 清空乐观缓存失败', e)
  }
}

/**
 * 触发单条记录的云端同步（fire-and-forget）
 */
function syncRecordToCloud(itemId) {
  const item = syncQueue.getAllItems().find(i => i.id === itemId)
  if (!item || item.status !== 'pending') return

  syncQueue.markSyncing(itemId)

  partner.saveCheckin(item.record)
    .then(res => {
      if (res && res.code === 0) {
        syncQueue.remove(itemId)
        updateCachesWithRealResult(item.record.planId, res)
      } else {
        throw new Error((res && res.msg) || '云端返回异常')
      }
    })
    .catch(err => {
      console.error('[storage] 云端同步失败', itemId, err)
      syncQueue.markFailed(itemId, err.message || String(err))
    })
}

/**
 * 乐观保存打卡记录
 * 1. 立即写入本地待同步队列
 * 2. 立即更新本地相关缓存（首页、数据页）
 * 3. 立即返回今日记录和统计供界面展示
 * 4. 后台异步调用云函数真正同步
 */
async function saveRecordOptimistic(record) {
  if (!record.planId) {
    record.planId = await ensurePlanId()
  }
  if (!record.date) {
    record.date = formatDate(new Date())
  }
  if (!record.timestamp) {
    record.timestamp = Date.now()
  }
  if (!record.id || !String(record.id).startsWith('local_')) {
    record.id = `local_${record.timestamp}`
  }

  // 1. 加入待同步队列
  const item = syncQueue.add(record)

  // 2. 计算乐观结果
  const optimistic = computeOptimisticResult(record)

  // 3. 更新本地缓存
  updateIndexCacheOptimistically(record, optimistic.stats, optimistic.todayRecord)
  updateDataCacheOptimistically(record)

  // 4. 后台同步
  syncRecordToCloud(item.id)

  return {
    code: 0,
    todayRecord: optimistic.todayRecord,
    historyStats: optimistic.historyStats,
    stats: optimistic.stats,
    pendingId: item.id
  }
}

module.exports = {
  // 计划 ID
  setCurrentPlanId,
  getCurrentPlanId,
  ensurePlanId,

  // 打卡记录（云端）
  getRecords,
  saveRecord,
  saveRecordOptimistic,
  getTodayRecord,
  getStreak,
  getWeekCount,
  getTotalDays,
  loadStats,

  // 工具函数
  formatDate,
  formatDateDisplay,
  calcAccuracy,
  calcSingleAccuracy,
  buildTodaySummary,
  mergeTodayRecords,
  applyRecordsToStats,

  // 乐观更新与缓存回写
  updateCachesWithRealResult,
  syncRecordToCloud,
  clearOptimisticCaches,

  // 提醒弹窗
  getReminderPromptShown,
  setReminderPromptShown
}
