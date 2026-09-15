const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const userOpenid = wxContext.OPENID
  const { partnerOpenid } = event

  if (!partnerOpenid) {
    return { code: -1, msg: '参数错误' }
  }

  // 删除双向关系
  await db.collection('partnerships').where({
    userOpenid: userOpenid,
    partnerOpenid: partnerOpenid
  }).remove()

  await db.collection('partnerships').where({
    userOpenid: partnerOpenid,
    partnerOpenid: userOpenid
  }).remove()

  return { code: 0, msg: '移除成功' }
}