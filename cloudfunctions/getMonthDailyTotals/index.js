const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

function pad(n) {
  return String(n).padStart(2, '0')
}

function getMonthDateRange(year, month) {
  const startDate = `${year}-${pad(month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${pad(month)}-${pad(lastDay)}`
  return { startDate, endDate }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { planId, year, month } = event

  if (!planId || !year || !month) {
    return { code: -1, msg: '缺少 planId、year 或 month 参数' }
  }

  const { startDate, endDate } = getMonthDateRange(Number(year), Number(month))

  try {
    const records = []
    let offset = 0
    const limit = 100

    while (true) {
      const res = await db.collection('checkins')
        .where({
          openid,
          planId,
          date: _.gte(startDate).and(_.lte(endDate))
        })
        .field({ date: true, subjects: true })
        .skip(offset)
        .limit(limit)
        .get()

      records.push(...res.data)
      if (res.data.length < limit) break
      offset += limit
    }

    const dailyTotals = {}
    records.forEach(r => {
      const date = r.date
      let dayTotal = 0
      ;(r.subjects || []).forEach(s => {
        dayTotal += Number(s.total) || 0
      })
      dailyTotals[date] = (dailyTotals[date] || 0) + dayTotal
    })

    // 查询该计划最早一条打卡记录，用于前端判断翻页边界
    const earliestRes = await db.collection('checkins')
      .where({ openid, planId })
      .orderBy('date', 'asc')
      .limit(1)
      .field({ date: true })
      .get()
    const earliestDate = earliestRes.data[0] ? earliestRes.data[0].date : null

    return {
      code: 0,
      dailyTotals,
      earliestDate,
      startDate,
      endDate
    }
  } catch (err) {
    console.error('[getMonthDailyTotals] 获取月每日题量失败', err)
    return {
      code: -1,
      msg: err.message || '获取月每日题量失败',
      dailyTotals: {}
    }
  }
}
