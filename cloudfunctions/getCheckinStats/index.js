const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function ensureStats(stats) {
  return {
    streak: stats.streak || 0,
    weekCount: stats.weekCount || 0,
    totalDays: stats.totalDays || 0,
    totalRecords: stats.totalRecords || 0,
    totalQuestions: stats.totalQuestions || 0,
    totalCorrect: stats.totalCorrect || 0,
    avgAccuracy: stats.avgAccuracy || 0,
    avgVolume: stats.avgVolume || 0,
    checkedInDates: stats.checkedInDates || [],
    subjectStats: stats.subjectStats || {}
  }
}

function mergeTodayRecords(records) {
  const subjectMap = {}
  let latestTimestamp = 0
  records.forEach(r => {
    if (r.timestamp > latestTimestamp) {
      latestTimestamp = r.timestamp
    }
    r.subjects.forEach(s => {
      if (!subjectMap[s.name]) {
        subjectMap[s.name] = { name: s.name, total: 0, correct: 0 }
      }
      subjectMap[s.name].total += s.total
      subjectMap[s.name].correct += s.correct
    })
  })
  return {
    date: records[0].date,
    timestamp: latestTimestamp,
    subjects: Object.values(subjectMap)
  }
}

async function fetchAllRecords(openid, planId) {
  const records = []
  let offset = 0
  const limit = 100
  while (true) {
    const res = await db.collection('checkins')
      .where({ openid, planId })
      .orderBy('date', 'desc')
      .orderBy('timestamp', 'desc')
      .skip(offset)
      .limit(limit)
      .get()
    records.push(...res.data)
    if (res.data.length < limit) break
    offset += limit
  }
  return records
}

function computeStatsFromRecords(records) {
  const dates = new Set(records.map(r => r.date))
  const checkedInDates = Array.from(dates)

  let totalQuestions = 0
  let totalCorrect = 0
  const subjectStats = {}

  records.forEach(r => {
    r.subjects.forEach(s => {
      totalQuestions += s.total
      totalCorrect += s.correct
      const existing = subjectStats[s.name] || { count: 0, total: 0, correct: 0, avgAccuracy: 0 }
      existing.count += 1
      existing.total += s.total
      existing.correct += s.correct
      existing.avgAccuracy = calcAccuracy(existing.correct, existing.total)
      subjectStats[s.name] = existing
    })
  })

  return {
    streak: computeStreak(checkedInDates),
    weekCount: checkedInDates.filter(d => new Date(d) >= getMonday(new Date())).length,
    totalDays: checkedInDates.length,
    totalRecords: records.length,
    totalQuestions,
    totalCorrect,
    avgAccuracy: calcAccuracy(totalCorrect, totalQuestions),
    avgVolume: records.length > 0 ? Math.round(totalQuestions / records.length) : 0,
    checkedInDates,
    subjectStats
  }
}

async function backfillPlanStats(openid, planId) {
  try {
    const records = await fetchAllRecords(openid, planId)
    if (records.length === 0) return null
    const stats = computeStatsFromRecords(records)
    await db.collection('plans').doc(planId).update({
      data: {
        stats: { ...stats, lastUpdated: db.serverDate() },
        updatedAt: db.serverDate()
      }
    })
    return stats
  } catch (err) {
    console.error('[getCheckinStats] 统计回补失败', planId, err)
    return null
  }
}

async function fetchTodayRecords(openid, planIds) {
  const today = formatDate(new Date())
  const records = []
  let offset = 0
  const limit = 100
  while (true) {
    const res = await db.collection('checkins')
      .where({
        openid,
        planId: _.in(planIds),
        date: today
      })
      .orderBy('timestamp', 'desc')
      .skip(offset)
      .limit(limit)
      .get()
    records.push(...res.data)
    if (res.data.length < limit) break
    offset += limit
  }
  return records
}

function buildTodayRecordMap(todayRecords) {
  const map = {}
  todayRecords.forEach(r => {
    if (!map[r.planId]) map[r.planId] = []
    map[r.planId].push(r)
  })
  Object.keys(map).forEach(planId => {
    map[planId] = mergeTodayRecords(map[planId])
  })
  return map
}

exports.main = async (event, context) => {
  // 心跳预热：不查询数据库，立即返回
  if (event && event.warmup === true) {
    return { code: 0, msg: 'warmup', stats: {} }
  }

  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { planId, planIds } = event

  try {
    // 多计划查询（首页）：直接读取 plans 缓存的统计，仅查询今日记录生成 todayRecord
    if (Array.isArray(planIds) && planIds.length > 0) {
      const uniqueIds = [...new Set(planIds)]

      const [plansRes, todayRecordsRes] = await Promise.all([
        db.collection('plans').where({
          openid,
          _id: _.in(uniqueIds)
        }).get(),
        fetchTodayRecords(openid, uniqueIds)
      ])

      const todayRecordMap = buildTodayRecordMap(todayRecordsRes)
      const planMap = {}
      plansRes.data.forEach(p => { planMap[p._id] = p })

      // 对没有 stats 的旧计划做一次性回补
      const backfillPromises = uniqueIds
        .filter(id => {
          const plan = planMap[id] || {}
          return !plan.stats || plan.stats.totalRecords === undefined
        })
        .map(id => backfillPlanStats(openid, id).then(stats => ({ id, stats })))

      if (backfillPromises.length > 0) {
        const backfillResults = await Promise.all(backfillPromises)
        backfillResults.forEach(({ id, stats }) => {
          if (stats) {
            planMap[id] = { ...(planMap[id] || {}), stats }
          }
        })
      }

      const statsMap = {}
      uniqueIds.forEach(id => {
        const plan = planMap[id] || {}
        const cachedStats = ensureStats(plan.stats || {})
        statsMap[id] = {
          ...cachedStats,
          todayRecord: todayRecordMap[id] || null,
          historyStats: {
            totalRecords: cachedStats.totalRecords,
            totalQuestions: cachedStats.totalQuestions,
            totalCorrect: cachedStats.totalCorrect,
            checkedInDates: cachedStats.checkedInDates,
            subjectStats: cachedStats.subjectStats
          }
        }
      })

      return { code: 0, stats: statsMap }
    }

    // 单计划查询（兼容旧调用）：读取缓存统计并返回全量记录
    if (planId) {
      const [planRes, records] = await Promise.all([
        db.collection('plans').doc(planId).get(),
        fetchAllRecords(openid, planId)
      ])

      let plan = planRes.data || {}
      let cachedStats = ensureStats(plan.stats || {})

      // 旧计划回补统计
      if (!plan.stats || plan.stats.totalRecords === undefined) {
        const backfilled = await backfillPlanStats(openid, planId)
        if (backfilled) {
          cachedStats = ensureStats(backfilled)
        }
      }

      const today = formatDate(new Date())
      const todayRecords = records.filter(r => r.date === today)
      const todayRecord = todayRecords.length > 0 ? mergeTodayRecords(todayRecords) : null

      return {
        code: 0,
        ...cachedStats,
        todayRecord,
        records
      }
    }

    return { code: -1, msg: '缺少 planId 或 planIds 参数' }
  } catch (err) {
    console.error('[getCheckinStats] 失败', err)
    return {
      code: -1,
      msg: err.message || '获取云端统计数据失败',
      stats: {}
    }
  }
}
