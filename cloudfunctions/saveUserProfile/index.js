const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

function shouldBlockSave(checkItem, label) {
  if (!checkItem) return { block: false }
  if (checkItem.violation) {
    return { block: true, msg: checkItem.msg || `${label}包含违规内容` }
  }
  if (checkItem.serviceError || (checkItem.ok === false && !checkItem.violation)) {
    console.warn(`[saveUserProfile] ${label}检测服务异常，放行保存`, checkItem)
  }
  return { block: false }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { profile, inviteCode } = event

  // 1. 统一内容安全检测（必须在服务端完成）
  // 规则：只有明确命中违规内容（violation: true）才拦截保存；
  // 接口调用异常（serviceError）只记录日志，不阻断保存。
  if (profile) {
    const checkPayload = {}
    if (profile.nickname && profile.nickname.trim()) {
      checkPayload.nickname = profile.nickname.trim()
    }
    if (profile.avatarUrl && profile.avatarUrl.trim()) {
      checkPayload.avatarUrl = profile.avatarUrl.trim()
    }

    if (Object.keys(checkPayload).length > 0) {
      const checkRes = await cloud.callFunction({
        name: 'checkContentSecurity',
        data: checkPayload
      })
      const checkResult = checkRes.result || {}

      const nicknameCheck = shouldBlockSave(checkResult.nickname, '昵称')
      if (nicknameCheck.block) {
        return { code: -10, msg: nicknameCheck.msg }
      }

      const avatarCheck = shouldBlockSave(checkResult.avatarUrl, '头像')
      if (avatarCheck.block) {
        return { code: -11, msg: avatarCheck.msg }
      }
    }
  }

  // 2. 保存或更新用户资料
  const userRes = await db.collection('users').where({
    openid: openid
  }).get()

  const now = db.serverDate()

  if (userRes.data.length === 0) {
    const data = {
      openid: openid,
      updatedAt: now
    }
    if (inviteCode) data.inviteCode = inviteCode
    if (profile) {
      data.nickname = profile.nickname || ''
      data.avatarUrl = profile.avatarUrl || ''
    }
    await db.collection('users').add({
      data: data
    })
  } else {
    const updateData = {
      updatedAt: now
    }
    if (inviteCode) updateData.inviteCode = inviteCode
    if (profile) {
      updateData.nickname = profile.nickname || ''
      updateData.avatarUrl = profile.avatarUrl || ''
    }
    await db.collection('users').doc(userRes.data[0]._id).update({
      data: updateData
    })
  }

  return { code: 0 }
}
