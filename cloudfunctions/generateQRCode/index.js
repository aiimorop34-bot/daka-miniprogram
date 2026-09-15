const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function generateWXACode(params, retries = 2) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await cloud.openapi.wxacode.getUnlimited(params)
      if (res.buffer && res.buffer.length > 0) {
        return res.buffer
      }
      throw new Error('微信接口未返回小程序码图片数据')
    } catch (err) {
      lastErr = err
      console.warn(`[generateQRCode] 生成小程序码失败 (attempt ${i + 1})`, {
        errCode: err.errCode,
        errMsg: err.errMsg
      })
      // access_token 类错误通常重试可恢复
      if (i < retries) {
        await sleep(1000)
      }
    }
  }
  throw lastErr
}

/**
 * 临时云函数：生成小程序码并上传到云存储
 * 运行一次即可，拿到 fileID 后填入 pages/data/data.js 的 QR_CODE_FILE_ID
 */
exports.main = async (event, context) => {
  try {
    // 先生成带 page 参数的小程序码；若失败（如 access_token 未就绪）则降级为不带 page。
    let buffer
    const page = event.page || 'pages/index/index'
    const baseParams = {
      scene: event.scene || 'poster',
      width: event.width || 280,
      checkPath: false
    }

    try {
      buffer = await generateWXACode({ ...baseParams, page })
    } catch (errWithPage) {
      console.warn('[generateQRCode] 带 page 参数生成失败，尝试不带 page 生成', {
        errMsg: errWithPage.errMsg
      })
      buffer = await generateWXACode(baseParams)
    }

    // 上传到云存储固定路径，作为长期资源使用
    const cloudPath = event.cloudPath || 'assets/qr-code.png'
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: buffer
    })

    console.log('[generateQRCode] 小程序码已生成并上传', {
      fileID: uploadRes.fileID,
      cloudPath
    })

    return {
      code: 0,
      fileID: uploadRes.fileID,
      cloudPath
    }
  } catch (err) {
    console.error('[generateQRCode] 生成失败', {
      errCode: err.errCode,
      errMsg: err.errMsg,
      message: err.message,
      stack: err.stack
    })
    return {
      code: -1,
      msg: err.errMsg || err.message || '生成小程序码失败'
    }
  }
}
