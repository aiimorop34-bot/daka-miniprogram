const partner = require('../../utils/partner')
const storage = require('../../utils/storage')
const app = getApp()

const CACHE_KEY = 'partner_rank_list'

function getCache() {
  try {
    return wx.getStorageSync(CACHE_KEY) || null
  } catch (e) {
    return null
  }
}

function setCache(value) {
  try {
    wx.setStorageSync(CACHE_KEY, value)
  } catch (e) {
    console.error('排行榜缓存失败', e)
  }
}

function calcAccuracy(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

Page({
  data: {
    sortBy: 'weekTotal', // weekTotal | weekAccuracy | streak
    sortOptions: [
      { key: 'weekTotal', label: '本周做题量' },
      { key: 'weekAccuracy', label: '本周正确率' },
      { key: 'streak', label: '连续打卡' }
    ],
    list: [],
    myOpenid: '',
    isLoading: true,
    hasPartners: false
  },

  onShow() {
    this.loadRank()
  },

  onSortChange(e) {
    const sortBy = e.currentTarget.dataset.key
    this.setData({ sortBy })
    this.sortList()
  },

  async getOpenid() {
    if (app.globalData.openid) {
      return app.globalData.openid
    }
    const res = await wx.cloud.callFunction({ name: 'getOpenid' })
    const openid = res.result.openid || ''
    app.globalData.openid = openid
    return openid
  },

  async loadRank() {
    const cachedList = getCache()
    const hasCache = cachedList && cachedList.length > 0

    // 1. 先展示缓存，用户不必对着空白页等待
    if (hasCache) {
      this.setData({
        list: cachedList,
        hasPartners: cachedList.length > 1,
        isLoading: false
      }, () => {
        this.sortList()
      })
    } else {
      this.setData({ isLoading: true })
    }

    try {
      const openid = await this.getOpenid()
      this.setData({ myOpenid: openid })

      const userInfo = partner.getUserInfo()
      const myStats = await this.buildMyStats(openid, userInfo)

      const res = await partner.syncAndGetStats(myStats)
      if (res.code !== 0) {
        throw new Error(res.msg)
      }

      // 内容安全检测有字段被拦截时给出友好提示，但不影响榜单展示
      if (res.warning) {
        wx.showToast({ title: res.warning, icon: 'none', duration: 3000 })
      }

      const allList = [res.myStats, ...(res.partnerStats || [])]
      const hasPartners = (res.partnerStats || []).length > 0

      // 2. 静默更新列表并写入缓存
      this.setData({
        list: allList,
        hasPartners,
        isLoading: false
      }, () => {
        this.sortList()
      })

      setCache(allList)
    } catch (err) {
      console.error('加载伙伴榜失败', err)
      this.setData({ isLoading: false })
      // 3. 只有完全没有缓存时才提示失败
      if (!hasCache) {
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    }
  },

  async buildMyStats(openid, userInfo) {
    // 统计数据改为由 syncAndGetStats 云函数在服务端汇总所有计划后返回
    return {
      openid,
      nickname: userInfo.nickname || '我',
      avatarUrl: userInfo.avatarUrl || ''
    }
  },

  sortList() {
    const { sortBy, list } = this.data
    const sorted = [...list].sort((a, b) => {
      if (sortBy === 'weekAccuracy') {
        return (b.weekAccuracy || 0) - (a.weekAccuracy || 0)
      }
      if (sortBy === 'streak') {
        return (b.streak || 0) - (a.streak || 0)
      }
      return (b.weekTotal || 0) - (a.weekTotal || 0)
    })

    const ranked = sorted.map((item, index) => ({
      ...item,
      rank: index + 1
    }))

    this.setData({ list: ranked })
  },

  onAddPartner() {
    wx.navigateTo({
      url: '/pages/add-partner/add-partner'
    })
  }
})