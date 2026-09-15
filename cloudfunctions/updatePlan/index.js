const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

const MAX_NAME_LEN = 10

function validateName(name, label = '计划名称') {
  if (!name || !name.trim()) {
    return { ok: false, msg: `${label}不能为空` }
  }
  if (name.trim().length > MAX_NAME_LEN) {
    return { ok: false, msg: `${label}不能超过${MAX_NAME_LEN}个字` }
  }
  return { ok: true }
}

function normalizeSubject(s) {
  if (typeof s === 'string') return { name: s.trim() }
  if (s && typeof s === 'object' && typeof s.name === 'string') {
    return { name: s.name.trim() }
  }
  return null
}

function validateSubjects(subjects) {
  if (!Array.isArray(subjects) || subjects.length === 0) {
    return { ok: false, msg: '至少需要1个板块' }
  }

  const normalized = subjects.map(normalizeSubject).filter(s => s && s.name)
  if (normalized.length === 0) {
    return { ok: false, msg: '至少需要1个板块' }
  }

  if (normalized.some(s => s.name.length > MAX_NAME_LEN)) {
    return { ok: false, msg: `板块名称不能超过${MAX_NAME_LEN}个字` }
  }

  const unique = new Set(normalized.map(s => s.name))
  if (unique.size !== normalized.length) {
    return { ok: false, msg: '板块名称不能重复' }
  }

  return { ok: true, subjects: normalized }
}

function shouldDegradeError(err) {
  // 当内容安全 API 不可用（无权限、系统错误、服务繁忙）时降级放行，
  // 仅对明确命中违规内容（87014）保持拦截。
  if (!err) return false
  const degradedCodes = [-604101, -604102, -1, 'ERR_OPENAPI_PERMISSION_DENIED', 'ERR_OPENAPI_SYSTEM_ERROR']
  if (degradedCodes.includes(err.errCode)) return true
  const text = String(err.errMsg || err.message || '')
  return /no permission|permission denied|没有权限|无权限|system error|服务异常|调用失败|繁忙|busy/i.test(text)
}

async function checkText(openid, content) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      openid,
      scene: 1,
      content,
      version: 2
    })

    if (res.result && res.result.suggest !== 'pass') {
      return { ok: false, violation: true, msg: '包含违规内容，请修改后重试' }
    }
    return { ok: true }
  } catch (err) {
    console.error('[updatePlan] 文本安全检测异常', {
      errCode: err.errCode,
      errMsg: err.errMsg,
      message: err.message
    })
    if (err.errCode === 87014) {
      return { ok: false, violation: true, msg: '包含违规内容，请修改后重试' }
    }
    if (shouldDegradeError(err)) {
      console.warn('[updatePlan] 内容安全 API 不可用，降级放行', { errCode: err.errCode })
      return { ok: true, degraded: true }
    }
    return { ok: false, serviceError: true, msg: '内容安全检测服务异常，请稍后重试' }
  }
}

async function checkPlanContentSecurity(openid, name, subjects) {
  const planNameCheck = await checkText(openid, name.trim())
  if (planNameCheck.violation) {
    return { ok: false, violation: true, msg: `计划名称${planNameCheck.msg}` }
  }

  for (const subject of subjects) {
    const subjectCheck = await checkText(openid, subject.name)
    if (subjectCheck.violation) {
      return { ok: false, violation: true, msg: `板块名称"${subject.name}"${subjectCheck.msg}` }
    }
  }

  return { ok: true }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { planId, name, subjects } = event

  if (!planId) {
    return { code: -1, msg: '计划ID不能为空' }
  }

  const nameValidation = validateName(name, '计划名称')
  if (!nameValidation.ok) {
    return { code: -1, msg: nameValidation.msg }
  }

  const subjectsValidation = validateSubjects(subjects)
  if (!subjectsValidation.ok) {
    return { code: -1, msg: subjectsValidation.msg }
  }

  try {
    const planRes = await db.collection('plans').doc(planId).get()
    const plan = planRes.data
    if (!plan) {
      return { code: -1, msg: '计划不存在' }
    }
    if (plan.openid !== openid) {
      return { code: -1, msg: '无权修改该计划' }
    }

    // 内容安全检测
    const securityCheck = await checkPlanContentSecurity(openid, name.trim(), subjectsValidation.subjects)
    if (!securityCheck.ok) {
      return { code: -2, msg: securityCheck.msg }
    }

    const now = db.serverDate()
    const updateData = {
      name: name.trim(),
      subjects: subjectsValidation.subjects,
      updatedAt: now
    }

    // 如果板块名称发生变化，原有的 subjectStats 键名会失效，需要重置并重新积累
    const oldSubjectNames = new Set((plan.subjects || []).map(s => s.name))
    const newSubjectNames = new Set(subjectsValidation.subjects.map(s => s.name))
    const subjectsChanged = oldSubjectNames.size !== newSubjectNames.size ||
      ![...oldSubjectNames].every(n => newSubjectNames.has(n))

    if (subjectsChanged) {
      updateData['stats.subjectStats'] = {}
      updateData['stats.lastUpdated'] = now
    }

    await db.collection('plans').doc(planId).update({ data: updateData })

    return {
      code: 0,
      plan: {
        _id: planId,
        ...updateData
      }
    }
  } catch (err) {
    console.error('[updatePlan] 更新计划失败', err)
    return {
      code: -1,
      msg: err.message || '更新计划失败'
    }
  }
}
