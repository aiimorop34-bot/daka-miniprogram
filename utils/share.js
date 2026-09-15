// 统一的分享配置辅助函数
// 在微信小程序中，页面必须显式定义 onShareAppMessage / onShareTimeline 才能启用分享。

function createShareConfig(options = {}) {
  const title = options.title || '刷题打卡'
  const timelineTitle = options.timelineTitle || title
  const path = options.path || '/pages/index/index'
  const query = options.query || ''
  const imageUrl = options.imageUrl || ''

  return {
    onShareAppMessage() {
      return {
        title,
        path,
        imageUrl
      }
    },

    onShareTimeline() {
      return {
        title: timelineTitle,
        query,
        imageUrl
      }
    }
  }
}

module.exports = {
  createShareConfig
}
