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

// 从数据库汇总当前用户所有计划的统计数据
// 优先使用 plans 集合中缓存的增量统计，避免每次都全量扫描 checkins
async function aggregateUserStats(openid) {
  const plansRes = await db.collection('plans').where({ openid }).get()
  const plans = plansRes.data || []

  // 如果没有计划，返回空统计
  if (plans.length === 0) {
    return {
      totalDays: 0,
      totalQuestions: 0,
      totalCorrect: 0,
      overallAccuracy: 0,
      streak: 0,
      weekTotal: 0,
      weekCorrect: 0,
      weekAccuracy: 0
    }
  }

  // 1. 从 plans.stats 汇总累计数据
  const allDates = new Set()
  let totalQuestions = 0
  let totalCorrect = 0

  plans.forEach(p => {
    const stats = p.stats || {}
    totalQuestions += stats.totalQuestions || 0
    totalCorrect += stats.totalCorrect || 0
    ;(stats.checkedInDates || []).forEach(d => allDates.add(d))
  })

  const dates = Array.from(allDates).sort((a, b) => new Date(b) - new Date(a))
  const totalDays = dates.length

  // 连续打卡天数：只要任意计划当天有打卡就算有效
  let streak = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i < dates.length; i++) {
    const expected = new Date(today)
    expected.setDate(today.getDate() - i)
    if (dates[i] === formatDate(expected)) {
      streak++
    } else {
      break
    }
  }

  // 2. 本周数据量较小，只拉取本周记录计算 weekTotal / weekCorrect
  const now = new Date()
  const dayOfWeek = now.getDay() || 7
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - dayOfWeek + 1)
  weekStart.setHours(0, 0, 0, 0)
  const weekStartStr = formatDate(weekStart)
  const planIds = plans.map(p => p._id)

  const weekRecords = []
  let offset = 0
  const limit = 100
  while (true) {
    const res = await db.collection('checkins')
      .where({
        openid,
        planId: _.in(planIds),
        date: _.gte(weekStartStr)
      })
      .skip(offset)
      .limit(limit)
      .get()
    weekRecords.push(...res.data)
    if (res.data.length < limit) break
    offset += limit
  }

  let weekTotal = 0
  let weekCorrect = 0
  weekRecords.forEach(r => {
    r.subjects.forEach(s => {
      weekTotal += Number(s.total) || 0
      weekCorrect += Number(s.correct) || 0
    })
  })

  return {
    totalDays,
    totalQuestions,
    totalCorrect,
    overallAccuracy: calcAccuracy(totalCorrect, totalQuestions),
    streak,
    weekTotal,
    weekCorrect,
    weekAccuracy: calcAccuracy(weekCorrect, weekTotal)
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const userOpenid = wxContext.OPENID
  const { stats } = event

  if (!stats || !stats.openid) {
    return { code: -1, msg: '参数错误' }
  }

  const now = db.serverDate()

  // 1. 先读取现有用户资料，判断昵称/头像是否真正发生变化
  const existingUserRes = await db.collection('users').where({
    openid: userOpenid
  }).get()
  const existingUser = existingUserRes.data[0] || {}

  const nicknameChanged = stats.nickname !== undefined &&
    stats.nickname.trim() !== (existingUser.nickname || '')
  const avatarUrlChanged = stats.avatarUrl !== undefined &&
    stats.avatarUrl.trim() !== (existingUser.avatarUrl || '')

  // 2. 只有在昵称/头像真正变化时才做内容安全检测，避免每次打卡都触发嵌套云函数调用
  let nicknameOk = true
  let avatarUrlOk = true
  let warning = ''

  if ((nicknameChanged || avatarUrlChanged) && (stats.nickname || stats.avatarUrl)) {
    const checkPayload = {}
    if (nicknameChanged && stats.nickname.trim()) {
      checkPayload.nickname = stats.nickname.trim()
    }
    if (avatarUrlChanged && stats.avatarUrl.trim()) {
      checkPayload.avatarUrl = stats.avatarUrl.trim()
    }

    if (Object.keys(checkPayload).length > 0) {
      try {
        const checkRes = await cloud.callFunction({
          name: 'checkContentSecurity',
          data: checkPayload
        })
        const checkResult = checkRes.result || {}

        if (checkResult.nickname && !checkResult.nickname.ok) {
          const checkItem = checkResult.nickname
          if (checkItem.serviceError || checkItem.degraded) {
            console.warn('[syncAndGetStats] 昵称安全检测服务异常，已降级', checkItem)
          } else {
            nicknameOk = false
            warning = checkItem.msg || ''
          }
        }

        if (checkResult.avatarUrl && !checkResult.avatarUrl.ok) {
          const checkItem = checkResult.avatarUrl
          if (checkItem.serviceError || checkItem.degraded) {
            console.warn('[syncAndGetStats] 头像安全检测服务异常，已降级', checkItem)
          } else {
            avatarUrlOk = false
            warning = warning
              ? `${warning}；${checkItem.msg || ''}`
              : (checkItem.msg || '')
          }
        }
      } catch (err) {
        console.error('[syncAndGetStats] 内容安全检测异常，已降级', err)
      }
    }
  }

  // 3. 更新当前用户资料：仅写入通过检测且真正变化的字段
  const userUpdateData = {
    updatedAt: now
  }
  if (stats.nickname !== undefined && nicknameOk) {
    userUpdateData.nickname = stats.nickname || ''
  }
  if (stats.avatarUrl !== undefined && avatarUrlOk) {
    userUpdateData.avatarUrl = stats.avatarUrl || ''
  }

  await db.collection('users').where({
    openid: userOpenid
  }).update({
    data: userUpdateData
  })

  // 3. 在服务端汇总所有计划的统计数据（不再依赖前端传入的数字）
  const aggregated = await aggregateUserStats(userOpenid)

  // 4. Upsert 用户统计数据
  const existStat = await db.collection('user_stats').where({
    openid: userOpenid
  }).get()

  const statData = {
    openid: userOpenid,
    totalDays: aggregated.totalDays,
    totalQuestions: aggregated.totalQuestions,
    overallAccuracy: aggregated.overallAccuracy,
    streak: aggregated.streak,
    weekTotal: aggregated.weekTotal,
    weekAccuracy: aggregated.weekAccuracy,
    updatedAt: now
  }

  if (stats.nickname !== undefined && nicknameOk) {
    statData.nickname = stats.nickname || ''
  }
  if (stats.avatarUrl !== undefined && avatarUrlOk) {
    statData.avatarUrl = stats.avatarUrl || ''
  }

  if (existStat.data.length > 0) {
    await db.collection('user_stats').doc(existStat.data[0]._id).update({
      data: statData
    })
  } else {
    await db.collection('user_stats').add({
      data: statData
    })
  }

  // 5. 返回当前实际资料（若本次被拦截，则回显数据库中已有的安全值）
  const userRes = await db.collection('users').where({
    openid: userOpenid
  }).get()
  const userDoc = userRes.data[0] || {}

  const myStats = {
    ...statData,
    nickname: userDoc.nickname || statData.nickname || '',
    avatarUrl: userDoc.avatarUrl || statData.avatarUrl || ''
  }

  // 6. 获取伙伴列表
  const partnerRes = await db.collection('partnerships').where({
    userOpenid: userOpenid
  }).get()

  const partnerOpenids = partnerRes.data.map(p => p.partnerOpenid)

  // 7. 获取所有伙伴的统计数据
  let partnerStats = []
  if (partnerOpenids.length > 0) {
    const statsRes = await db.collection('user_stats').where({
      openid: _.in(partnerOpenids)
    }).get()
    partnerStats = statsRes.data || []
  }

  const result = {
    code: 0,
    myStats,
    partnerStats
  }

  if (warning) {
    result.warning = warning
  }

  return result
}
