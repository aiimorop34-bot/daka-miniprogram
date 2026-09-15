const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const userRes = await db.collection('users').where({
    openid: openid
  }).get()

  if (userRes.data.length === 0) {
    return {
      code: -1,
      msg: '用户不存在',
      data: null
    }
  }

  const user = userRes.data[0]
  return {
    code: 0,
    data: {
      openid: user.openid,
      nickname: user.nickname || '',
      avatarUrl: user.avatarUrl || '',
      inviteCode: user.inviteCode || ''
    }
  }
}
