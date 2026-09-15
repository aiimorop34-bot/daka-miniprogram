/**
 * 生成 tabBar 所需的图标 PNG 文件
 * 运行: node generate-icons.js
 */
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const SIZE = 81

function createPNG(pixels) {
  // 构建 PNG 文件
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(SIZE, 0)  // width
  ihdrData.writeUInt32BE(SIZE, 4)  // height
  ihdrData[8] = 8   // bit depth
  ihdrData[9] = 6   // color type (RGBA)
  ihdrData[10] = 0  // compression
  ihdrData[11] = 0  // filter
  ihdrData[12] = 0  // interlace
  const ihdr = createChunk('IHDR', ihdrData)

  // IDAT
  const rawData = Buffer.alloc(SIZE * (1 + SIZE * 4))
  for (let y = 0; y < SIZE; y++) {
    rawData[y * (1 + SIZE * 4)] = 0 // filter none
    for (let x = 0; x < SIZE; x++) {
      const idx = y * (1 + SIZE * 4) + 1 + x * 4
      const pixelIdx = (y * SIZE + x) * 4
      rawData[idx] = pixels[pixelIdx]       // R
      rawData[idx + 1] = pixels[pixelIdx + 1] // G
      rawData[idx + 2] = pixels[pixelIdx + 2] // B
      rawData[idx + 3] = pixels[pixelIdx + 3] // A
    }
  }
  const compressed = zlib.deflateSync(rawData)
  const idat = createChunk('IDAT', compressed)

  // IEND
  const iend = createChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

function createChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crcData = Buffer.concat([typeBuffer, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcData), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function crc32(data) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// 绘制圆角矩形
function drawRoundedRect(pixels, x, y, w, h, r, color) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      let inside = true
      if (px < x + r && py < y + r) {
        const dx = px - (x + r), dy = py - (y + r)
        inside = dx * dx + dy * dy <= r * r
      } else if (px >= x + w - r && py < y + r) {
        const dx = px - (x + w - r - 1), dy = py - (y + r)
        inside = dx * dx + dy * dy <= r * r
      } else if (px < x + r && py >= y + h - r) {
        const dx = px - (x + r), dy = py - (y + h - r - 1)
        inside = dx * dx + dy * dy <= r * r
      } else if (px >= x + w - r && py >= y + h - r) {
        const dx = px - (x + w - r - 1), dy = py - (y + h - r - 1)
        inside = dx * dx + dy * dy <= r * r
      }
      if (inside) {
        const idx = (py * SIZE + px) * 4
        pixels[idx] = color[0]
        pixels[idx + 1] = color[1]
        pixels[idx + 2] = color[2]
        pixels[idx + 3] = color[3]
      }
    }
  }
}

// 填充整个画布
function fillAll(pixels, color) {
  for (let i = 0; i < SIZE * SIZE * 4; i += 4) {
    pixels[i] = color[0]
    pixels[i + 1] = color[1]
    pixels[i + 2] = color[2]
    pixels[i + 3] = color[3]
  }
}

// 绘制对勾
function drawCheckmark(pixels, cx, cy, size, color, strokeWidth) {
  // 对勾路径
  const startX = cx - size * 0.3
  const startY = cy
  const midX = cx - size * 0.05
  const midY = cy + size * 0.35
  const endX = cx + size * 0.4
  const endY = cy - size * 0.35

  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const dist1 = distToSegment(px, py, startX, startY, midX, midY)
      const dist2 = distToSegment(px, py, midX, midY, endX, endY)
      if (dist1 < strokeWidth || dist2 < strokeWidth) {
        const idx = (py * SIZE + px) * 4
        pixels[idx] = color[0]
        pixels[idx + 1] = color[1]
        pixels[idx + 2] = color[2]
        pixels[idx + 3] = color[3]
      }
    }
  }
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.sqrt((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2)
}

// 绘制柱状图
function drawBars(pixels, color, strokeWidth) {
  const bars = [
    { x: 18, w: 10, h: 20 },
    { x: 33, w: 10, h: 32 },
    { x: 48, w: 10, h: 16 },
  ]
  bars.forEach(bar => {
    const y = 60 - bar.h
    drawRoundedRect(pixels, bar.x, y, bar.w, bar.h, 2, color)
  })
  // 底部横线
  for (let x = 16; x < 66; x++) {
    for (let t = 0; t < strokeWidth; t++) {
      const idx = ((60 + t) * SIZE + x) * 4
      pixels[idx] = color[0]
      pixels[idx + 1] = color[1]
      pixels[idx + 2] = color[2]
      pixels[idx + 3] = color[3]
    }
  }
}

// 绘制用户头像轮廓
function drawUser(pixels, color) {
  // 头部圆形
  const headCx = SIZE / 2
  const headCy = 30
  const headR = 12
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const dx = px - headCx
      const dy = py - headCy
      if (dx * dx + dy * dy <= headR * headR) {
        const idx = (py * SIZE + px) * 4
        pixels[idx] = color[0]
        pixels[idx + 1] = color[1]
        pixels[idx + 2] = color[2]
        pixels[idx + 3] = color[3]
      }
    }
  }
  // 身体半圆
  const bodyCx = SIZE / 2
  const bodyCy = 78
  const bodyRx = 22
  const bodyRy = 22
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const dx = px - bodyCx
      const dy = py - bodyCy
      if (dy <= 0 && (dx * dx) / (bodyRx * bodyRx) + (dy * dy) / (bodyRy * bodyRy) <= 1) {
        const idx = (py * SIZE + px) * 4
        pixels[idx] = color[0]
        pixels[idx + 1] = color[1]
        pixels[idx + 2] = color[2]
        pixels[idx + 3] = color[3]
      }
    }
  }
}

// 创建图标
function createIcon(type, colorHex) {
  const pixels = new Uint8Array(SIZE * SIZE * 4)
  fillAll(pixels, [0, 0, 0, 0]) // 透明背景

  const r = parseInt(colorHex.slice(1, 3), 16)
  const g = parseInt(colorHex.slice(3, 5), 16)
  const b = parseInt(colorHex.slice(5, 7), 16)

  if (type === 'checkin') {
    drawCheckmark(pixels, SIZE / 2, SIZE / 2, 40, [r, g, b, 255], 4.5)
  } else if (type === 'data') {
    drawBars(pixels, [r, g, b, 255], 3)
  } else if (type === 'me') {
    drawUser(pixels, [r, g, b, 255])
  }

  return createPNG(pixels)
}

const imagesDir = path.join(__dirname, 'images')
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir)
}

// 生成图标: 未选中浅灰，选中深黑
const icons = [
  { name: 'tab-checkin.png', type: 'checkin', color: '#999999' },
  { name: 'tab-checkin-active.png', type: 'checkin', color: '#1a1a1a' },
  { name: 'tab-data.png', type: 'data', color: '#999999' },
  { name: 'tab-data-active.png', type: 'data', color: '#1a1a1a' },
  { name: 'tab-me.png', type: 'me', color: '#999999' },
  { name: 'tab-me-active.png', type: 'me', color: '#1a1a1a' },
]

icons.forEach(icon => {
  const png = createIcon(icon.type, icon.color)
  fs.writeFileSync(path.join(imagesDir, icon.name), png)
  console.log(`Created: ${icon.name}`)
})

console.log('All icons generated.')
