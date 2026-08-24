import { loadConfig } from '../lib/config.js'
import {
  checkPermission,
  handleAllStatus,
  handleServiceStatus,
  handleStartService,
  handleStopService,
  handleRestartService,
  handleRestartAll,
  handleServicePort,
  getService
} from '../lib/handler.js'
import { replyCard, replyTextCard, escapeHtml } from '../lib/render.js'

const SERVICE_NAMES = { ncm: '网易云API', kugou: '酷狗API' }

export class NcmManage extends plugin {
  constructor() {
    super({
      name: '双管乐·API',
      dsc: 'NCM-plugin 双管乐·API',
      event: 'message',
      priority: 4000,
      rule: [
        { reg: '^#*(NCM|ncm)(全部)?(运行)?状态$', fnc: 'allStatus' },
        { reg: '^#*(NCM|ncm)(全部)?启动$', fnc: 'startAll' },
        { reg: '^#*(NCM|ncm)(全部)?重启$', fnc: 'restartAll' },
        { reg: '^#*(NCM|ncm)(全部)?停止$', fnc: 'stopAll' },
        { reg: '^#*(NCM|ncm)(网易云|ncm)状态$', fnc: 'ncmStatus' },
        { reg: '^#*(NCM|ncm)(酷狗|kugou)状态$', fnc: 'kugouStatus' },
        { reg: '^#*(NCM|ncm)(网易云|ncm)启动$', fnc: 'ncmStart' },
        { reg: '^#*(NCM|ncm)(酷狗|kugou)启动$', fnc: 'kugouStart' },
        { reg: '^#*(NCM|ncm)(网易云|ncm)停止$', fnc: 'ncmStop' },
        { reg: '^#*(NCM|ncm)(酷狗|kugou)停止$', fnc: 'kugouStop' },
        { reg: '^#*(NCM|ncm)(网易云|ncm)重启$', fnc: 'ncmRestart' },
        { reg: '^#*(NCM|ncm)(酷狗|kugou)重启$', fnc: 'kugouRestart' },
        { reg: '^#*(NCM|ncm)(网易云|ncm)端口(\d+)$', fnc: 'ncmPort' },
        { reg: '^#*(NCM|ncm)(酷狗|kugou)端口(\d+)$', fnc: 'kugouPort' }
      ]
    })
  }

  /** 全部服务状态（图片总览） */
  async allStatus() {
    const ok = await this._replyAllStatusCard()
    if (!ok) await this.reply(await handleAllStatus())
    return true
  }

  async _replyAllStatusCard() {
    try {
      const config = loadConfig()
      const servicesHtml = []
      for (const name of ['ncm', 'kugou']) {
        const service = getService(name)
        if (!service) continue
        const displayName = SERVICE_NAMES[name] || name
        if (!config[name]?.enabled) {
          servicesHtml.push(this._svcHtml(displayName, 'off', '已禁用', [], ''))
          continue
        }
        const status = await service.getFullStatus()
        const stateText = status.starting ? '启动中' : status.started ? '运行中' : '未运行'
        const badge = status.starting ? 'warn' : status.started ? 'ok' : 'err'
        const modeText = status.started ? (status.external ? '外部复用' : '内置服务') : '未启动'
        const addr = 'http://' + (status.config?.host || '127.0.0.1') + ':' + (status.actualPort || status.config?.port || '未知')
        const rows = [
          ['模式', modeText],
          ['地址', addr],
          ['端口可达', status.reachable ? '是' : '否']
        ]
        if (status.startTime) rows.push(['运行时长', this._fmtDuration(status.uptimeMs)])
        servicesHtml.push(this._svcHtml(displayName, badge, stateText, rows, status.error || ''))
      }
      return await replyCard(this.e, 'status-all', { services: servicesHtml.join('\n') })
    } catch (err) {
      logger.warn('[NCM-plugin] 渲染状态总览图片失败:', err.message)
      return false
    }
  }

  _svcHtml(name, badge, stateText, rows, error) {
    const rowsHtml = rows.map(r => '      <div class="svc-row"><span class="k">' + escapeHtml(r[0]) + '</span><span class="v">' + escapeHtml(r[1]) + '</span></div>').join('\n')
    const errHtml = error ? '      <div class="svc-row"><span class="k">错误</span><span class="v">' + escapeHtml(String(error).slice(0, 120)) + '</span></div>' : ''
    return [
      '  <div class="svc">',
      '    <div class="svc-head"><span class="svc-name">' + escapeHtml(name) + '</span><span class="badge ' + badge + '">' + escapeHtml(stateText) + '</span></div>',
      rowsHtml,
      errHtml,
      '  </div>'
    ].filter(Boolean).join('\n')
  }

  _fmtDuration(ms) {
    if (!ms || ms < 1000) return '0秒'
    const s = Math.floor(ms / 1000)
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
    const parts = []
    if (d) parts.push(d + '天')
    if (h) parts.push(h + '小时')
    if (m) parts.push(m + '分钟')
    if (sec || !parts.length) parts.push(sec + '秒')
    return parts.join('')
  }

  /** 单服务状态（图片卡片，文字过多时更清爽） */
  async _replyServiceStatus(name) {
    const displayName = SERVICE_NAMES[name] || name
    try {
      const service = getService(name)
      if (!service) {
        await this.reply(displayName + ' 服务未注册')
        return true
      }
      const config = loadConfig()
      if (!config[name]?.enabled) {
        const ok = await replyTextCard(this.e, {
          title: displayName + ' 状态',
          sections: [{ items: [['状态', '已禁用'], ['提示', '可在锅巴面板中启用该服务']] }],
          footer: 'NCM-plugin | 服务状态'
        })
        if (!ok) await this.reply(displayName + ' 服务已禁用，可在锅巴面板中启用')
        return true
      }
      const status = await service.getFullStatus()
      const stateText = status.starting ? '启动中' : status.started ? '运行中' : '未运行'
      const modeText = status.started ? (status.external ? '外部复用' : '内置服务') : '未启动'
      const addr = 'http://' + (status.config?.host || '127.0.0.1') + ':' + (status.actualPort || status.config?.port || '未知')
      const items = [
        ['状态', stateText],
        ['模式', modeText],
        ['地址', addr],
        ['端口可达', status.reachable ? '是' : '否']
      ]
      if (status.startTime) items.push(['运行时长', this._fmtDuration(status.uptimeMs)])
      if (status.error) items.push(['错误', String(status.error).slice(0, 120)])
      const ok = await replyTextCard(this.e, {
        title: displayName + ' 状态',
        sections: [{ items }],
        footer: 'NCM-plugin | 服务状态'
      })
      if (!ok) await this.reply(await handleServiceStatus(name))
    } catch (err) {
      logger.warn('[NCM-plugin] 渲染单服务状态失败:', err.message)
      await this.reply(await handleServiceStatus(name))
    }
    return true
  }

  async ncmStatus() { return this._replyServiceStatus('ncm') }
  async kugouStatus() { return this._replyServiceStatus('kugou') }

  /** 全部启动 */
  async startAll() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }

    await this.reply('正在启动所有服务...')
    for (const name of ['ncm', 'kugou']) {
      await handleStartService(name)
    }
    const message = await handleAllStatus()
    await this.reply(message)
    return true
  }

  async restartAll() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }

    const result = await handleRestartAll()
    await this.reply(result.message)
    return true
  }

  async stopAll() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }

    const lines = ['NCM-plugin 停止所有服务', '']
    for (const name of ['ncm', 'kugou']) {
      const result = await handleStopService(name)
      lines.push(result.message)
    }
    await this.reply(lines.join('\n'))
    return true
  }

  // 单服务启动
  async ncmStart() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }
    const r = await handleStartService('ncm'); await this.reply(r.message); return true
  }
  async kugouStart() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }
    const r = await handleStartService('kugou'); await this.reply(r.message); return true
  }

  // 单服务停止
  async ncmStop() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }
    const r = await handleStopService('ncm'); await this.reply(r.message); return true
  }
  async kugouStop() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }
    const r = await handleStopService('kugou'); await this.reply(r.message); return true
  }

  // 单服务重启
  async ncmRestart() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }
    const r = await handleRestartService('ncm'); await this.reply(r.message); return true
  }
  async kugouRestart() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }
    const r = await handleRestartService('kugou'); await this.reply(r.message); return true
  }

  // 端口变更
  async ncmPort() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }
    const port = parseInt(this.e.msg.match(/(\d+)$/)[1], 10)
    const r = await handleServicePort('ncm', port); await this.reply(r.message); return true
  }
  async kugouPort() {
    const perm = checkPermission(this.e)
    if (!perm.allowed) { await this.reply(perm.message); return true }
    const port = parseInt(this.e.msg.match(/(\d+)$/)[1], 10)
    const r = await handleServicePort('kugou', port); await this.reply(r.message); return true
  }
}
