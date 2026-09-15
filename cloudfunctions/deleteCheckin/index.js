const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

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

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { recordId, planId } = event

  if (!recordId || !planId) {
    return { code: -1, msg: '缺少参数' }
  }

  // 校验记录归属
  const recordRes = await db.collection('checkins').doc(recordId).get().catch(() => null)
  if (!recordRes || !recordRes.data || recordRes.data.openid !== openid) {
    return { code: -2, msg: '记录不存在或无权限删除' }
  }

  // 删除记录
  await db.collection('checkins').doc(recordId).remove()

  // 全量重新计算该计划统计（不做增量，保证准确）
  const allRecords = await fetchAllRecords(openid, planId)
  const newStats = computeStatsFromRecords(allRecords)
  newStats.lastUpdated = db.serverDate()

  await db.collection('plans').doc(planId).update({
    data: { stats: newStats, updatedAt: db.serverDate() }
  })

  return { code: 0, msg: '删除成功', stats: newStats }
}
