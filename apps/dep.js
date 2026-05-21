import {
  getInstalledVersion,
  getLatestVersion,
  installVersion,
  restartService,
  getStatus
} from '../lib/depManager.js'

export class ncmDep extends plugin {
  constructor() {
    super({
      name: 'NCMApi依赖管理',
      dsc: 'NeteaseCloudMusicApi 依赖安装与更新',
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

    await this.reply('正在重启 NCMApi 服务...')
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

    const current = getInstalledVersion()
    await this.reply('正在查询最新版本...')
    const latest = getLatestVersion()

    if (!latest) {
      await this.reply('查询最新版本失败，请检查网络连接')
      return true
    }

    if (current === latest) {
      await this.reply('当前已是最新版本：' + current)
      return true
    }

    await this.reply('发现新版本：' + latest + (current ? '（当前：' + current + '）' : '') + '\n正在更新...')
    const result = installVersion(latest)
    if (!result.success) {
      await this.reply('更新失败：' + (result.error || '未知错误'))
      return true
    }

    const after = getInstalledVersion()
    await this.reply('更新完成，当前版本：' + (after || 'unknown'))

    await this.reply('正在重启 NCMApi 服务...')
    const restart = await restartService()
    if (restart.success) {
      await this.reply('服务重启成功')
    } else {
      await this.reply('服务重启失败：' + (restart.error || '未知错误'))
    }
    return true
  }

  async apiVersion() {
    const current = getInstalledVersion()
    const latest = getLatestVersion()
    const msg = [
      'NeteaseCloudMusicApi 版本信息',
      '当前版本：' + (current || '未安装'),
      '最新版本：' + (latest || '查询失败')
    ].join('\n')
    await this.reply(msg)
    return true
  }
}
