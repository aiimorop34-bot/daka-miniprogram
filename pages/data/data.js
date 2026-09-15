const storage = require('../../utils/storage')
const evaluate = require('../../utils/evaluate')
const partner = require('../../utils/partner')
const syncQueue = require('../../utils/syncQueue')
const { createShareConfig } = require('../../utils/share')

// 海报底部小程序码图片的本地路径（以 / 开头，Canvas 2D createImage 需要绝对路径）。
const QR_CODE_IMAGE_PATH = '/images/poster-qrcode.jpg'

// 本地工具函数：计算正确率
function calcAccuracy(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

const CACHE_KEYS = {
  plans: 'data_page_plans',
  records: (planId) => `data_page_records_${planId}`
}

function getCache(key) {
  try {
    return wx.getStorageSync(key)
  } catch (e) {
    return null
  }
}

function setCache(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    console.error('[data] 缓存失败', key, e)
  }
}

// 热力图颜色（品牌墨绿色系，浅色背景版）
function getHeatColor(questions, isFuture) {
  if (isFuture) return '#F5F5F5'
  if (questions === 0) return '#EDEDEA'
  if (questions <= 20) return '#B4D9CE'
  if (questions <= 50) return '#7ABFAE'
  if (questions <= 100) return '#40A48D'
  return '#0F6E56'
}

// 按最大宽度自动换行（适用于中文文案）
function wrapText(ctx, text, maxWidth) {
  const lines = []
  let currentLine = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const testLine = currentLine + char
    const width = ctx.measureText(testLine).width

    if (width > maxWidth && currentLine.length > 0) {
      lines.push(currentLine)
      currentLine = char
    } else {
      currentLine = testLine
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine)
  }

  return lines
}

// 绘制数值+单位，自动缩放以适配最大宽度
function drawFittedValueWithUnit(ctx, value, unit, centerX, centerY, maxWidth) {
  let valueSize = 60
  let unitSize = 26
  let gap = 10

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  while (valueSize > 28) {
    ctx.font = `bold ${valueSize}px sans-serif`
    const valueWidth = ctx.measureText(value).width
    ctx.font = `bold ${unitSize}px sans-serif`
    const unitWidth = ctx.measureText(unit).width
    const totalWidth = valueWidth + gap + unitWidth

    if (totalWidth <= maxWidth) {
      const startX = centerX - totalWidth / 2

      ctx.font = `bold ${valueSize}px sans-serif`
      ctx.fillText(value, startX, centerY)

      ctx.font = `bold ${unitSize}px sans-serif`
      ctx.fillText(unit, startX + valueWidth + gap, centerY)
      return
    }

    valueSize -= 4
    unitSize -= 2
    gap = valueSize > 40 ? 10 : 6
  }

  ctx.font = `bold ${valueSize}px sans-serif`
  const valueWidth = ctx.measureText(value).width
  ctx.font = `bold ${unitSize}px sans-serif`
  const unitWidth = ctx.measureText(unit).width
  const totalWidth = valueWidth + gap + unitWidth
  const startX = centerX - totalWidth / 2

  ctx.font = `bold ${valueSize}px sans-serif`
  ctx.fillText(value, startX, centerY)

  ctx.font = `bold ${unitSize}px sans-serif`
  ctx.fillText(unit, startX + valueWidth + gap, centerY)
}

// 圆角矩形绘制（兼容性兜底）
function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

Page({
  ...createShareConfig({
    title: '看看我的刷题打卡数据',
    timelineTitle: '看看我的刷题打卡数据',
    path: '/pages/data/data'
  }),

  data: {
    plans: [],
    selectedPlanId: '',
    currentPlanName: '',
    records: [],
    isLoading: true,
    heatmapStatsText: '',
    selectedDateText: '',
    radarNoDataText: '',
    trendHintText: '',
    posterSaving: false,
    compareActiveTab: 'day',
    compareData: null,
    pendingCount: 0,
    failedCount: 0
  },

  canvasReady: false,
  rawRecords: [],
  heatmapGrid: null,
  heatmapCells: [],
  radarData: null,
  trendData: null,

  onLoad(options) {
    this.initialPlanId = options.planId || ''
  },

  onReady() {
    this.canvasReady = true
    this.tryDrawCharts()
  },

  async onShow() {
    this.setData({
      pendingCount: syncQueue.getPendingCount(),
      failedCount: syncQueue.getFailedCount()
    })
    const app = getApp()
    if (app.globalData.dataPlanId) {
      this.initialPlanId = app.globalData.dataPlanId
      app.globalData.dataPlanId = ''
    }
    await this.loadPlans()
  },

  async onSyncIndicatorTap() {
    const action = await syncQueue.showFailedRecordsModal()
    if (action === 'retry' || action === 'abandon') {
      if (action === 'abandon') {
        storage.clearOptimisticCaches()
      }
      this.setData({
        pendingCount: syncQueue.getPendingCount(),
        failedCount: syncQueue.getFailedCount()
      })
      if (action === 'retry') {
        const app = getApp()
        if (app && app.processPendingQueue) {
          app.processPendingQueue()
        }
      }
      // 重新加载数据，确保页面状态与队列一致
      await this.loadPlans()
    }
  },

  async loadPlans() {
    const cachedPlans = getCache(CACHE_KEYS.plans)
    const hasCache = Array.isArray(cachedPlans) && cachedPlans.length > 0

    if (hasCache) {
      this.renderPlansAndLoadRecords(cachedPlans, false)
    } else {
      this.setData({ isLoading: true })
    }

    try {
      const res = await partner.getPlans()
      if (res.code !== 0) {
        throw new Error(res.msg || '获取计划列表失败')
      }

      const plans = res.plans || []
      if (plans.length === 0) {
        this.setData({ plans: [], isLoading: false })
        setCache(CACHE_KEYS.plans, [])
        return
      }

      setCache(CACHE_KEYS.plans, plans)
      this.renderPlansAndLoadRecords(plans, true)
    } catch (err) {
      console.error('[data] 加载计划列表失败', err)
      if (!hasCache) {
        this.setData({ isLoading: false })
        wx.showToast({
          title: err.message || '加载计划失败',
          icon: 'none',
          duration: 2500
        })
      }
    }
  },

  renderPlansAndLoadRecords(plans, shouldReloadRecords) {
    let selectedPlanId = this.initialPlanId
    let selectedPlan = plans.find(p => p._id === selectedPlanId)

    if (!selectedPlan) {
      selectedPlan = plans.find(p => p.isDefault) || plans[0]
      selectedPlanId = selectedPlan._id
    }

    const planChanged = selectedPlanId !== this.data.selectedPlanId

    this.setData({
      plans,
      selectedPlanId,
      currentPlanName: selectedPlan.name || ''
    })

    // 只有当计划变化或明确要求刷新时，才重新加载记录
    if (planChanged || shouldReloadRecords || !this.rawRecords || this.rawRecords.length === 0) {
      this.loadRecords(selectedPlanId)
    }
  },

  async onPlanChange(e) {
    const planId = e.currentTarget.dataset.planId
    if (planId === this.data.selectedPlanId) return

    const plan = this.data.plans.find(p => p._id === planId)
    this.setData({
      selectedPlanId: planId,
      currentPlanName: plan ? plan.name : ''
    })

    await this.loadRecords(planId)
  },

  async loadRecords(planId) {
    const cacheKey = CACHE_KEYS.records(planId)
    const cachedRecords = getCache(cacheKey)
    const hasCache = Array.isArray(cachedRecords) && cachedRecords.length > 0

    if (hasCache) {
      this.renderRecords(planId, this.mergePendingRecords(cachedRecords, planId))
    }

    this.setData({ isLoading: !hasCache })

    try {
      const res = await partner.getCheckins(planId)
      if (res.code !== 0) {
        throw new Error(res.msg || '获取云端记录失败')
      }

      const rawRecords = res.records || []
      // 缓存云端原始记录；待同步记录由 mergePendingRecords 动态合并，避免重复
      setCache(cacheKey, rawRecords)
      this.renderRecords(planId, this.mergePendingRecords(rawRecords, planId))
    } catch (err) {
      console.error('[data] 加载云端记录失败', err)
      if (!hasCache) {
        this.setData({ isLoading: false })
        wx.showToast({
          title: err.message || '网络异常，请检查网络后重试',
          icon: 'none',
          duration: 2500
        })
      }
    }
  },

  mergePendingRecords(records, planId) {
    const pending = syncQueue.getPendingRecordsByPlan(planId)
    if (pending.length === 0) return records

    // 移除记录中已存在的本地待同步记录，避免重复合并
    const cleaned = records.filter(r => !(r.id && String(r.id).startsWith('local_')))

    pending.forEach(r => {
      cleaned.unshift({
        _id: r.id,
        id: r.id,
        date: r.date,
        timestamp: r.timestamp,
        planId: r.planId,
        subjects: r.subjects.map(s => ({
          name: s.name,
          total: Number(s.total || 0),
          correct: Number(s.correct || 0),
          accuracy: calcAccuracy(Number(s.correct || 0), Number(s.total || 0))
        }))
      })
    })

    return cleaned
  },

  renderRecords(planId, rawRecords) {
    this.rawRecords = rawRecords

    const records = rawRecords.map(r => {
      const subjects = r.subjects.map(s => ({
        ...s,
        accuracy: calcAccuracy(s.correct, s.total)
      }))

      let totalQ = 0
      let correctQ = 0
      subjects.forEach(s => {
        totalQ += s.total
        correctQ += s.correct
      })

      return {
        ...r,
        dateDisplay: storage.formatDateDisplay(r.date),
        subjects,
        totalQuestions: totalQ,
        totalCorrect: correctQ,
        overallAccuracy: calcAccuracy(correctQ, totalQ)
      }
    })

    const currentPlan = this.data.plans.find(p => p._id === planId)
    const planSubjects = currentPlan ? currentPlan.subjects.map(s => s.name) : []

    this.computeHeatmapData(rawRecords)
    this.computeRadarData(rawRecords, planSubjects)
    this.computeTrendData(rawRecords)
    this.computeCompareData(rawRecords)

    this.setData({
      records,
      isLoading: false,
      heatmapStatsText: this.heatmapStatsText,
      radarNoDataText: this.radarNoDataText,
      trendHintText: this.trendHintText,
      compareData: this.compareData
    })

    this.tryDrawCharts()
  },

  tryDrawCharts() {
    if (this.canvasReady && this.rawRecords.length > 0) {
      this.drawHeatmap()
      this.drawRadar()
      this.drawTrend()
    }
  },

  // ==================== 热力图 ====================

  computeHeatmapData(records) {
    const dateMap = {}
    records.forEach(r => {
      let total = 0
      r.subjects.forEach(s => total += s.total)
      dateMap[r.date] = (dateMap[r.date] || 0) + total
    })

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const dayOfWeek = today.getDay() || 7
    const startDate = new Date(today)
    startDate.setDate(today.getDate() - dayOfWeek + 1 - 11 * 7)

    this.heatmapGrid = []
    let checkinDays = 0
    let totalQuestions = 0

    for (let col = 0; col < 12; col++) {
      const week = []
      for (let row = 0; row < 7; row++) {
        const date = new Date(startDate)
        date.setDate(startDate.getDate() + col * 7 + row)
        const dateStr = storage.formatDate(date)
        const questions = dateMap[dateStr] || 0
        const isFuture = date > today

        week.push({
          date: dateStr,
          dateDisplay: storage.formatDateDisplay(dateStr),
          questions,
          isFuture,
          month: date.getMonth() + 1
        })

        if (!isFuture && questions > 0) {
          checkinDays++
          totalQuestions += questions
        }
      }
      this.heatmapGrid.push(week)
    }

    this.heatmapStatsText = `最近12周共打卡${checkinDays}天，总计${totalQuestions}题`
  },

  drawHeatmap() {
    if (!this.heatmapGrid) return

    const query = this.createSelectorQuery()
    query.select('#heatmapCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio
        const w = res[0].width
        const h = res[0].height

        canvas.width = w * dpr
        canvas.height = h * dpr
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, w, h)

        const leftPad = 34
        const topPad = 18
        const rightPad = 4
        const bottomPad = 4
        const cols = 12
        const rows = 7

        const availW = w - leftPad - rightPad
        const availH = h - topPad - bottomPad
        const cellPitchW = availW / cols
        const cellPitchH = availH / rows
        const cellSize = Math.min(cellPitchW, cellPitchH) - 3
        const gap = 3

        const gridW = cellSize * cols + gap * (cols - 1)
        const gridH = cellSize * rows + gap * (rows - 1)
        const offsetX = leftPad + (availW - gridW) / 2
        const offsetY = topPad + (availH - gridH) / 2

        this.heatmapCells = []

        ctx.font = '9px sans-serif'
        ctx.fillStyle = '#c7c7cc'
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        const labelRows = [0, 2, 4, 6]
        const labelTexts = ['一', '三', '五', '日']
        labelRows.forEach((row, i) => {
          const y = offsetY + row * (cellSize + gap) + cellSize / 2
          ctx.fillText(labelTexts[i], leftPad - 6, y)
        })

        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        let lastMonth = -1
        for (let col = 0; col < cols; col++) {
          const cell = this.heatmapGrid[col][0]
          if (cell.month !== lastMonth) {
            lastMonth = cell.month
            const x = offsetX + col * (cellSize + gap)
            ctx.fillText(cell.month + '月', x, 2)
          }
        }

        for (let col = 0; col < cols; col++) {
          for (let row = 0; row < rows; row++) {
            const cell = this.heatmapGrid[col][row]
            const x = offsetX + col * (cellSize + gap)
            const y = offsetY + row * (cellSize + gap)

            ctx.fillStyle = getHeatColor(cell.questions, cell.isFuture)
            drawRoundRect(ctx, x, y, cellSize, cellSize, 2)
            ctx.fill()

            this.heatmapCells.push({
              x, y, size: cellSize,
              date: cell.date,
              dateDisplay: cell.dateDisplay,
              questions: cell.questions,
              isFuture: cell.isFuture
            })
          }
        }
      })
  },

  onHeatmapTap(e) {
    if (!this.heatmapCells || this.heatmapCells.length === 0) return

    const touch = e.touches[0] || e.changedTouches[0]
    const query = this.createSelectorQuery()
    query.select('#heatmapCanvas')
      .boundingClientRect()
      .exec((res) => {
        if (!res[0]) return
        const rect = res[0]
        const tapX = touch.clientX - rect.left
        const tapY = touch.clientY - rect.top

        const cell = this.heatmapCells.find(c =>
          tapX >= c.x && tapX <= c.x + c.size &&
          tapY >= c.y && tapY <= c.y + c.size
        )

        if (cell && !cell.isFuture && cell.questions > 0) {
          const record = this.rawRecords.find(r => r.date === cell.date)
          let detailText = `${cell.dateDisplay} · ${cell.questions}题`
          if (record) {
            const subjectNames = record.subjects.map(s => s.name).join('、')
            let totalCorrect = 0
            let totalQ = 0
            record.subjects.forEach(s => {
              totalCorrect += s.correct
              totalQ += s.total
            })
            const acc = calcAccuracy(totalCorrect, totalQ)
            detailText = `${cell.dateDisplay} · ${subjectNames} · ${cell.questions}题 · 正确率${acc}%`
          }
          this.setData({ selectedDateText: detailText })
        } else {
          this.setData({ selectedDateText: '' })
        }
      })
  },

  // ==================== 雷达图 ====================

  computeRadarData(records, subjectNames) {
    const names = Array.isArray(subjectNames) && subjectNames.length > 0
      ? subjectNames
      : []

    if (names.length === 0) {
      this.radarData = []
      this.radarNoDataText = '该计划暂无板块数据'
      return
    }

    const subjectStats = names.map(name => {
      let totalAcc = 0
      let count = 0
      records.forEach(r => {
        r.subjects.forEach(s => {
          if (s.name === name && s.total > 0) {
            totalAcc += calcAccuracy(s.correct, s.total)
            count++
          }
        })
      })
      return {
        name,
        avgAccuracy: count > 0 ? Math.round(totalAcc / count) : 0,
        hasData: count > 0
      }
    })

    this.radarData = subjectStats
    const noDataNames = subjectStats.filter(s => !s.hasData).map(s => s.name)
    this.radarNoDataText = noDataNames.length > 0
      ? noDataNames.join('、') + '板块暂无数据'
      : ''
  },

  drawRadar() {
    if (!this.radarData || this.radarData.length === 0) return

    const query = this.createSelectorQuery()
    query.select('#radarCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio
        const w = res[0].width
        const h = res[0].height

        canvas.width = w * dpr
        canvas.height = h * dpr
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, w, h)

        const cx = w / 2
        const cy = h / 2
        const dims = this.radarData.length
        const angleStep = (Math.PI * 2) / dims
        const maxRadius = Math.min(w, h) / 2 - 44

        const vertices = []
        for (let i = 0; i < dims; i++) {
          const angle = -Math.PI / 2 + i * angleStep
          vertices.push({
            x: cx + maxRadius * Math.cos(angle),
            y: cy + maxRadius * Math.sin(angle),
            angle
          })
        }

        ctx.strokeStyle = '#e5e5ea'
        ctx.lineWidth = 0.5
        for (let level = 1; level <= 4; level++) {
          const r = (maxRadius * level) / 4
          ctx.beginPath()
          for (let i = 0; i <= dims; i++) {
            const angle = -Math.PI / 2 + (i % dims) * angleStep
            const x = cx + r * Math.cos(angle)
            const y = cy + r * Math.sin(angle)
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }

        for (let i = 0; i < dims; i++) {
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.lineTo(vertices[i].x, vertices[i].y)
          ctx.stroke()
        }

        const dataPoints = []
        ctx.beginPath()
        for (let i = 0; i < dims; i++) {
          const val = this.radarData[i].avgAccuracy / 100
          const r = maxRadius * val
          const x = cx + r * Math.cos(vertices[i].angle)
          const y = cy + r * Math.sin(vertices[i].angle)
          dataPoints.push({ x, y })
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.fillStyle = 'rgba(26, 26, 26, 0.12)'
        ctx.fill()
        ctx.strokeStyle = '#1a1a1a'
        ctx.lineWidth = 1.5
        ctx.stroke()

        ctx.fillStyle = '#1a1a1a'
        dataPoints.forEach(p => {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
          ctx.fill()
        })

        for (let i = 0; i < dims; i++) {
          const v = vertices[i]
          const labelR = maxRadius + 24
          const lx = cx + labelR * Math.cos(v.angle)
          const ly = cy + labelR * Math.sin(v.angle)

          const name = this.radarData[i].name
          const acc = this.radarData[i].avgAccuracy + '%'

          ctx.font = '11px sans-serif'
          ctx.fillStyle = '#8e8e93'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(name, lx, ly - 8)

          ctx.font = '10px sans-serif'
          ctx.fillStyle = this.radarData[i].hasData ? '#1a1a1a' : '#c7c7cc'
          ctx.fillText(acc, lx, ly + 8)
        }
      })
  },

  // ==================== 正确率趋势折线图 ====================

  computeTrendData(records) {
    const dateMap = {}
    records.forEach(r => {
      const date = r.date
      if (!dateMap[date]) {
        dateMap[date] = { total: 0, correct: 0 }
      }
      r.subjects.forEach(s => {
        dateMap[date].total += s.total
        dateMap[date].correct += s.correct
      })
    })

    const trend = Object.keys(dateMap)
      .map(date => ({
        date,
        dateDisplay: storage.formatDateDisplay(date),
        accuracy: calcAccuracy(dateMap[date].correct, dateMap[date].total),
        total: dateMap[date].total
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-30)

    this.trendData = trend
    this.trendHintText = trend.length < 3
      ? '打卡天数较少，继续坚持后可查看更完整的趋势'
      : ''
  },

  drawTrend() {
    if (!this.trendData || this.trendData.length === 0) return

    const query = this.createSelectorQuery()
    query.select('#trendCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio
        const w = res[0].width
        const h = res[0].height

        canvas.width = w * dpr
        canvas.height = h * dpr
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, w, h)

        const data = this.trendData
        const leftPad = 34
        const rightPad = 10
        const topPad = 20
        const bottomPad = 34

        const plotW = w - leftPad - rightPad
        const plotH = h - topPad - bottomPad
        const count = data.length

        const ySteps = 5
        ctx.strokeStyle = '#f0f0f0'
        ctx.lineWidth = 0.5
        ctx.fillStyle = '#c7c7cc'
        ctx.font = '9px sans-serif'
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'

        for (let i = 0; i < ySteps; i++) {
          const val = (i / (ySteps - 1)) * 100
          const y = topPad + plotH - (val / 100) * plotH
          ctx.beginPath()
          ctx.moveTo(leftPad, y)
          ctx.lineTo(leftPad + plotW, y)
          ctx.stroke()
          ctx.fillText(Math.round(val) + '%', leftPad - 6, y)
        }

        const points = data.map((item, index) => {
          const x = count === 1
            ? leftPad + plotW / 2
            : leftPad + (index / (count - 1)) * plotW
          const y = topPad + plotH - (item.accuracy / 100) * plotH
          return { x, y, ...item }
        })

        const gradient = ctx.createLinearGradient(0, topPad, 0, topPad + plotH)
        gradient.addColorStop(0, 'rgba(26, 26, 26, 0.10)')
        gradient.addColorStop(1, 'rgba(26, 26, 26, 0)')
        ctx.beginPath()
        ctx.moveTo(points[0].x, topPad + plotH)
        points.forEach(p => ctx.lineTo(p.x, p.y))
        ctx.lineTo(points[points.length - 1].x, topPad + plotH)
        ctx.closePath()
        ctx.fillStyle = gradient
        ctx.fill()

        ctx.beginPath()
        points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
        ctx.strokeStyle = '#1a1a1a'
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()

        ctx.fillStyle = '#1a1a1a'
        points.forEach(p => {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
          ctx.fill()
        })

        const maxLabels = 6
        const step = Math.max(1, Math.ceil(count / maxLabels))
        ctx.fillStyle = '#8e8e93'
        ctx.font = '9px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'

        points.forEach((p, i) => {
          if (i % step === 0 || i === count - 1) {
            ctx.fillText(p.dateDisplay, p.x, topPad + plotH + 8)
          }
        })
      })
  },

  // ==================== 自我对比 ====================

  onCompareTabChange(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ compareActiveTab: tab })
  },

  computeCompareData(records) {
    const dateMap = {}
    records.forEach(r => {
      if (!dateMap[r.date]) {
        dateMap[r.date] = { total: 0, correct: 0 }
      }
      r.subjects.forEach(s => {
        dateMap[r.date].total += s.total
        dateMap[r.date].correct += s.correct
      })
    })

    const now = new Date()
    const today = storage.formatDate(now)

    const result = {
      day: this.compareDay(dateMap, now, today),
      week: this.compareWeek(dateMap, now),
      month: this.compareMonth(dateMap, now)
    }

    this.compareData = result
  },

  aggregateRange(dateMap, startStr, endStr) {
    let total = 0
    let correct = 0
    let days = 0
    const start = new Date(startStr)
    const end = new Date(endStr)
    const d = new Date(start)

    while (d <= end) {
      const dateStr = storage.formatDate(new Date(d))
      const item = dateMap[dateStr]
      if (item) {
        total += item.total
        correct += item.correct
        days += 1
      }
      d.setDate(d.getDate() + 1)
    }

    return {
      total,
      correct,
      days,
      accuracy: calcAccuracy(correct, total)
    }
  },

  compareDay(dateMap, now, today) {
    const yesterdayDate = new Date(now)
    yesterdayDate.setDate(yesterdayDate.getDate() - 1)
    const yesterday = storage.formatDate(yesterdayDate)

    const current = this.aggregateRange(dateMap, today, today)
    const previous = this.aggregateRange(dateMap, yesterday, yesterday)

    if (current.days === 0 || previous.days === 0) {
      return {
        enough: false,
        emptyText: '数据积累中，昨天和今天都有打卡后就能看到对比啦'
      }
    }

    const diff = {
      questionDiff: current.total - previous.total,
      accuracyDiff: current.accuracy - previous.accuracy
    }

    return {
      enough: true,
      currentLabel: '今日',
      previousLabel: '昨日',
      current,
      previous,
      questionDiff: diff.questionDiff,
      accuracyDiff: diff.accuracyDiff,
      evalText: evaluate.compareEvaluation(diff)
    }
  },

  compareWeek(dateMap, now) {
    const dayOfWeek = now.getDay() || 7

    const thisWeekStart = new Date(now)
    thisWeekStart.setDate(now.getDate() - dayOfWeek + 1)
    const thisWeekEnd = new Date(now)

    const lastWeekStart = new Date(thisWeekStart)
    lastWeekStart.setDate(thisWeekStart.getDate() - 7)
    const lastWeekEnd = new Date(lastWeekStart)
    lastWeekEnd.setDate(lastWeekStart.getDate() + dayOfWeek - 1)

    const current = this.aggregateRange(dateMap, storage.formatDate(thisWeekStart), storage.formatDate(thisWeekEnd))
    const previous = this.aggregateRange(dateMap, storage.formatDate(lastWeekStart), storage.formatDate(lastWeekEnd))

    if (current.days === 0 || previous.days === 0) {
      return {
        enough: false,
        emptyText: '数据积累中，坚持满一周后就能看到对比啦'
      }
    }

    const diff = {
      questionDiff: current.total - previous.total,
      accuracyDiff: current.accuracy - previous.accuracy
    }

    return {
      enough: true,
      currentLabel: '本周',
      previousLabel: '上周',
      current,
      previous,
      questionDiff: diff.questionDiff,
      accuracyDiff: diff.accuracyDiff,
      evalText: evaluate.compareEvaluation(diff)
    }
  },

  compareMonth(dateMap, now) {
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const thisMonthEnd = new Date(now)

    const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
    const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1
    const lastMonthStart = new Date(lastMonthYear, lastMonth, 1)
    const lastMonthDays = new Date(lastMonthYear, lastMonth + 1, 0).getDate()
    const lastMonthDay = Math.min(now.getDate(), lastMonthDays)
    const lastMonthEnd = new Date(lastMonthYear, lastMonth, lastMonthDay)

    const current = this.aggregateRange(dateMap, storage.formatDate(thisMonthStart), storage.formatDate(thisMonthEnd))
    const previous = this.aggregateRange(dateMap, storage.formatDate(lastMonthStart), storage.formatDate(lastMonthEnd))

    if (current.days === 0 || previous.days === 0) {
      return {
        enough: false,
        emptyText: '数据积累中，坚持满一个月后就能看到对比啦'
      }
    }

    const diff = {
      questionDiff: current.total - previous.total,
      accuracyDiff: current.accuracy - previous.accuracy
    }

    return {
      enough: true,
      currentLabel: '本月',
      previousLabel: '上月',
      current,
      previous,
      questionDiff: diff.questionDiff,
      accuracyDiff: diff.accuracyDiff,
      evalText: evaluate.compareEvaluation(diff)
    }
  },

  // ==================== 删除记录 ====================

  async onDeleteRecord(e) {
    const record = e.currentTarget.dataset.record
    const isLocalPending = record._id === undefined && String(record.id || '').startsWith('local_')

    const confirmRes = await new Promise(resolve => {
      wx.showModal({
        title: '删除这条打卡记录？',
        content: '删除后无法恢复，包括对应的统计数据。',
        confirmText: '删除',
        confirmColor: '#A32D2D',
        cancelText: '取消',
        success: res => resolve(res.confirm)
      })
    })
    if (!confirmRes) return

    wx.showLoading({ title: '删除中...' })
    try {
      if (isLocalPending) {
        syncQueue.remove(record.id)
      } else {
        const res = await partner.deleteCheckin(record._id, this.data.selectedPlanId)
        if (res.code !== 0) throw new Error(res.msg || '删除失败')
      }
      storage.clearOptimisticCaches()
      await this.loadRecords(this.data.selectedPlanId)
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '删除失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // ==================== 分享海报 ====================

  onSharePoster() {
    if (this.data.posterSaving) return
    this.setData({ posterSaving: true })
    this.drawPoster((canvas) => {
      this.savePoster(canvas)
    })
  },

  drawPoster(callback) {
    const query = this.createSelectorQuery()
    query.select('#posterCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) {
          this.setData({ posterSaving: false })
          return
        }
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio
        const W = 750
        const H = 1334

        canvas.width = W * dpr
        canvas.height = H * dpr
        ctx.scale(dpr, dpr)

        ctx.fillStyle = '#FAFAF8'
        ctx.fillRect(0, 0, W, H)

        const marginX = 72
        const topY = 110

        ctx.fillStyle = '#0F6E56'
        ctx.fillRect(marginX, topY, 6, 58)

        ctx.fillStyle = '#1C1C1A'
        ctx.font = 'bold 56px sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText('刷题打卡', marginX + 22, topY - 4)

        ctx.fillStyle = '#1C1C1A'
        ctx.font = '24px sans-serif'
        ctx.fillText('每日刷题 · 坚持上岸', marginX + 22, topY + 66)

        const planName = this.data.currentPlanName || ''
        if (planName) {
          const tagText = `当前计划：${planName}`
          ctx.font = '22px sans-serif'
          const tagTextWidth = ctx.measureText(tagText).width
          const tagPaddingX = 16
          const tagH = 36
          const tagX = marginX + 22
          const tagY = topY + 108
          const tagW = tagTextWidth + tagPaddingX * 2

          ctx.fillStyle = '#E1F5EE'
          drawRoundRect(ctx, tagX, tagY, tagW, tagH, 18)
          ctx.fill()

          ctx.fillStyle = '#0F6E56'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(tagText, tagX + tagPaddingX, tagY + tagH / 2)
        }

        const dateSet = new Set()
        let totalQuestions = 0
        let totalCorrect = 0
        this.rawRecords.forEach(r => {
          dateSet.add(r.date)
          r.subjects.forEach(s => {
            totalQuestions += s.total
            totalCorrect += s.correct
          })
        })
        const totalDays = dateSet.size
        const overallAccuracy = calcAccuracy(totalCorrect, totalQuestions)

        const statsY = 290
        const stats = [
          { label: '累计打卡', value: String(totalDays), unit: '天' },
          { label: '累计做题', value: String(totalQuestions), unit: '题' },
          { label: '综合正确率', value: String(overallAccuracy), unit: '%' }
        ]
        const cardW = 186
        const gap = 18
        const startX = (W - (cardW * 3 + gap * 2)) / 2

        stats.forEach((stat, i) => {
          const x = startX + i * (cardW + gap)

          ctx.fillStyle = '#FFFFFF'
          drawRoundRect(ctx, x, statsY, cardW, 200, 16)
          ctx.fill()

          ctx.lineWidth = 1
          ctx.strokeStyle = '#E8E8E6'
          drawRoundRect(ctx, x, statsY, cardW, 200, 16)
          ctx.stroke()

          ctx.fillStyle = '#0F6E56'
          ctx.beginPath()
          ctx.moveTo(x + 16, statsY)
          ctx.lineTo(x + cardW - 16, statsY)
          ctx.lineTo(x + cardW - 28, statsY + 4)
          ctx.lineTo(x + 28, statsY + 4)
          ctx.closePath()
          ctx.fill()

          ctx.fillStyle = '#1C1C1A'
          const centerY = statsY + 92
          drawFittedValueWithUnit(ctx, stat.value, stat.unit, x + cardW / 2, centerY, cardW - 24)

          ctx.fillStyle = '#1C1C1A'
          ctx.font = '22px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(stat.label, x + cardW / 2, statsY + 156)
        })

        let currentY = statsY + 250
        ctx.fillStyle = '#1C1C1A'
        ctx.font = 'bold 32px sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText('最近 12 周打卡热力', marginX, currentY)

        ctx.fillStyle = '#1C1C1A'
        ctx.font = '20px sans-serif'
        ctx.fillText('颜色越深，刷题越多', marginX, currentY + 44)

        const legendX = W - marginX
        const legendColors = ['#EDEDEA', '#B4D9CE', '#7ABFAE', '#40A48D', '#0F6E56']
        const legendSize = 18
        legendColors.forEach((color, i) => {
          ctx.fillStyle = color
          drawRoundRect(ctx, legendX - (5 - i) * (legendSize + 6), currentY + 14, legendSize, legendSize, 3)
          ctx.fill()
        })

        currentY += 110
        if (this.heatmapGrid) {
          const cellSize = 20
          const cellGap = 4
          const cols = 12
          const rows = 7
          const gridW = cols * cellSize + (cols - 1) * cellGap
          const offsetX = (W - gridW) / 2

          for (let col = 0; col < cols; col++) {
            for (let row = 0; row < rows; row++) {
              const cell = this.heatmapGrid[col][row]
              const x = offsetX + col * (cellSize + cellGap)
              const y = currentY + row * (cellSize + cellGap)
              ctx.fillStyle = getHeatColor(cell.questions, cell.isFuture)
              drawRoundRect(ctx, x, y, cellSize, cellSize, 3)
              ctx.fill()
            }
          }

          ctx.fillStyle = '#1C1C1A'
          ctx.font = '16px sans-serif'
          ctx.textAlign = 'right'
          ctx.textBaseline = 'middle'
          const labelRows = [0, 2, 4, 6]
          const labelTexts = ['一', '三', '五', '日']
          labelRows.forEach((row, i) => {
            const y = currentY + row * (cellSize + cellGap) + cellSize / 2
            ctx.fillText(labelTexts[i], offsetX - 12, y)
          })

          currentY += rows * (cellSize + cellGap) + 50
        }

        const latest = this.rawRecords.length > 0 ? this.rawRecords[0] : null
        const evalData = evaluate.getEvaluationToday(latest, this.rawRecords, this.data.selectedPlanId) || this.getOverallEvaluation()
        if (evalData) {
          currentY += 24
          const quoteCardX = marginX
          const quoteCardW = W - marginX * 2
          const evalTextX = quoteCardX + 96
          const evalMaxWidth = quoteCardW - 96 - 40
          const evalLineHeight = 44
          const evalMaxLines = 3

          ctx.font = 'bold 30px sans-serif'
          const evalLines = wrapText(ctx, evalData.text, evalMaxWidth)
          const evalDisplayLines = evalLines.slice(0, evalMaxLines)
          const quoteCardH = Math.max(156, 28 + evalDisplayLines.length * evalLineHeight + 28)

          ctx.fillStyle = '#E1F5EE'
          drawRoundRect(ctx, quoteCardX, currentY, quoteCardW, quoteCardH, 16)
          ctx.fill()

          ctx.lineWidth = 1
          ctx.strokeStyle = '#D4EDE4'
          drawRoundRect(ctx, quoteCardX, currentY, quoteCardW, quoteCardH, 16)
          ctx.stroke()

          ctx.fillStyle = '#0F6E56'
          drawRoundRect(ctx, quoteCardX + 20, currentY + 28, 4, quoteCardH - 56, 2)
          ctx.fill()

          ctx.font = '44px sans-serif'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillText(evalData.emoji, quoteCardX + 40, currentY + 28)

          ctx.fillStyle = '#1C1C1A'
          ctx.font = 'bold 30px sans-serif'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          evalDisplayLines.forEach((line, i) => {
            ctx.fillText(line, evalTextX, currentY + 36 + i * evalLineHeight)
          })

          currentY += quoteCardH + 50
        }

        ctx.fillStyle = '#1C1C1A'
        ctx.font = '22px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('和我一起刷题打卡', W / 2, H - 120)

        this.drawPosterQRCode(canvas, ctx, () => {
          if (callback) callback(canvas)
        })
      })
  },

  drawPosterQRCodeCard(ctx) {
    // 底部小程序码白色卡片背景（比原 80x80 稍大）
    const x = 750 / 2 - 50
    const y = 1334 - 230
    const size = 100
    ctx.fillStyle = '#ffffff'
    drawRoundRect(ctx, x, y, size, size, 12)
    ctx.fill()

    ctx.lineWidth = 1
    ctx.strokeStyle = '#E8E8E6'
    drawRoundRect(ctx, x, y, size, size, 12)
    ctx.stroke()
    return { x, y, size, padding: 8 }
  },

  drawPosterQRCodePlaceholder(ctx) {
    const { x, y, size, padding } = this.drawPosterQRCodeCard(ctx)
    const innerSize = size - padding * 2
    const innerX = x + padding
    const innerY = y + padding

    // 内部浅灰占位块
    ctx.fillStyle = '#f2f2f2'
    drawRoundRect(ctx, innerX, innerY, innerSize, innerSize, 8)
    ctx.fill()

    ctx.fillStyle = '#999999'
    ctx.font = '16px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('小程序码', 750 / 2, innerY + innerSize / 2 - 8)
    ctx.font = '12px sans-serif'
    ctx.fillText('(待完善)', 750 / 2, innerY + innerSize / 2 + 10)
  },

  drawPosterQRCode(canvas, ctx, callback) {
    const { x, y, size, padding } = this.drawPosterQRCodeCard(ctx)
    const innerSize = size - padding * 2
    const innerX = x + padding
    const innerY = y + padding

    const img = canvas.createImage()
    img.src = QR_CODE_IMAGE_PATH
    img.onload = () => {
      // 在白色卡片内绘制圆角小程序码
      ctx.save()
      ctx.beginPath()
      drawRoundRect(ctx, innerX, innerY, innerSize, innerSize, 8)
      ctx.clip()
      ctx.drawImage(img, innerX, innerY, innerSize, innerSize)
      ctx.restore()
      if (callback) callback(canvas)
    }
    img.onerror = (err) => {
      console.error('[drawPoster] 小程序码图片加载失败', err)
      this.drawPosterQRCodePlaceholder(ctx)
      if (callback) callback(canvas)
    }
  },

  getOverallEvaluation() {
    if (this.rawRecords.length === 0) return null
    const latest = this.rawRecords[0]
    return evaluate.evaluate(latest, this.rawRecords)
  },

  savePoster(canvas) {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width: 750,
      height: 1334,
      destWidth: 750,
      destHeight: 1334,
      fileType: 'png',
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => {
            wx.showToast({ title: '已保存到相册', icon: 'success' })
          },
          fail: (err) => {
            const msg = err.errMsg || ''
            if (msg.includes('auth deny') || msg.includes('fail auth') || msg.includes('authorize')) {
              wx.showModal({
                title: '需要相册权限',
                content: '请前往设置开启「保存到相册」权限，才能保存海报',
                showCancel: false,
                confirmText: '知道了'
              })
            } else {
              wx.showToast({ title: '保存失败，请重试', icon: 'none' })
            }
          },
          complete: () => {
            this.setData({ posterSaving: false })
          }
        })
      },
      fail: () => {
        this.setData({ posterSaving: false })
        wx.showToast({ title: '海报生成失败', icon: 'none' })
      }
    })
  }
})
