import {
  getInstalledVersion,
  getLatestVersion,
  installVersion,
  restartService,
  getStatus
} from '../lib/depManager.js'
import { vendorStatus, vendorInstall } from '../lib/vendor.js'

export class ncmDep extends plugin {
  constructor() {
    super({
      name: '双管乐·API依赖管理',
      dsc: 'NCM-plugin 双管乐·API 依赖安装与更新',
      event: 'message',
      priority: 4000,
      rule: [
        { reg: '^#*(NCM|ncm)安装api(\\s+.+)?$', fnc: 'installApi' },
        { reg: '^#*(NCM|ncm)更新api$', fnc: 'updateApi' },
        { reg: '^#*(NCM|ncm)api版本$', fnc: 'apiVersion' }
      ]
    })
  }

  async installApi() {
    if (!this.e.isMaster) {
      await this.reply('您无权操作')
      return true
    }

    const match = this.e.msg.match(/^#*(?:NCM|ncm)安装api(?:\s+(.+))?$/i)
    const version = match && match[1] ? match[1].trim() : null

    const before = getInstalledVersion()
    if (version) {
      await this.reply('正在安装 NeteaseCloudMusicApi ' + version + '，请稍候...')
    } else {
      await this.reply('正在安装 NeteaseCloudMusicApi 最新版本，请稍候...')
    }

    const result = installVersion(version)
    if (!result.success) {
      await this.reply('安装失败：' + (result.error || '未知错误'))
      return true
    }

    const after = getInstalledVersion()
    const msg = [
      'NeteaseCloudMusicApi 安装完成',
      '版本：' + (after || 'unknown'),
      before ? ('原版本：' + before) : '原版本：未安装'
    ].join('\n')
    await this.reply(msg)

    await this.reply('正在重启网易云API服务...')
    const restart = await restartService()
    if (restart.success) {
      await this.reply('服务重启成功')
    } else {
      await this.reply('服务重启失败：' + (restart.error || '未知错误'))
    }
    return true
  }

  async updateApi() {
    if (!this.e.isMaster) {
      await this.reply('您无权操作')
      return true
    }
    const result = await vendorInstall('NeteaseCloudMusicApi@latest')
    if (!result.success) {
      await this.reply('更新失败：' + (result.error || '未知错误'))
      return true
    }
    await this.reply('更新完成，当前版本：' + (result.version || 'unknown'))
    await this.reply('正在重启网易云API服务...')
    const restart = await restartService()
    await this.reply(restart.success ? '服务重启成功' : '服务重启失败：' + (restart.error || ''))
    return true
  }

  async apiVersion() {
    const status = vendorStatus()
    const lines = ['vendor 内环境版本信息', '']
    for (const [name, info] of Object.entries(status)) {
      const mark = info.ok ? '✓' : '✗'
      lines.push(mark + ' ' + name + ': ' + (info.installed || '未安装') + ' (要求: ' + info.range + ')')
    }
    await this.reply(lines.join('\n'))
    return true
  }
}
