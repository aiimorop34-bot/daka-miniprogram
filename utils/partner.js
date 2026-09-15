// ==================== 打卡提醒订阅消息配置 ====================
// TODO: 在微信公众平台申请模板后，把模板 ID 填到这里
const REMINDER_TEMPLATE_ID = '3xjlQJbU5lE5mXp7a5UkGy3IFYhA2xFvfYR37aUICPQ'
const REMINDER_TIME = '21:00'

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

function getUserInfo() {
  return wx.getStorageSync('user_info') || {}
}

function setUserInfo(info) {
  wx.setStorageSync('user_info', info)
}

function getInviteCode() {
  return wx.getStorageSync('invite_code') || ''
}

function setInviteCode(code) {
  wx.setStorageSync('invite_code', code)
}

/**
 * 统一处理云函数调用错误，避免把 raw error 暴露给用户
 */
function normalizeCloudError(err) {
  let msg = ''
  if (typeof err === 'string') {
    msg = err
  } else if (err && err.errMsg) {
    msg = err.errMsg
  } else if (err && err.message) {
    msg = err.message
  }

  const lower = msg.toLowerCase()
  if (!msg || lower.includes('failed to fetch') || lower.includes('network') || lower.includes('timeout') || lower.includes('abort')) {
    return '网络异常，请检查网络后重试'
  }
  return msg
}

function ensureInviteCode() {
  return new Promise((resolve, reject) => {
    let code = getInviteCode()
    if (code) {
      resolve(code)
      return
    }

    code = generateInviteCode()

    wx.cloud.callFunction({
      name: 'saveUserProfile',
      data: { inviteCode: code }
    }).then(() => {
      setInviteCode(code)
      resolve(code)
    }).catch(err => {
      console.error('保存邀请码失败', err)
      reject(err)
    })
  })
}

function saveUserProfile(profile) {
  const info = getUserInfo()
  const merged = { ...info, ...profile }
  setUserInfo(merged)

  return wx.cloud.callFunction({
    name: 'saveUserProfile',
    data: { profile: merged }
  })
}

function getUserProfile() {
  return wx.cloud.callFunction({
    name: 'getUserProfile'
  }).then(res => res.result)
}

function getPartners() {
  return wx.cloud.callFunction({
    name: 'getPartners'
  }).then(res => res.result || { list: [] })
}

function addPartnerByCode(code) {
  return wx.cloud.callFunction({
    name: 'addPartner',
    data: { code: code.toUpperCase() }
  }).then(res => res.result)
}

function removePartner(partnerOpenid) {
  return wx.cloud.callFunction({
    name: 'removePartner',
    data: { partnerOpenid }
  }).then(res => res.result)
}

function syncAndGetStats(stats) {
  return wx.cloud.callFunction({
    name: 'syncAndGetStats',
    data: { stats }
  }).then(res => res.result)
}

function getReminderTemplateId() {
  return REMINDER_TEMPLATE_ID
}

function requestReminderSubscription() {
  console.log('[reminder] 调用 wx.requestSubscribeMessage，模板 ID:', REMINDER_TEMPLATE_ID)
  return wx.requestSubscribeMessage({
    tmplIds: [REMINDER_TEMPLATE_ID]
  }).then(res => {
    console.log('[reminder] wx.requestSubscribeMessage 返回:', res)
    return res
  }).catch(err => {
    console.error('[reminder] wx.requestSubscribeMessage 失败:', err)
    throw err
  })
}

function getReminderSubscription() {
  console.log('[reminder] 调用 getReminderSubscription 云函数')
  return wx.cloud.callFunction({
    name: 'getReminderSubscription'
  }).then(res => {
    console.log('[reminder] getReminderSubscription 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[reminder] getReminderSubscription 失败:', err)
    throw err
  })
}

function saveReminderSubscription({ remindDate, remindTime, isSubscribed }) {
  console.log('[reminder] 调用 saveReminderSubscription 云函数:', { remindDate, remindTime, isSubscribed })
  return wx.cloud.callFunction({
    name: 'saveReminderSubscription',
    data: {
      templateId: REMINDER_TEMPLATE_ID,
      remindDate,
      remindTime: remindTime || REMINDER_TIME,
      isSubscribed
    }
  }).then(res => {
    console.log('[reminder] saveReminderSubscription 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[reminder] saveReminderSubscription 失败:', err)
    throw err
  })
}

// ==================== 计划管理 ====================

function getPlans() {
  return wx.cloud.callFunction({
    name: 'getPlans'
  }).then(res => {
    console.log('[getPlans] 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[getPlans] 失败:', err)
    throw err
  })
}

function createPlan(name, subjects) {
  return wx.cloud.callFunction({
    name: 'createPlan',
    data: { name, subjects }
  }).then(res => {
    console.log('[createPlan] 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[createPlan] 失败:', err)
    throw new Error(normalizeCloudError(err))
  })
}

function updatePlan(planId, name, subjects) {
  return wx.cloud.callFunction({
    name: 'updatePlan',
    data: { planId, name, subjects }
  }).then(res => {
    console.log('[updatePlan] 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[updatePlan] 失败:', err)
    throw new Error(normalizeCloudError(err))
  })
}

function deletePlan(planId) {
  return wx.cloud.callFunction({
    name: 'deletePlan',
    data: { planId }
  }).then(res => {
    console.log('[deletePlan] 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[deletePlan] 失败:', err)
    throw new Error(normalizeCloudError(err))
  })
}

// ==================== 打卡记录 ====================

function getCheckins(planId, startDate, endDate) {
  return wx.cloud.callFunction({
    name: 'getCheckins',
    data: { planId, startDate, endDate }
  }).then(res => {
    console.log('[getCheckins] 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[getCheckins] 失败:', err)
    throw err
  })
}

function getMonthDailyTotals(planId, year, month) {
  return wx.cloud.callFunction({
    name: 'getMonthDailyTotals',
    data: { planId, year, month }
  }).then(res => {
    console.log('[getMonthDailyTotals] 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[getMonthDailyTotals] 失败:', err)
    throw err
  })
}

function getCheckinStats(planId) {
  return wx.cloud.callFunction({
    name: 'getCheckinStats',
    data: { planId }
  }).then(res => {
    console.log('[getCheckinStats] 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[getCheckinStats] 失败:', err)
    throw err
  })
}

function getCheckinStatsForPlans(planIds) {
  return wx.cloud.callFunction({
    name: 'getCheckinStats',
    data: { planIds }
  }).then(res => {
    console.log('[getCheckinStatsForPlans] 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[getCheckinStatsForPlans] 失败:', err)
    throw err
  })
}

function saveCheckin(record) {
  console.log('[checkin] 调用 saveCheckin 云函数:', record)
  return wx.cloud.callFunction({
    name: 'saveCheckin',
    data: { record }
  }).then(res => {
    console.log('[checkin] saveCheckin 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[checkin] saveCheckin 失败:', err)
    throw err
  })
}

function deleteCheckin(recordId, planId) {
  console.log('[checkin] 调用 deleteCheckin 云函数:', { recordId, planId })
  return wx.cloud.callFunction({
    name: 'deleteCheckin',
    data: { recordId, planId }
  }).then(res => {
    console.log('[checkin] deleteCheckin 返回:', res.result)
    return res.result
  }).catch(err => {
    console.error('[checkin] deleteCheckin 失败:', err)
    throw err
  })
}

module.exports = {
  generateInviteCode,
  getUserInfo,
  setUserInfo,
  getInviteCode,
  setInviteCode,
  ensureInviteCode,
  saveUserProfile,
  getUserProfile,
  getPartners,
  addPartnerByCode,
  removePartner,
  syncAndGetStats,
  getReminderTemplateId,
  requestReminderSubscription,
  getReminderSubscription,
  saveReminderSubscription,
  saveCheckin,
  deleteCheckin,
  getCheckins,
  getCheckinStats,
  getCheckinStatsForPlans,
  getMonthDailyTotals,
  getPlans,
  createPlan,
  updatePlan,
  deletePlan
}