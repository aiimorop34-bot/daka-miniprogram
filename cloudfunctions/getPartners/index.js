const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const userOpenid = wxContext.OPENID

  const res = await db.collection('partnerships').where({
    userOpenid: userOpenid
  }).get()

  const list = res.data || []
  const partnerOpenids = list.map(item => item.partnerOpenid).filter(Boolean)

  // 拉取伙伴的用户资料（昵称、头像）
  let userMap = {}
  if (partnerOpenids.length > 0) {
    const userRes = await db.collection('users').where({
      openid: _.in(partnerOpenids)
    }).get()
    userMap = (userRes.data || []).reduce((map, user) => {
      map[user.openid] = user
      return map
    }, {})
  }

  const mergedList = list.map(item => {
    const user = userMap[item.partnerOpenid] || {}
    return {
      ...item,
      nickname: user.nickname || '',
      avatarUrl: user.avatarUrl || ''
    }
  })

  return {
    code: 0,
    list: mergedList
  }
}