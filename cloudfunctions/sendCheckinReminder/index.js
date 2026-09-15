const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const REMINDER_MESSAGES = [
  '今天的题，你打卡了吗？',
  '刷题不打卡，等于白刷啦～',
  '一日不刷，如隔三秋，快回来打卡！',
  '你的学习 streak 正在等你续费。',
  '今晚 21 点，题库在等你临幸。'
]

const ENCOURAGES = [
  '坚持就是胜利',
  '再刷一组就休息',
  '今天的努力是明天的底气',
  '上岸进度条 +1%'
]

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

exports.main = async (event, context) => {
  const now = new Date()
  const today = formatDate(now)

  const res = await db.collection('reminder_subscriptions').where({
    status: 'pending',
    remindDate: today
  }).get()

  const list = res.data || []
  let sentCount = 0
  let failCount = 0
  let skipCount = 0

  for (const item of list) {
    if (item.lastCheckinDate === today) {
      skipCount++
      continue
    }

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: item.openid,
        templateId: item.templateId,
        data: {
          thing1: { value: randomPick(REMINDER_MESSAGES) },
          time5: { value: `${today} 21:00` },
          thing11: { value: randomPick(ENCOURAGES) }
        }
      })

      await db.collection('reminder_subscriptions').doc(item._id).update({
        data: {
          status: 'sent',
          sentAt: db.serverDate()
        }
      })

      sentCount++
    } catch (err) {
      console.error('发送提醒失败', err, item.openid)
      failCount++
    }
  }

  return {
    code: 0,
    total: list.length,
    sent: sentCount,
    skipped: skipCount,
    failed: failCount
  }
}
