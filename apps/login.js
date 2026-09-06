import sharp from 'sharp'
import { getService } from '../lib/handler.js'
import { loadConfig, setServiceConfig } from '../lib/config.js'
import { checkPermission } from '../lib/handler.js'
import { replyCard } from '../lib/render.js'

/** 将二维码图片放大2倍（提升扫码识别体验） */
async function enlargeQrCode(base64Data) {
  try {
    const buf = Buffer.from(base64Data, 'base64')
    const meta = await sharp(buf).metadata()
    const w = (meta.width || 200) * 2
    const enlarged = await sharp(buf).resize(w, w, { kernel: 'nearest' }).png().toBuffer()
    return enlarged.toString('base64')
  } catch {
    return base64Data
  }
}

/** 带超时的 fetch，防止上游接口 hang 住拖死整个登录流程 */
function fetchTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
}

export class NcmLogin extends plugin {
  constructor() {
    super({
      name: '双管乐·API登录',
      dsc: 'NCM-plugin 双管乐·API 各平台扫码登录',
      event: 'message',
      priority: 3999,
      rule: [
        { reg: '^#*(NCM|ncm)(网易云?|ncm)登录$', fnc: 'ncmLogin' },
        { reg: '^#*(NCM|ncm)(酷狗|kugou)登录$', fnc: 'kugouLogin' }
      ]
    })
  }

  /** 网易云扫码登录 */
  async ncmLogin() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }

    const config = loadConfig()
    const ncmSvc = getService('ncm')
    const ncmPort = ncmSvc?.actualPort || config.ncm?.port || 3030
    const base = 'http://' + (config.ncm?.host || '127.0.0.1') + ':' + ncmPort

    try {
      await this.reply('正在生成网易云登录二维码...')
      const keyRes = await fetchTimeout(base + '/login/qr/key?timestamp=' + Date.now())
      const keyData = await keyRes.json()
      const unikey = keyData?.body?.data?.unikey || keyData?.data?.unikey
      if (!unikey) {
        await this.reply('获取登录key失败：' + JSON.stringify(keyData))
        return true
      }

      const createRes = await fetchTimeout(base + '/login/qr/create?key=' + unikey + '&qrimg=true&timestamp=' + Date.now())
      const createData = await createRes.json()
      const qrimg = createData?.body?.data?.qrimg || createData?.data?.qrimg
      const qrurl = createData?.body?.data?.qrurl || createData?.data?.qrurl

      if (qrimg) {
        const base64Data = await enlargeQrCode(qrimg.replace(/^data:image\/\w+;base64,/, ''))
        await this.reply([
          segment.reply(this.e.message_id),
          segment.image('base64://' + base64Data),
          '\n请使用网易云音乐APP扫码登录\n二维码60秒内有效\n2分钟后撤回本条消息'
        ], false, { recallMsg: 120 })
      } else if (qrurl) {
        await this.reply([
          segment.reply(this.e.message_id),
          '请用网易云APP扫描登录：\n' + qrurl + '\n二维码60秒内有效\n2分钟后撤回本条消息'
        ], false, { recallMsg: 120 })
      } else {
        await this.reply('二维码生成失败')
        return true
      }

      const result = await this.pollNcmQrStatus(base, unikey, 60)
      if (result.success) {
        setServiceConfig('ncm', { cookie: result.cookie })
        await this.sendLoginStatusCard(base, '网易云', result.cookie)
      } else {
        await this.reply('网易云登录失败：' + (result.message || '超时'))
      }
    } catch (err) {
      await this.reply('网易云登录异常：' + err.message)
    }
    return true
  }

  async pollNcmQrStatus(base, unikey, timeout) {
    const start = Date.now()
    while (Date.now() - start < timeout * 1000) {
      await this.sleep(3000)
      try {
        const res = await fetchTimeout(base + '/login/qr/check?key=' + unikey + '&timestamp=' + Date.now(), {}, 8000)
        const data = await res.json()
        const code = data?.body?.code || data?.code
        if (code === 803) {
          const cookie = data?.body?.cookie || data?.cookie || ''
          return { success: true, cookie }
        } else if (code === 800) {
          return { success: false, message: '二维码已过期' }
        }
      } catch (e) {
        // 网络错误继续重试
      }
    }
    return { success: false, message: '登录超时' }
  }

  /** 酷狗扫码登录 */
  async kugouLogin() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }

    const config = loadConfig()
    const kugouSvc = getService('kugou')
    const kugouPort = kugouSvc?.actualPort || config.kugou?.port || 3040
    const base = 'http://' + (config.kugou?.host || '127.0.0.1') + ':' + kugouPort

    try {
      await this.reply('正在生成酷狗登录二维码...')

      const keyRes = await fetchTimeout(base + '/login/qr/key?timestamp=' + Date.now())
      const keyData = await keyRes.json()
      const key = keyData?.body?.data?.qrcode || keyData?.data?.qrcode
      if (!key) {
        await this.reply('获取酷狗登录key失败：' + JSON.stringify(keyData))
        return true
      }

      const createRes = await fetchTimeout(base + '/login/qr/create?key=' + key + '&qrimg=true&timestamp=' + Date.now())
      const createData = await createRes.json()
      const qrimg = createData?.body?.data?.base64 || createData?.data?.base64
      const qrurl = createData?.body?.data?.url || createData?.data?.url

      if (qrimg) {
        const base64Data = await enlargeQrCode(qrimg.replace(/^data:image\/\w+;base64,/, ''))
        await this.reply([
          segment.reply(this.e.message_id),
          segment.image('base64://' + base64Data),
          '\n请使用酷狗音乐APP扫码登录\n二维码60秒内有效\n2分钟后撤回本条消息'
        ], false, { recallMsg: 120 })
      } else if (qrurl) {
        await this.reply([
          segment.reply(this.e.message_id),
          '请用酷狗APP扫描登录：\n' + qrurl + '\n二维码60秒内有效\n2分钟后撤回本条消息'
        ], false, { recallMsg: 120 })
      } else {
        await this.reply('酷狗二维码生成失败')
        return true
      }

      const result = await this.pollKugouQrStatus(base, key, 60)
      if (result.success) {
        // 先立刻回复，抢占 OneBot 响应窗口，避免后续接口慢导致用户只看到超时的失败提示
        await this.reply('酷狗扫码成功，正在生成登录信息...').catch(() => {})
        const fullCookie = await this.buildKugouFullCookie(base, result)
        setServiceConfig('kugou', {
          cookie: fullCookie.cookie
        })
        await this.sendLoginStatusCard(base, '酷狗', fullCookie.cookie, fullCookie.userid)
      } else {
        await this.reply('酷狗登录失败：' + (result.message || '超时'))
      }
    } catch (err) {
      await this.reply('酷狗登录异常：' + err.message)
    }
    return true
  }

  async pollKugouQrStatus(base, key, timeout) {
    const start = Date.now()
    while (Date.now() - start < timeout * 1000) {
      await this.sleep(3000)
      try {
        const res = await fetchTimeout(base + '/login/qr/check?key=' + key + '&timestamp=' + Date.now(), {}, 8000)
        const data = await res.json()
        const payload = data?.body?.data || data?.data || {}
        const status = Number(payload?.status ?? data?.body?.status ?? data?.status)
        if (status === 4) {
          const token = payload?.token || data?.body?.token || data?.token || ''
          const userid = payload?.userid || data?.body?.userid || data?.userid || ''
          const rawCookie = data?.body?.cookie ?? data?.cookie ?? ''
          const cookie = Array.isArray(rawCookie) ? rawCookie.join('; ') : rawCookie
          return { success: true, token, userid, cookie }
        } else if (status === 0) {
          return { success: false, message: '二维码已过期' }
        }
      } catch (e) {}
    }
    return { success: false, message: '登录超时' }
  }

  /** 组装完整的酷狗 cookie（各接口均设超时，单个失败不阻塞整体流程） */
  async buildKugouFullCookie(base, loginResult) {
    let token = loginResult.token || ''
    let userid = loginResult.userid || ''
    let dfid = ''
    let nickname = ''
    let cookieParts = []

    if (loginResult.cookie) {
      cookieParts.push(loginResult.cookie)
    }
    if (token) cookieParts.push('token=' + token)
    if (userid) cookieParts.push('userid=' + userid)

    try {
      const userRes = await fetchTimeout(base + '/user/detail?timestamp=' + Date.now(), {
        headers: { Cookie: cookieParts.join('; ') }
      }, 10000)
      const userData = await userRes.json()
      const d = userData?.body?.data || userData?.data || {}
      const uid = d.userid || d.user_id || d.uid || userid
      nickname = d.nickname || d.k_nickname || ''
      if (uid) userid = String(uid)
    } catch (e) {}

    try {
      const tokenRes = await fetchTimeout(base + '/login/token?token=' + token + '&userid=' + userid + '&timestamp=' + Date.now(), {
        headers: { Cookie: cookieParts.join('; ') }
      }, 10000)
      const tokenData = await tokenRes.json()
      const newToken = tokenData?.body?.data?.token || tokenData?.data?.token
      if (newToken) token = newToken
      const newCookie = tokenData?.body?.cookie || tokenData?.cookie
      if (newCookie) cookieParts.push(newCookie)
    } catch (e) {}

    try {
      const devRes = await fetchTimeout(base + '/register/dev', {
        headers: { Cookie: cookieParts.join('; ') }
      }, 10000)
      const devData = await devRes.json()
      dfid = devData?.body?.data?.dfid || devData?.data?.dfid || ''
      const devCookie = devData?.body?.cookie || devData?.cookie
      if (devCookie) cookieParts.push(devCookie)
    } catch (e) {}

    const cookieMap = {}
    for (const part of cookieParts) {
      for (const item of part.split(/;\s*/)) {
        const eq = item.indexOf('=')
        if (eq > 0) {
          const k = item.slice(0, eq).trim()
          const v = item.slice(eq + 1).trim()
          if (k && v) cookieMap[k] = v
        }
      }
    }
    if (token) cookieMap['token'] = token
    if (userid) cookieMap['userid'] = userid
    if (dfid) cookieMap['dfid'] = dfid

    const finalCookie = Object.entries(cookieMap).map(([k, v]) => k + '=' + v).join('; ')
    return { cookie: finalCookie, token, userid, dfid, nickname }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /** 登录成功后发送状态信息（knownUid：登录阶段已获取的 uid，避免状态接口取不到时显示未知） */
  async sendLoginStatusCard(base, platform, cookie, knownUid = '') {
    const platformMap = {
      '网易云': { tpl: 'ncm-status', fetch: 'ncm' },
      '酷狗': { tpl: 'kugou-status', fetch: 'kugou' }
    }
    const info = platformMap[platform]
    if (!info) {
      await this.reply(platform + ' 登录成功，ck已保存')
      return
    }
    try {
      const { NcmStatus } = await import('./status.js')
      const statusInst = new NcmStatus()
      let cardData
      if (info.fetch === 'kugou') {
        cardData = await statusInst.fetchKugouStatus(base, cookie, knownUid)
      } else if (info.fetch === 'ncm') {
        cardData = await statusInst.fetchNcmStatus(base, cookie)
      }
      const ok = await replyCard(this.e, info.tpl, cardData)
      if (!ok) {
        await this.reply(platform + ' 登录成功，当前账号：' + (cardData.nickname || '未知'))
      }
    } catch (e) {
      logger.warn('[NCM-plugin] 登录后渲染状态卡失败:', e.message)
      try {
        const ur = await fetchTimeout(base + '/user/detail?timestamp=' + Date.now(), {
          headers: { Cookie: cookie || '' }
        }, 10000)
        const ud = await ur.json()
        const p = ud?.body?.data || ud?.data || {}
        const nick = p.nickname || p.name || '未知'
        await this.reply(platform + ' 登录成功，当前账号：' + nick)
      } catch (e2) {
        await this.reply(platform + ' 登录成功，ck已保存')
      }
    }
  }
}
