import {
  checkPermission,
  handleStatus,
  handleStart,
  handleReload,
  handleChangePort,
  handleRestart
} from '../lib/handler.js'

export class ncmapi extends plugin {
  constructor() {
    super({
      name: 'NCMApi运行管理',
      dsc: 'NCMApi 运行状态查看与重载控制',
      event: 'message',
      priority: 4000,
      rule: [
        { reg: '^#*(NCM|ncm)(运行)?状态$', fnc: 'status' },
        { reg: '^#*(NCM|ncm)(启动|运行)$', fnc: 'start' },
        { reg: '^#*(NCM|ncm)重载$', fnc: 'reload' },
        { reg: '^#*(NCM|ncm)端口变更(\\d+)$', fnc: 'changePort' },
        { reg: '^#*(NCM|ncm)重启$', fnc: 'restart' }
      ]
    })
  }

  async status() {
    const message = await handleStatus()
    await this.reply(message)
    return true
  }

  async start() {
    const perm = await checkPermission(this.e)
    if (!perm.allowed) {
      await this.reply(perm.message)
      return true
    }

    const result = await handleStart()
    await this.reply(result.message)
    return true
  }

  async reload() {
    const perm = await checkPermission(this.e)
    if (!perm.allowed) {
      await this.reply(perm.message)
      return true
    }

    const result = await handleReload()
    await this.reply(result.message)
    return true
  }

  async changePort() {
    const perm = await checkPermission(this.e)
    if (!perm.allowed) {
      await this.reply(perm.message)
      return true
    }

    const result = await handleChangePort(this.e.msg)
    await this.reply(result.message)
    return true
  }

  async restart() {
    const perm = await checkPermission(this.e)
    if (!perm.allowed) {
      await this.reply(perm.message)
      return true
    }

    const result = await handleRestart()
    await this.reply(result.message)
    return true
  }
}
