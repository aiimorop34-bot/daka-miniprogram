const syncQueue = require('./utils/syncQueue')

App({
  globalData: {
    openid: '',
    currentPlanId: '',
    dataPlanId: ''
  },

  onLaunch() {
    // 初始化云开发
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-d7gpnp3x446609eb0', // 请替换为你的云开发环境 ID
        traceUser: true
      })
      this.getUserOpenid()
    } else {
      console.warn('当前基础库版本不支持云开发')
    }

    this.processPendingQueue()
  },

  onShow() {
    this.processPendingQueue()
  },

  getUserOpenid() {
    wx.cloud.callFunction({
      name: 'getOpenid'
    }).then(res => {
      this.globalData.openid = res.result.openid || ''
      this.ensureDefaultPlan()
    }).catch(err => {
      console.error('获取 openid 失败', err)
    })
  },

  // 确保用户存在默认打卡计划，仅获取 planId 并缓存到内存
  ensureDefaultPlan() {
    const storage = require('./utils/storage')

    wx.cloud.callFunction({
      name: 'ensureDefaultPlan'
    }).then(res => {
      const result = res.result || {}
      if (result.code !== 0 || !result.planId) {
        console.error('确保默认计划失败', result)
        return
      }

      const planId = result.planId
      this.globalData.currentPlanId = planId
      storage.setCurrentPlanId(planId)
      console.log('[app] 默认计划 ID', planId)
    }).catch(err => {
      console.error('确保默认计划失败', err)
    })
  },

  /**
   * 处理待同步的打卡记录
   * 在 app 启动/回到前台时自动重试，失败则保留队列等待下次
   */
  processPendingQueue() {
    const pending = syncQueue.getPendingItems()
    if (pending.length === 0) return

    console.log('[app] 发现待同步记录', pending.length)

    const storage = require('./utils/storage')

    const processNext = () => {
      const items = syncQueue.getPendingItems()
      const item = items[0]
      if (!item) return

      if (item.retryCount >= syncQueue.MAX_RETRIES) {
        console.warn('[app] 待同步记录超过最大重试次数，标记为失败', item.id)
        syncQueue.markPermanentlyFailed(item.id, '超过最大重试次数')
        processNext()
        return
      }

      syncQueue.markSyncing(item.id)

      wx.cloud.callFunction({
        name: 'saveCheckin',
        data: { record: item.record }
      }).then(res => {
        const result = res.result || {}
        if (result.code === 0) {
          syncQueue.remove(item.id)
          storage.updateCachesWithRealResult(item.record.planId, result)
        } else {
          throw new Error(result.msg || '同步失败')
        }
      }).catch(err => {
        console.error('[app] 同步待处理记录失败', item.id, err)
        syncQueue.markFailed(item.id, err.message || String(err))
      }).finally(() => {
        setTimeout(processNext, 300)
      })
    }

    processNext()
  }
})
