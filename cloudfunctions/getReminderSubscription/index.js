const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const res = await db.collection('reminder_subscriptions').where({
    openid,
    status: 'pending'
  }).orderBy('subscribedAt', 'desc').limit(1).get()

  if (res.data.length === 0) {
    return {
      code: -1,
      data: null
    }
  }

  return {
    code: 0,
    data: res.data[0]
  }
}
