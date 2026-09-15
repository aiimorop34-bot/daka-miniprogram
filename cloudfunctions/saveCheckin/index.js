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

function calcAccuracy(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

function getMonday(d) {
  const date = new Date(d)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  date.setHours(0, 0, 0, 0)
  return date
}

function computeStreak(dates) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const sortedDates = [...dates].sort((a, b) => new Date(b) - new Date(a))
  let streak = 0
  for (let i = 0; i < sortedDates.length; i++) {
    const expected = new Date(today)
    expected.setDate(expected.getDate() - i)
    if (sortedDates[i] === formatDate(expected)) {
      streak++
    } else {
      break
    }
  }
  return streak
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

exports.main = async (event, context) => {
  // 心跳预热：不执行任何写操作，立即返回
  if (event && event.warmup === true) {
    return { code: 0, msg: 'warmup' }
  }

  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { record } = event

  if (!record || !record.planId) {
    return { code: -1, msg: '缺少打卡计划 ID' }
  }
  if (!record.date || !record.timestamp || !Array.isArray(record.subjects)) {
    return { code: -2, msg: '打卡记录格式不正确' }
  }

  // 1. 校验计划归属并读取现有统计
  let plan
  let planStats
  try {
    const planRes = await db.collection('plans').doc(record.planId).get()
    if (!planRes.data || planRes.data.openid !== openid) {
      return { code: -3, msg: '打卡计划不存在或无权限' }
    }
    plan = planRes.data
    planStats = ensureStats(plan.stats || {})
  } catch (err) {
    console.error('[saveCheckin] 校验计划失败', err)
    return { code: -3, msg: '打卡计划不存在或无权限' }
  }

  // 2. 构造打卡文档
  const docId = record.id ? `${openid}_${record.id}` : undefined
  const checkinData = {
    openid,
    planId: record.planId,
    date: record.date,
    timestamp: record.timestamp,
    subjects: record.subjects,
    createdAt: db.serverDate()
  }

  let recordTotal = 0
  let recordCorrect = 0
  record.subjects.forEach(s => {
    recordTotal += s.total
    recordCorrect += s.correct
  })

  // 3. 写入 checkins 和更新提醒订阅并发执行
  const savePromise = docId
    ? db.collection('checkins').doc(docId).set({ data: checkinData })
    : db.collection('checkins').add({ data: checkinData })

  const reminderPromise = db.collection('reminder_subscriptions').where({ openid }).update({
    data: {
      lastCheckinDate: record.date,
      updatedAt: db.serverDate()
    }
  }).catch(err => {
    // reminder_subscriptions 集合可能不存在，忽略该错误不影响主流程
    console.error('[saveCheckin] 更新提醒订阅失败', err)
    return null
  })

  await Promise.all([savePromise, reminderPromise])

  // 4. 对旧计划做一次统计回补（计划文档没有 stats 字段时）
  //    注意：新记录已经写入，所以回补后的 stats 已包含本次记录，无需再增量
  let skipIncremental = false
  const needsBackfill = !plan.stats || plan.stats.totalRecords === undefined
  if (needsBackfill) {
    try {
      const allRecords = await fetchAllRecords(openid, record.planId)
      if (allRecords.length > 0) {
        planStats = computeStatsFromRecords(allRecords)
        skipIncremental = true
      }
    } catch (err) {
      console.error('[saveCheckin] 统计回补失败', err)
    }
  }

  // 5. 增量更新 plans.stats
  let newStats
  if (!skipIncremental) {
    const isNewDay = !planStats.checkedInDates.includes(record.date)
    const newCheckedInDates = isNewDay
      ? [...planStats.checkedInDates, record.date]
      : planStats.checkedInDates

    const monday = getMonday(new Date())
    const weekDates = newCheckedInDates.filter(d => new Date(d) >= monday)

    const newSubjectStats = { ...planStats.subjectStats }
    record.subjects.forEach(s => {
      const existing = newSubjectStats[s.name] || { count: 0, total: 0, correct: 0, avgAccuracy: 0 }
      existing.count += 1
      existing.total += s.total
      existing.correct += s.correct
      existing.avgAccuracy = calcAccuracy(existing.correct, existing.total)
      newSubjectStats[s.name] = existing
    })

    const newTotalRecords = planStats.totalRecords + 1
    const newTotalQuestions = planStats.totalQuestions + recordTotal
    const newTotalCorrect = planStats.totalCorrect + recordCorrect

    newStats = {
      streak: computeStreak(newCheckedInDates),
      weekCount: weekDates.length,
      totalDays: newCheckedInDates.length,
      totalRecords: newTotalRecords,
      totalQuestions: newTotalQuestions,
      totalCorrect: newTotalCorrect,
      avgAccuracy: calcAccuracy(newTotalCorrect, newTotalQuestions),
      avgVolume: newTotalRecords > 0 ? Math.round(newTotalQuestions / newTotalRecords) : 0,
      checkedInDates: newCheckedInDates,
      subjectStats: newSubjectStats,
      lastUpdated: db.serverDate()
    }

    await db.collection('plans').doc(record.planId).update({
      data: { stats: newStats, updatedAt: db.serverDate() }
    })
  } else {
    // 回补后的 stats 已包含本次记录，只需更新时间戳
    newStats = {
      ...planStats,
      lastUpdated: db.serverDate()
    }
    await db.collection('plans').doc(record.planId).update({
      data: { 'stats.lastUpdated': db.serverDate(), updatedAt: db.serverDate() }
    })
  }

  // 6. 获取今日记录用于生成 todayRecord（仅查今日，避免全表扫描）
  const todayRecordsRes = await db.collection('checkins')
    .where({ openid, planId: record.planId, date: record.date })
    .orderBy('timestamp', 'desc')
    .get()

  const todayRecord = todayRecordsRes.data.length > 0
    ? mergeTodayRecords(todayRecordsRes.data)
    : null

  return {
    code: 0,
    msg: '打卡记录已保存',
    todayRecord,
    historyStats: {
      totalRecords: newStats.totalRecords,
      totalQuestions: newStats.totalQuestions,
      totalCorrect: newStats.totalCorrect,
      checkedInDates: newStats.checkedInDates,
      subjectStats: newStats.subjectStats
    },
    stats: {
      streak: newStats.streak,
      weekCount: newStats.weekCount,
      totalDays: newStats.totalDays,
      totalRecords: newStats.totalRecords,
      totalQuestions: newStats.totalQuestions,
      totalCorrect: newStats.totalCorrect,
      avgAccuracy: newStats.avgAccuracy,
      avgVolume: newStats.avgVolume
    }
  }
}
