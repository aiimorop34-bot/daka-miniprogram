const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  try {
    const wxContext = cloud.getWXContext()
    const openid = wxContext.OPENID
    const { templateId, isSubscribed, remindDate, remindTime } = event

    console.log('saveReminderSubscription 入参', { openid, templateId, isSubscribed, remindDate, remindTime })

    if (!openid) {
      return {
        code: -1,
        msg: '无法获取用户 openid'
      }
    }

    if (!templateId || templateId.indexOf('YOUR_TEMPLATE_ID') > -1) {
      return {
        code: -1,
        msg: '模板 ID 未配置'
      }
    }

    if (!isSubscribed) {
      const pending = await db.collection('reminder_subscriptions').where({
        openid,
        status: 'pending'
      }).get()

      for (const item of pending.data) {
        await db.collection('reminder_subscriptions').doc(item._id).update({
          data: {
            status: 'cancelled',
            updatedAt: db.serverDate()
          }
        })
      }

      return {
        code: 0,
        msg: '已取消提醒'
      }
    }

    if (!remindDate) {
      return {
        code: -1,
        msg: '缺少 remindDate'
      }
    }

    const existing = await db.collection('reminder_subscriptions').where({
      openid,
      remindDate,
      status: 'pending'
    }).get()

    const data = {
      openid,
      templateId,
      remindDate,
      remindTime: remindTime || '21:00',
      status: 'pending',
      lastCheckinDate: '',
      updatedAt: db.serverDate()
    }

    if (existing.data.length === 0) {
      data.subscribedAt = db.serverDate()
      const addRes = await db.collection('reminder_subscriptions').add({ data })
      console.log('新增订阅记录成功', addRes._id)
    } else {
      const updateRes = await db.collection('reminder_subscriptions').doc(existing.data[0]._id).update({ data })
      console.log('更新订阅记录成功', existing.data[0]._id, updateRes)
    }

    return {
      code: 0,
      msg: '订阅成功'
    }
  } catch (err) {
    console.error('saveReminderSubscription 执行失败', err)
    return {
      code: -1,
      msg: err.message || '云函数执行失败'
    }
  }
}
