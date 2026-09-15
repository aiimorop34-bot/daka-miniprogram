const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { planId } = event

  if (!planId) {
    return { code: -1, msg: '计划 ID 不能为空' }
  }

  try {
    const plansRes = await db.collection('plans').where({ openid }).get()
    const plans = plansRes.data || []

    if (plans.length <= 1) {
      return { code: -1, msg: '至少需要保留一个计划，无法删除' }
    }

    const target = plans.find(p => p._id === planId)
    if (!target) {
      return { code: -1, msg: '计划不存在或无权限' }
    }

    await db.collection('plans').doc(planId).remove()

    return {
      code: 0,
      msg: '删除成功'
    }
  } catch (err) {
    console.error('[deletePlan] 删除计划失败', err)
    return {
      code: -1,
      msg: err.message || '删除计划失败'
    }
  }
}
