const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

const MAX_NAME_LEN = 10

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    if (err.errCode === -501001 || err.errCode === -501009 || err.errCode === 501009 || /already exists|table exist|resourceexist/i.test(err.message)) {
      // ignore
    } else {
      throw err
    }
  }
}

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
    console.error('[createPlan] 文本安全检测异常', {
      errCode: err.errCode,
      errMsg: err.errMsg,
      message: err.message
    })
    if (err.errCode === 87014) {
      return { ok: false, violation: true, msg: '包含违规内容，请修改后重试' }
    }
    if (shouldDegradeError(err)) {
      console.warn('[createPlan] 内容安全 API 不可用，降级放行', { errCode: err.errCode })
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
  const { name, subjects } = event

  // 基础校验
  const nameValidation = validateName(name, '计划名称')
  if (!nameValidation.ok) {
    return { code: -1, msg: nameValidation.msg }
  }

  const subjectsValidation = validateSubjects(subjects)
  if (!subjectsValidation.ok) {
    return { code: -1, msg: subjectsValidation.msg }
  }

  await ensureCollection('plans')

  // 内容安全检测
  const securityCheck = await checkPlanContentSecurity(openid, name.trim(), subjectsValidation.subjects)
  if (!securityCheck.ok) {
    return { code: -2, msg: securityCheck.msg }
  }

  try {
    const now = db.serverDate()
    const data = {
      openid,
      name: name.trim(),
      subjects: subjectsValidation.subjects,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      stats: {
        streak: 0,
        weekCount: 0,
        totalDays: 0,
        totalRecords: 0,
        totalQuestions: 0,
        totalCorrect: 0,
        avgAccuracy: 0,
        avgVolume: 0,
        checkedInDates: [],
        subjectStats: {},
        lastUpdated: now
      }
    }

    const addRes = await db.collection('plans').add({ data })
    return {
      code: 0,
      planId: addRes._id,
      plan: {
        _id: addRes._id,
        ...data
      }
    }
  } catch (err) {
    console.error('[createPlan] 创建计划失败', err)
    return {
      code: -1,
      msg: err.message || '创建计划失败'
    }
  }
}
