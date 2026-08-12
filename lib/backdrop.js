import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { loadConfig } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BG_DIR = join(__dirname, '..', 'data', 'img', 'bg')
const PLUGIN_PATH = '../../../../../plugins/NCM-plugin'
const BG_CACHE_TTL = 30 * 1000

/**
 * 从图片二进制数据解析宽高（支持 PNG/JPEG/GIF/WebP）
 */
function getImageSize(buffer) {
  try {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
    if (buf.length < 26) return null
    // PNG: 89 50 4E 47，宽高在 16-24 字节
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    // GIF: 47 49 46，宽高在 6-10 字节（小端）
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    }
    // WebP: RIFF....WEBP，VP8/VP8L/VP8X 格式
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fmt = buf.toString('ascii', 12, 16)
      if (fmt === 'VP8X') {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
      }
      if (fmt === 'VP8 ') {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      }
      if (fmt === 'VP8L') {
        const b = buf.readUInt32LE(21)
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
      }
    }
    // JPEG: FF D8，遍历 SOF 段
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2
      while (offset < buf.length - 9) {
        if (buf[offset] !== 0xff) { offset++; continue }
        const marker = buf[offset + 1]
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) }
        }
        offset += 2 + buf.readUInt16BE(offset + 2)
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 判断是否为横图（宽高比 ≥ 1.2）
 */
function toLandscape(size) {
  return !!(size && size.width > 0 && size.height > 0 && size.width / size.height >= 1.2)
}

/**
 * 获取背景图
 * 优先级：远程API/直链（配置 style.backdrop）→ 本地随机 → 渐变兜底（返回空 data）
 * 远程图片统一转为 PNG 格式 base64（无损，且便于 #原图 功能回发）
 * 所有来源均检测实际横竖比例，供模板自适应布局
 *
 * @returns {Promise<{ data: string, isLandscape: boolean }>}
 *   data 为 data:image/png;base64,... 或 本地图片路径 或 空字符串（渐变兜底）
 */
export async function getBackground() {
  const config = loadConfig()
  const { backdrop, backdropDefault, backdropTimeout } = config.style || {}

  // 1. 远程 API / 图片直链
  if (backdrop) {
    try {
      return await fetchRemoteBackdrop(backdrop, backdropTimeout || 5000)
    } catch (err) {
      if (err.name === 'AbortError') err.message = '请求超时'
      logger.warn('[NCM-plugin] 远程背景图获取失败，回退本地背景图，错误: ' + err.message)
    }
  }

  // 2. 本地背景图（随机或指定）
  const local = getLocalBackdrop(backdropDefault)
  if (local.path) {
    if (!backdrop) {
      logger.info('[NCM-plugin] 使用本地背景图 ' + local.fileName + (local.isLandscape ? '（横图）' : '（竖图）'))
    } else {
      logger.info('[NCM-plugin] 回退本地背景图 ' + local.fileName + (local.isLandscape ? '（横图）' : '（竖图）'))
    }
    return { data: local.path, isLandscape: local.isLandscape }
  }

  // 3. 渐变兜底（模板内置渐变背景）
  logger.warn('[NCM-plugin] 无可用背景图，使用渐变兜底背景')
  return { data: '', isLandscape: false }
}

/**
 * 请求远程背景图并转为 PNG base64
 */
async function fetchRemoteBackdrop(url, timeout) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const startTime = Date.now()

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'NCM-plugin/1.0' }
    })
    if (!response.ok) throw new Error('HTTP ' + response.status)

    const raw = Buffer.from(await response.arrayBuffer())
    if (raw.length < 26) throw new Error('响应数据过小，非有效图片')

    // 统一转为 PNG（无损，保留原图质量；同时规范化格式便于 #原图 回发）
    let png
    try {
      png = await sharp(raw).png().toBuffer()
    } catch {
      throw new Error('图片解码失败（响应可能不是有效图片）')
    }

    const elapsed = Date.now() - startTime
    const sizeKB = (png.length / 1024).toFixed(2)
    const size = getImageSize(png)
    const isLandscape = toLandscape(size)
    logger.info('[NCM-plugin] 远程背景图 ' + sizeKB + 'KB ' + elapsed + 'ms ' + (isLandscape ? '横图' : '竖图'))

    return { data: 'data:image/png;base64,' + png.toString('base64'), isLandscape }
  } finally {
    clearTimeout(timer)
  }
}

/** 本地背景图列表缓存（避免每次渲染都读取全部图片尺寸） */
let bgListCache = null
let bgListCacheTime = 0

/**
 * 获取本地背景图列表（含横竖标记，带 30 秒缓存）
 */
function getLocalBgList() {
  const now = Date.now()
  if (bgListCache && now - bgListCacheTime < BG_CACHE_TTL) return bgListCache

  if (!fs.existsSync(BG_DIR)) {
    fs.mkdirSync(BG_DIR, { recursive: true })
  }

  const files = fs.readdirSync(BG_DIR).filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
  bgListCache = files.map(name => {
    let isLandscape = false
    try {
      isLandscape = toLandscape(getImageSize(fs.readFileSync(join(BG_DIR, name))))
    } catch {}
    return { name, isLandscape }
  })
  bgListCacheTime = now
  return bgListCache
}

/**
 * 获取本地背景图（backdropDefault 为 random/空 时随机选取）
 */
function getLocalBackdrop(backdropDefault) {
  const list = getLocalBgList()
  if (list.length === 0) {
    return { path: '', fileName: '(无)', isLandscape: false }
  }

  let item
  if (!backdropDefault || backdropDefault === 'random') {
    item = list[Math.floor(Math.random() * list.length)]
  } else {
    // 指定文件不存在时降级为随机，保证有图可用
    item = list.find(i => i.name === backdropDefault) || list[Math.floor(Math.random() * list.length)]
  }

  return {
    path: PLUGIN_PATH + '/data/img/bg/' + item.name,
    fileName: item.name,
    isLandscape: item.isLandscape
  }
}

/**
 * 获取本地背景图目录中的文件列表（供锅巴配置使用）
 */
export function getBackdropFiles() {
  if (!fs.existsSync(BG_DIR)) {
    fs.mkdirSync(BG_DIR, { recursive: true })
    return []
  }
  return fs.readdirSync(BG_DIR).filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
}
