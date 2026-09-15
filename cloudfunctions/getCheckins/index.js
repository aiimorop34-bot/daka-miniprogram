const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { planId, startDate, endDate } = event

  const where = { openid }
  if (planId) {
    where.planId = planId
  }

  try {
    const records = []
    let offset = 0
    const limit = 100

    while (true) {
      const res = await db.collection('checkins')
        .where(where)
        .orderBy('date', 'desc')
        .orderBy('timestamp', 'desc')
        .skip(offset)
        .limit(limit)
        .get()

      records.push(...res.data)
      if (res.data.length < limit) break
      offset += limit
    }

    let filtered = records
    if (startDate) {
      filtered = filtered.filter(r => r.date >= startDate)
    }
    if (endDate) {
      filtered = filtered.filter(r => r.date <= endDate)
    }

    return {
      code: 0,
      records: filtered,
      total: filtered.length
    }
  } catch (err) {
    console.error('[getCheckins] 获取记录失败', err)
    return {
      code: -1,
      msg: err.message || '获取云端打卡记录失败',
      records: [],
      total: 0
    }
  }
}
