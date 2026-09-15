const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

function shouldDegradeError(err) {
  // 当内容安全 API 不可用（无权限、系统错误、服务繁忙）时降级放行，
  // 仅对明确命中违规内容（87014）保持拦截。
  if (!err) return false
  const degradedCodes = [-604101, -604102, -1, 'ERR_OPENAPI_PERMISSION_DENIED', 'ERR_OPENAPI_SYSTEM_ERROR']
  if (degradedCodes.includes(err.errCode)) return true
  const text = String(err.errMsg || err.message || '')
  return /no permission|permission denied|没有权限|无权限|system error|服务异常|调用失败|繁忙|busy/i.test(text)
}

async function checkText(openid, content, retries = 2) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
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
      console.error(`[checkContentSecurity] 文本安全检测异常 (attempt ${i + 1})`, {
        errCode: err.errCode,
        errMsg: err.errMsg,
        message: err.message,
        stack: err.stack
      })
      lastErr = err
      if (err.errCode === 87014) {
        return { ok: false, violation: true, msg: '包含违规内容，请修改后重试' }
      }
      if (shouldDegradeError(err)) {
        console.warn('[checkContentSecurity] 内容安全 API 不可用，降级放行', { errCode: err.errCode })
        return { ok: true, degraded: true }
      }
      if (i < retries) {
        await new Promise(r => setTimeout(r, 200))
      }
    }
  }
  return { ok: false, serviceError: true, msg: '内容安全检测服务异常，请稍后重试' }
}

async function checkNickname(openid, nickname) {
  const result = await checkText(openid, nickname)
  if (!result.ok && result.msg) {
    return { ...result, msg: '昵称' + result.msg }
  }
  return result
}

async function checkAvatar(openid, avatarUrl) {
  try {
    const downloadRes = await cloud.downloadFile({
      fileList: [avatarUrl]
    })

    const fileItem = downloadRes.fileList && downloadRes.fileList[0]
    if (!fileItem || fileItem.status !== 0 || !fileItem.fileContent) {
      console.error('[checkContentSecurity] 头像下载失败，降级放行', {
        status: fileItem && fileItem.status,
        errMsg: fileItem && fileItem.errMsg
      })
      return { ok: true, degraded: true }
    }

    if (fileItem.fileContent.length > 1024 * 1024) {
      console.warn('[checkContentSecurity] 头像超过 1MB，无法检测，降级放行')
      return { ok: true, degraded: true }
    }

    const extMatch = avatarUrl.match(/\.(jpg|jpeg|png|gif|bmp|webp)(\?|$)/i)
    let contentType = 'image/png'
    if (extMatch) {
      const ext = extMatch[1].toLowerCase()
      if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg'
      else if (ext === 'gif') contentType = 'image/gif'
      else if (ext === 'bmp') contentType = 'image/bmp'
      else if (ext === 'webp') contentType = 'image/webp'
    }

    const res = await cloud.openapi.security.imgSecCheck({
      openid,
      media: {
        contentType,
        value: fileItem.fileContent
      }
    })

    if (res.result && res.result.suggest !== 'pass') {
      return { ok: false, violation: true, msg: '图片内容不合规，请更换头像' }
    }
    return { ok: true }
  } catch (err) {
    console.error('[checkContentSecurity] 头像安全检测异常', {
      errCode: err.errCode,
      errMsg: err.errMsg,
      message: err.message
    })
    if (err.errCode === 87014) {
      return { ok: false, violation: true, msg: '图片内容不合规，请更换头像' }
    }
    if (shouldDegradeError(err)) {
      console.warn('[checkContentSecurity] 头像检测 API 不可用，降级放行', { errCode: err.errCode })
      return { ok: true, degraded: true }
    }
    return { ok: false, serviceError: true, msg: '图片安全检测服务异常，请稍后重试' }
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { nickname, avatarUrl, texts } = event

  const result = {
    code: 0,
    nickname: null,
    avatarUrl: null
  }

  if (nickname && nickname.trim()) {
    result.nickname = await checkNickname(openid, nickname.trim())
  }

  if (avatarUrl && avatarUrl.trim()) {
    result.avatarUrl = await checkAvatar(openid, avatarUrl.trim())
  }

  // 支持通用文本批量检测，例如：
  // texts: [{ key: 'planName', content: '...' }, { key: 'subject_0', content: '...' }]
  if (Array.isArray(texts) && texts.length > 0) {
    for (const item of texts) {
      if (item && item.key && typeof item.content === 'string' && item.content.trim()) {
        result[item.key] = await checkText(openid, item.content.trim())
      }
    }
  }

  return result
}
