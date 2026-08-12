import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import { getBackground } from './backdrop.js'

const _path = process.cwd().split(String.fromCharCode(92)).join('/')
const PLUGIN_NAME = 'NCM-plugin'
const PLUGIN_RES_PATH = _path + '/plugins/' + PLUGIN_NAME + '/data/'
const REDIS_ORIG_IMG_KEY = 'ncm:origImg:'
const ORIG_IMG_EXPIRE = 60 * 60 * 2

/**
 * 渲染指定模板为图片
 * @param {string} tplName 模板名（data/html/<tplName>/<tplName>.html）
 * @param {object} data 注入模板的额外数据
 * @returns {Promise<{img: any, backdrop: string}|null>} 失败返回 null
 */
export async function renderCard(tplName, data = {}) {
  try {
    const bg = await getBackground()
    const img = await puppeteer.screenshot(PLUGIN_NAME + '/' + tplName, {
      saveId: tplName,
      tplFile: './plugins/' + PLUGIN_NAME + '/data/html/' + tplName + '/' + tplName + '.html',
      pluResPath: PLUGIN_RES_PATH,
      imgType: 'png',
      backdrop: bg.data,
      bodyClass: bg.isLandscape ? 'landscape' : '',
      ...data
    })
    return img ? { img, backdrop: bg.data } : null
  } catch (err) {
    logger.warn('[NCM-plugin] 渲染图片失败(' + tplName + '):', err.message)
    return null
  }
}

/**
 * 渲染模板并回复图片，成功后自动保存背景原图（供 #原图 使用）
 * @returns {Promise<boolean>} 是否成功发送图片
 */
export async function replyCard(e, tplName, data = {}) {
  const result = await renderCard(tplName, data)
  if (!result || !result.img) return false
  const retMsgId = await e.reply(result.img, true)
  if (retMsgId && result.backdrop) saveOrigImg(e, retMsgId, result.backdrop)
  return true
}

/**
 * 保存背景原图到 redis（关联消息ID，回复 #原图 时取用）
 */
export function saveOrigImg(e, retMsgId, backdrop) {
  const redisData = toOrigImgData(backdrop)
  if (!redisData) return
  const messageIds = [e.message_id]
  if (retMsgId?.message_id) {
    if (Array.isArray(retMsgId.message_id)) {
      messageIds.push(...retMsgId.message_id)
    } else {
      messageIds.push(retMsgId.message_id)
    }
  }
  for (const id of messageIds) {
    if (id) redis.set(REDIS_ORIG_IMG_KEY + id, redisData, { EX: ORIG_IMG_EXPIRE })
  }
}

/**
 * 将背景图数据转换为可回发的原图数据
 * base64 图片 → base64:// 前缀；插件相对路径 → 去除上级跳转前缀
 */
function toOrigImgData(backdrop) {
  if (!backdrop) return ''
  return String(backdrop)
    .replace(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/, 'base64://')
    .replace('../../../../../', '')
}

/**
 * 构建 text-card 模板的 sections HTML
 * @param {Array<{title?: string, items: Array<[string, string]|{k: string, v: string}>}>} sections
 * @returns {string} HTML 字符串
 */
export function buildSectionsHtml(sections) {
  if (!Array.isArray(sections)) return ''
  return sections.filter(Boolean).map(sec => {
    const items = (sec.items || []).map(it => {
      const [k, v] = Array.isArray(it) ? it : [it.k, it.v]
      return '      <div class="line-item"><span class="line-key">' + escapeHtml(k) + '</span><span class="line-val">' + escapeHtml(v) + '</span></div>'
    }).join('\n')
    const title = sec.title
      ? '    <div class="section-title">' + escapeHtml(sec.title) + '</div>\n'
      : ''
    return '  <div class="section">\n' + title + '    <div class="line-list">\n' + items + '\n    </div>\n  </div>'
  }).join('\n')
}

/**
 * 以文字卡片形式回复（适用于返回较多文字的指令）
 * @param {object} card { title, subtitle, sections, note, footer }
 * @returns {Promise<boolean>} 是否成功发送图片（失败时调用方应降级为文字回复）
 */
export async function replyTextCard(e, card) {
  return replyCard(e, 'text-card', {
    title: card.title || 'NCM-plugin',
    subtitle: card.subtitle || '双管乐 · 网易云 & 酷狗 API',
    sections: buildSectionsHtml(card.sections),
    note: card.note || '',
    footer: card.footer || 'NCM-plugin'
  })
}

/**
 * HTML 转义（防止数据中的特殊字符破坏模板结构）
 */
export function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
