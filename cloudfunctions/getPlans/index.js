const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const DEFAULT_SUBJECTS = [
  { name: '言语理解' },
  { name: '判断推理' },
  { name: '数量关系' },
  { name: '资料分析' },
  { name: '常识判断' },
  { name: '政治理论' }
]

function normalizeSubject(s) {
  if (typeof s === 'string') return { name: s.trim() }
  if (s && typeof s === 'object' && typeof s.name === 'string') {
    return { name: s.name.trim() }
  }
  return null
}

// 修正旧格式数据：字符串数组或混合格式统一为对象数组
async function fixLegacySubjects(plans) {
  for (const plan of plans) {
    if (!Array.isArray(plan.subjects)) continue
    if (plan.subjects.some(s => typeof s === 'string')) {
      const newSubjects = plan.subjects.map(normalizeSubject).filter(s => s && s.name)
      try {
        await db.collection('plans').doc(plan._id).update({
          data: {
            subjects: newSubjects,
            updatedAt: db.serverDate()
          }
        })
        plan.subjects = newSubjects
      } catch (err) {
        console.error(`[getPlans] 修正计划 ${plan._id} subjects 失败`, err)
      }
    }
  }
  return plans
}

async function ensureDefaultPlan(openid) {
  const plans = await db.collection('plans').where({ openid }).get()
  if (plans.data.length > 0) {
    return plans.data[0]
  }

  const now = db.serverDate()
  const data = {
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

  const addRes = await db.collection('plans').add({ data })
  return { _id: addRes._id, ...data }
}

exports.main = async (event, context) => {
  // 心跳预热：不查询数据库，立即返回
  if (event && event.warmup === true) {
    return { code: 0, msg: 'warmup', plans: [] }
  }

  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const plans = await db.collection('plans')
      .where({ openid })
      .orderBy('createdAt', 'desc')
      .get()

    if (plans.data.length === 0) {
      const defaultPlan = await ensureDefaultPlan(openid)
      return {
        code: 0,
        plans: [defaultPlan]
      }
    }

    // 修正旧格式 subjects 并返回
    const fixedPlans = await fixLegacySubjects(plans.data)

    return {
      code: 0,
      plans: fixedPlans
    }
  } catch (err) {
    console.error('[getPlans] 失败', err)
    return {
      code: -1,
      msg: err.message || '获取计划列表失败',
      plans: []
    }
  }
}
