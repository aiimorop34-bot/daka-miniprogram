const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
    console.log(`[ensureCollection] 创建集合 ${name} 成功`)
  } catch (err) {
    // 已存在错误码在不同环境下可能是 -501001 或 -501009，消息里也会包含 Table exist / already exists
    if (err.errCode === -501001 || err.errCode === -501009 || err.errCode === 501009 || /already exists|table exist|resourceexist/i.test(err.message)) {
      console.log(`[ensureCollection] 集合 ${name} 已存在`)
    } else {
      console.error(`[ensureCollection] 创建集合 ${name} 失败`, err)
      throw err
    }
  }
}

const DEFAULT_SUBJECTS = [
  { name: '言语理解' },
  { name: '判断推理' },
  { name: '数量关系' },
  { name: '资料分析' },
  { name: '常识判断' },
  { name: '政治理论' }
]

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // 自动创建新集合（若不存在），避免首次部署后集合未手动创建导致失败
  await ensureCollection('plans')
  await ensureCollection('checkins')

  // 幂等：先查询该用户是否已有计划
  const existing = await db.collection('plans').where({ openid }).limit(1).get()
  let planId
  let isNew = false

  if (existing.data.length > 0) {
    planId = existing.data[0]._id
  } else {
    const now = db.serverDate()
    const addRes = await db.collection('plans').add({
      data: {
        openid,
        name: '行政职业能力测验',
        subjects: DEFAULT_SUBJECTS,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
        stats: {
          streak: 0,
          weekCount: 0,
          totalDays: 0,
          totalRecords: 0,
          totalQuestions: 0,
          totalCorrect: 0,
          avgAccuracy: 0,
          avgVolume: 0,
          checkedInDates: [],
          subjectStats: {},
          lastUpdated: now
        }
      }
    })
    planId = addRes._id
    isNew = true

    console.log(`[ensureDefaultPlan] 为用户 ${openid} 创建默认行政职业能力测验计划 ${planId}`)
  }

  // 迁移该用户在 checkins 集合中尚无 planId 的历史记录
  const migrateRes = await db.collection('checkins').where({
    openid,
    planId: db.command.exists(false)
  }).update({
    data: { planId }
  })

  if (migrateRes && migrateRes.stats && migrateRes.stats.updated > 0) {
    console.log(`[ensureDefaultPlan] 已为 ${migrateRes.stats.updated} 条 checkins 记录关联 planId`)
  }

  return {
    code: 0,
    planId,
    isNew,
    name: '行政职业能力测验',
    subjects: DEFAULT_SUBJECTS
  }
}
