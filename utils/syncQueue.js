/**
 * 打卡记录待同步队列
 * 用于乐观更新：本地立即保存，后台异步同步到云端
 */

const QUEUE_KEY = 'pending_checkin_queue'
const MAX_RETRIES = 10

function getQueue() {
  try {
    const q = wx.getStorageSync(QUEUE_KEY)
    if (Array.isArray(q)) return q
  } catch (e) {
    console.error('[syncQueue] 读取队列失败', e)
  }
  return []
}

function setQueue(queue) {
  try {
    wx.setStorageSync(QUEUE_KEY, queue)
  } catch (e) {
    console.error('[syncQueue] 写入队列失败', e)
  }
}

function generateId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function add(record) {
  const item = {
    id: generateId(),
    record,
    status: 'pending',
    retryCount: 0,
    lastError: '',
    createdAt: Date.now()
  }
  const queue = getQueue()
  queue.push(item)
  setQueue(queue)
  return item
}

function remove(id) {
  const queue = getQueue().filter(item => item.id !== id)
  setQueue(queue)
}

function updateItem(id, updater) {
  const queue = getQueue()
  const idx = queue.findIndex(item => item.id === id)
  if (idx >= 0) {
    updater(queue[idx])
    setQueue(queue)
    return queue[idx]
  }
  return null
}

function markSyncing(id) {
  return updateItem(id, item => {
    item.status = 'syncing'
  })
}

/**
 * 标记为可重试失败（仍保持 pending 状态，retryCount +1）
 */
function markFailed(id, error) {
  return updateItem(id, item => {
    item.status = 'pending'
    item.retryCount += 1
    item.lastError = typeof error === 'string' ? error : (error && error.message) || '未知错误'
  })
}

/**
 * 标记为长期失败（不再自动重试）
 */
function markPermanentlyFailed(id, error) {
  return updateItem(id, item => {
    item.status = 'failed'
    item.lastError = typeof error === 'string' ? error : (error && error.message) || '超过最大重试次数'
  })
}

/**
 * 将 failed 状态记录重置为 pending，重新进入自动重试流程
 */
function retryFailed(id) {
  return updateItem(id, item => {
    if (item.status === 'failed') {
      item.status = 'pending'
      item.retryCount = 0
      item.lastError = ''
    }
  })
}

/**
 * 放弃某条 failed 记录
 */
function abandon(id) {
  const queue = getQueue().filter(item => item.id !== id)
  setQueue(queue)
}

function getPendingItems() {
  return getQueue().filter(item => item.status === 'pending')
}

function getSyncingItems() {
  return getQueue().filter(item => item.status === 'syncing')
}

function getFailedItems() {
  return getQueue().filter(item => item.status === 'failed')
}

function getAllItems() {
  return getQueue()
}

function getPendingCount() {
  return getPendingItems().length
}

function getFailedCount() {
  return getFailedItems().length
}

function hasPending() {
  return getPendingCount() > 0
}

function hasFailed() {
  return getFailedCount() > 0
}

function clear() {
  setQueue([])
}

/**
 * 获取某个计划下所有待同步的打卡记录（含 pending/syncing/failed）
 */
function getPendingRecordsByPlan(planId) {
  return getQueue()
    .filter(item => item.record.planId === planId)
    .map(item => item.record)
}

/**
 * 重试所有 failed 记录
 */
function retryAllFailed() {
  const queue = getQueue()
  queue.forEach(item => {
    if (item.status === 'failed') {
      item.status = 'pending'
      item.retryCount = 0
      item.lastError = ''
    }
  })
  setQueue(queue)
}

/**
 * 放弃所有 failed 记录
 */
function abandonAllFailed() {
  const queue = getQueue().filter(item => item.status !== 'failed')
  setQueue(queue)
}

/**
 * 展示失败记录处理弹窗
 * @returns {Promise<'retry'|'abandon'|'none'|'cancel'>}
 */
function showFailedRecordsModal() {
  const failed = getFailedItems()
  if (failed.length === 0) return Promise.resolve('none')

  return new Promise((resolve) => {
    wx.showActionSheet({
      title: `有 ${failed.length} 条打卡记录同步失败`,
      itemList: ['重试同步', '放弃本地记录（数据将丢失）'],
      success(res) {
        if (res.tapIndex === 0) {
          retryAllFailed()
          resolve('retry')
        } else if (res.tapIndex === 1) {
          abandonAllFailed()
          resolve('abandon')
        }
      },
      fail() {
        resolve('cancel')
      }
    })
  })
}

module.exports = {
  QUEUE_KEY,
  MAX_RETRIES,
  add,
  remove,
  markSyncing,
  markFailed,
  markPermanentlyFailed,
  retryFailed,
  abandon,
  getPendingItems,
  getSyncingItems,
  getFailedItems,
  getAllItems,
  getPendingCount,
  getFailedCount,
  hasPending,
  hasFailed,
  clear,
  getPendingRecordsByPlan,
  retryAllFailed,
  abandonAllFailed,
  showFailedRecordsModal
}
