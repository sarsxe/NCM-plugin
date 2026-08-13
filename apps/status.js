import { loadConfig, getServiceConfig } from '../lib/config.js'
import { getService } from '../lib/handler.js'
import { replyCard } from '../lib/render.js'

export class NcmStatus extends plugin {
  constructor() {
    super({
      name: '双管乐·API账号信息',
      dsc: 'NCM-plugin 双管乐·API 各平台账号状态查询',
      event: 'message',
      priority: 3998,
      rule: [
        { reg: '^#*(NCM|ncm)(酷狗|kugou)(信息|账号|ck)$', fnc: 'kugouInfo' },
        { reg: '^#*(NCM|ncm)(网易云?|ncm)(信息|账号|ck)$', fnc: 'ncmInfo' }
      ]
    })
  }

  async kugouInfo() {
    const kugouCfg = getServiceConfig('kugou') || {}
    if (!kugouCfg.cookie) {
      await this.reply('酷狗尚未登录，请先使用 #ncm酷狗登录 进行扫码')
      return true
    }
    const config = loadConfig()
    const kugouSvc = getService('kugou')
    const port = kugouSvc?.actualPort || config.kugou?.port || 3040
    const base = 'http://' + (config.kugou?.host || '127.0.0.1') + ':' + port
    try {
      const cardData = await this.fetchKugouStatus(base, kugouCfg.cookie)
      const ok = await replyCard(this.e, 'kugou-status', cardData)
      if (!ok) await this.reply(this.formatTextStatus('酷狗', cardData))
    } catch (err) {
      await this.reply('获取酷狗账号信息失败：' + err.message)
    }
    return true
  }

  async ncmInfo() {
    const ncmCfg = getServiceConfig('ncm') || {}
    if (!ncmCfg.cookie) {
      await this.reply('网易云尚未登录，请先使用 #ncm网易登录 进行扫码')
      return true
    }
    const config = loadConfig()
    const ncmSvc = getService('ncm')
    const port = ncmSvc?.actualPort || config.ncm?.port || 3030
    const base = 'http://' + (config.ncm?.host || '127.0.0.1') + ':' + port
    try {
      const cardData = await this.fetchNcmStatus(base, ncmCfg.cookie)
      const ok = await replyCard(this.e, 'ncm-status', cardData)
      if (!ok) await this.reply(this.formatTextStatus('网易云', cardData))
    } catch (err) {
      await this.reply('获取网易云账号信息失败：' + err.message)
    }
    return true
  }

  async fetchKugouStatus(base, cookie) {
    const [detailRes, vipRes] = await Promise.all([
      fetch(base + '/user/detail?timestamp=' + Date.now(), { headers: { Cookie: cookie } }),
      fetch(base + '/user/vip/detail?timestamp=' + Date.now(), { headers: { Cookie: cookie } }).catch(() => null)
    ])
    const detailData = await detailRes.json()
    const detail = detailData?.body?.data || detailData?.data || {}
    let vipInfo = {}
    if (vipRes && vipRes.ok) {
      const vipData = await vipRes.json()
      vipInfo = vipData?.body?.data || vipData?.data || {}
    }
    const busiVip = Array.isArray(vipInfo.busi_vip) ? vipInfo.busi_vip : []
    // 按优先级选择最高级会员：svip > tvip > 其他
    const vipPriority = { svip: 3, tvip: 2, vip: 1 }
    const activeVip = busiVip
      .filter(v => Number(v?.is_vip) === 1)
      .sort((a, b) => (vipPriority[String(b?.product_type || '').toLowerCase()] || 0) - (vipPriority[String(a?.product_type || '').toLowerCase()] || 0))[0]
    // 酷狗用户详情接口不返回用户ID，从 cookie 中提取 userid
    const userid = detail.userid || detail.uid || extractCookieVal(cookie, 'userid') || '未知'
    const nickname = detail.nickname || detail.k_nickname || '酷狗用户'
    const avatar = detail.pic || detail.k_pic || detail.fx_pic || ''
    const avatarUrl = normalizeAvatar(avatar, 'kugou')
    const loginTime = detail.logintime ? new Date(detail.logintime * 1000).toLocaleString('zh-CN') : '未知'
    let vipTitle = '未开通', vipStateText = '未开通'
    let vipSubtitle = '当前未检测到有效酷狗会员'
    let vipExpireText = '到期时间：未开通', hasActiveVip = false
    if (activeVip) {
      hasActiveVip = true
      const pt = String(activeVip.product_type || '').toLowerCase()
      vipTitle = pt === 'svip' ? 'SVIP' : pt === 'tvip' ? 'TVIP' : 'VIP'
      vipStateText = '有效中'
      // 显示更有意义的副标题：SVIP 显示等级，其他显示中文描述
      if (pt === 'svip' && vipInfo.svip_level) {
        vipSubtitle = '豪华SVIP Lv.' + vipInfo.svip_level
      } else {
        const typeMap = { svip: '豪华SVIP', tvip: '听书VIP', vip: '音乐VIP' }
        vipSubtitle = typeMap[pt] || '音乐会员'
      }
      vipExpireText = '到期时间：' + (activeVip.vip_end_time || '未记录')
    }
    return {
      nickname, avatarUrl, uid: String(userid), loginTime,
      hasActiveVip, vipTitle, vipStateText, vipSubtitle, vipExpireText,
      stats: [
        { label: '关注', value: Number(detail.follows) || 0 },
        { label: '粉丝', value: Number(detail.fans) || 0 },
        { label: '访客', value: Number(detail.visitors) || 0 }
      ]
    }
  }

  async fetchNcmStatus(base, cookie) {
    const statusRes = await fetch(ncmApiUrl(base, '/login/status', cookie), ncmFetchOptions(cookie))
    const statusData = await statusRes.json()
    const profile = statusData?.body?.data?.profile || statusData?.data?.profile || statusData?.body?.profile || {}
    const uid = profile.userId || profile.uid || ''
    const nickname = profile.nickname || '网易云用户'
    const avatarUrl = normalizeAvatar(profile.avatarUrl || '', 'ncm')
    const vipType = profile.vipType || 0
    let vipTitle = '普通用户', hasActiveVip = false
    let vipStateText = '未开通', vipSubtitle = '当前未开通会员'
    let vipExpireText = '到期时间：未开通', level = 0, playCount = 0, loginCount = 0
    // 等级/听歌数/登录天数需单独调用 /user/level 接口获取（profile 中无此字段）
    try {
      const levelRes = await fetch(ncmApiUrl(base, '/user/level', cookie), ncmFetchOptions(cookie))
      const levelData = await levelRes.json()
      const lv = levelData?.body?.data || levelData?.data || levelData?.body || {}
      level = lv.level || 0
      playCount = lv.nowPlayCount || 0
      loginCount = lv.nowLoginCount || 0
    } catch (e) {}
    try {
      const vipRes = await fetch(ncmApiUrl(base, '/vip/info', cookie, uid ? { uid } : {}), ncmFetchOptions(cookie))
      const vipData = await vipRes.json()
      const v = vipData?.body?.data || vipData?.data || {}
      // 按优先级检测最高会员：SVIP(redplus/300) > 黑胶VIP(associator/100) > 音乐包(musicPackage/220)
      const now = Date.now()
      const isValid = (item) => item && item.vipCode && Number(item.expireTime) > now
      if (isValid(v.redplus)) {
        hasActiveVip = true
        vipTitle = 'SVIP'
        vipStateText = '有效中'
        vipSubtitle = '网易云音乐SVIP'
        vipExpireText = '到期时间：' + new Date(v.redplus.expireTime).toLocaleString('zh-CN')
      } else if (isValid(v.associator)) {
        hasActiveVip = true
        vipTitle = '黑胶VIP'
        vipStateText = '有效中'
        vipSubtitle = '网易云音乐会员'
        vipExpireText = '到期时间：' + new Date(v.associator.expireTime).toLocaleString('zh-CN')
      } else if (isValid(v.musicPackage)) {
        hasActiveVip = true
        vipTitle = '音乐包'
        vipStateText = '有效中'
        vipSubtitle = '网易云音乐包'
        vipExpireText = '到期时间：' + new Date(v.musicPackage.expireTime).toLocaleString('zh-CN')
      } else if (vipType > 0) {
        hasActiveVip = true
        vipTitle = vipType === 11 ? '黑胶VIP' : 'VIP'
        vipStateText = '有效中'
        vipSubtitle = '网易云音乐会员'
      }
    } catch (e) {
      if (vipType > 0) {
        hasActiveVip = true
        vipTitle = vipType === 11 ? '黑胶VIP' : 'VIP'
        vipStateText = '有效中'
        vipSubtitle = '网易云音乐会员'
      }
    }
    return {
      nickname, avatarUrl, uid: String(uid || '未知'), level: String(level),
      hasActiveVip, vipTitle, vipStateText, vipSubtitle, vipExpireText,
      stats: [
        { label: '等级', value: level },
        { label: '听歌', value: playCount },
        { label: '登录天数', value: loginCount }
      ]
    }
  }

  formatTextStatus(platform, data) {
    const lines = [
      platform + ' 账号信息',
      '昵称：' + data.nickname,
      'UID：' + data.uid,
      '会员：' + data.vipTitle + ' ' + data.vipStateText,
      data.vipExpireText
    ]
    if (data.stats) {
      lines.push(data.stats.map(s => s.label + ':' + s.value).join(' | '))
    }
    return lines.join('\n')
  }
}


function ncmApiUrl(base, pathname, cookie, extra = {}) {
  const params = new URLSearchParams({ timestamp: String(Date.now()) })
  if (cookie) params.set('cookie', cookie)
  for (const [key, value] of Object.entries(extra || {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  return base + pathname + '?' + params.toString()
}

function ncmFetchOptions(cookie) {
  return cookie ? { headers: { Cookie: cookie } } : {}
}

function extractCookieVal(cookie, key) {
  if (!cookie || !key) return ''
  const re = new RegExp('(?:^|;\s*)' + key + '=([^;]+)')
  const m = String(cookie).match(re)
  return m ? m[1].trim() : ''
}

/**
 * 规范化头像地址并尽量获取高清版本
 * 网易云：追加 ?param=480y480 获取 480x480 高清头像
 */
function normalizeAvatar(url, platform) {
  if (!url) return defaultAvatar(platform)
  let u = url
  if (u.startsWith('//')) u = 'https:' + u
  u = u.replace(/^http:\/\//i, 'https://')
  if (platform === 'ncm') {
    // 网易云头像支持 ?param=宽y高 裁剪参数，请求高清版本避免卡片放大后模糊
    u = u.replace(/\?param=\d+y\d+/i, '')
    u += (u.includes('?') ? '&' : '?') + 'param=480y480'
  }
  return u
}

function defaultAvatar(platform) {
  const colors = { kugou: '%2324BBF9', ncm: '%23E60026' }
  const labels = { kugou: 'KG', ncm: 'NCM' }
  const c = colors[platform] || '%23999'
  const l = labels[platform] || '?'
  return 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22240%22 height=%22240%22%3E%3Crect width=%22240%22 height=%22240%22 rx=%22120%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2250%25%22 y=%2255%25%22 text-anchor=%22middle%22 font-size=%2276%22 font-weight=%22700%22 fill=%22' + c + '%22%3E' + l + '%3C/text%3E%3C/svg%3E'
}
