const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const userOpenid = wxContext.OPENID
  const { code } = event

  if (!code || code.length !== 6) {
    return { code: -1, msg: '邀请码格式错误' }
  }

  // 查找邀请码对应的用户
  const userRes = await db.collection('users').where({
    inviteCode: code
  }).get()

  if (userRes.data.length === 0) {
    return { code: -2, msg: '邀请码不存在' }
  }

  const partner = userRes.data[0]
  const partnerOpenid = partner.openid

  if (partnerOpenid === userOpenid) {
    return { code: -3, msg: '不能添加自己为学习伙伴' }
  }

  // 检查是否已存在伙伴关系
  const existRes = await db.collection('partnerships').where({
    userOpenid: userOpenid,
    partnerOpenid: partnerOpenid
  }).get()

  if (existRes.data.length > 0) {
    return { code: -4, msg: '对方已经是你的学习伙伴' }
  }

  const now = db.serverDate()

  // 创建双向关系
  await db.collection('partnerships').add({
    data: {
      userOpenid: userOpenid,
      partnerOpenid: partnerOpenid,
      createdAt: now
    }
  })

  await db.collection('partnerships').add({
    data: {
      userOpenid: partnerOpenid,
      partnerOpenid: userOpenid,
      createdAt: now
    }
  })

  return {
    code: 0,
    msg: '添加成功',
    partner: {
      openid: partnerOpenid,
      nickname: partner.nickname || '',
      avatarUrl: partner.avatarUrl || ''
    }
  }
}