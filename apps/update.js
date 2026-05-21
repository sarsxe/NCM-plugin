import fs from 'node:fs'
import path from 'node:path'
import { exec, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pluginDir = 'NCMApi-plugin'
const pluginPath = fileURLToPath(new URL('../', import.meta.url))

function runCmd(command, options = {}) {
  return new Promise(resolve => {
    exec(command, {
      cwd: options.cwd || pluginPath,
      windowsHide: true
    }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr })
    })
  })
}

export class update extends plugin {
  constructor() {
    super({
      name: 'NCMApi插件更新',
      dsc: 'NCMApi-plugin 更新与版本管理',
      event: 'message',
      priority: 4000,
      rule: [
        { reg: '^#*(NCM|ncm)(插件)?版本$', fnc: 'version' },
        { reg: '^#*(NCM|ncm)(插件)?(强制更新|更新)$', fnc: 'ncmUpdate' }
      ]
    })
    this.oldCommitId = ''
  }

  async version() {
    const packageJsonPath = path.join(pluginPath, 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    const msg = [
      'NCMApi-plugin 版本信息',
      '版本号：' + (packageJson.version || 'unknown'),
      'Commit：' + this.getCommitId(),
      '时间：' + this.getTime(),
      '目录：./plugins/' + pluginDir,
      '启动方式：随 Yunzai 自动启动'
    ].join('\n')
    await this.reply(msg)
    return true
  }

  async ncmUpdate() {
    if (!this.e.isMaster) {
      await this.reply('您无权操作')
      return true
    }

    const isForce = this.e.msg.includes('强制')
    this.oldCommitId = this.getCommitId()
    await this.reply('正在执行 NCMApi-plugin 更新，请稍等')

    if (isForce) {
      const resetRet = await runCmd('git checkout .')
      if (resetRet.error) {
        await this.gitErr(resetRet.error, resetRet.stdout, resetRet.stderr)
        return false
      }
    }

    const pullRet = await runCmd('git pull --no-rebase')
    if (pullRet.error) {
      await this.gitErr(pullRet.error, pullRet.stdout, pullRet.stderr)
      return false
    }

    const npmRet = await runCmd('pnpm install')
    if (npmRet.error) {
      await this.reply('代码已更新，但 pnpm install 执行失败，请手动检查依赖')
      await this.reply((npmRet.stderr || npmRet.stdout || String(npmRet.error)).slice(0, 1000))
      return false
    }

    const time = this.getTime()
    const pullOutput = String(pullRet.stdout || '') + '\n' + String(pullRet.stderr || '')
    if (/Already up[ -]to[ -]date|已经是最新/i.test(pullOutput)) {
      await this.reply('NCMApi-plugin 已经是最新版本，最后更新时间：' + time)
      return true
    }

    await this.reply([
      'NCMApi-plugin 更新成功',
      '最后更新时间：' + time,
      '依赖已安装，请重启 Yunzai 使更新与内置 NCM API 服务生效'
    ].join('\n'))
    const log = this.getLog()
    if (log) await this.reply(log)
    return true
  }

  getCommitId() {
    try {
      return execSync('git rev-parse --short HEAD', {
        cwd: pluginPath,
        encoding: 'utf-8'
      }).trim()
    } catch {
      return 'unknown'
    }
  }

  getTime() {
    try {
      return execSync('git log -1 --pretty=format:%cd --date=format:%m-%d_%H:%M', {
        cwd: pluginPath,
        encoding: 'utf-8'
      }).trim()
    } catch {
      return '获取时间失败'
    }
  }

  getLog() {
    try {
      const out = execSync('git log -20 --pretty=format:%h__%cd__%s --date=format:%m-%d_%H:%M', {
        cwd: pluginPath,
        encoding: 'utf-8'
      })
      const lines = out.split('\n')
      const logs = []
      for (const line of lines) {
        const parts = line.split('__')
        if (parts[0] === this.oldCommitId) break
        if ((parts[2] || '').includes('Merge branch')) continue
        if (parts[1] && parts[2]) logs.push('[' + parts[1] + '] ' + parts[2])
      }
      return logs.join('\n')
    } catch {
      return ''
    }
  }

  async gitErr(err, stdout, stderr) {
    const errMsg = err ? String(err) : ''
    const out = stdout ? String(stdout) : ''
    const errOut = stderr ? String(stderr) : ''
    let msg = 'NCMApi-plugin 更新失败'
    if (errMsg.includes('Timed out')) msg += '\n连接超时'
    else if (/Failed to connect|unable to access/i.test(errMsg)) msg += '\n连接失败'
    else if (errMsg.includes('be overwritten by merge') || out.includes('CONFLICT') || errOut.includes('CONFLICT')) {
      msg += '\n存在冲突，请解决后再更新，或执行 #NCM强制更新 放弃本地修改'
    }
    const detail = (errMsg + '\n' + out + '\n' + errOut).trim().slice(0, 1200)
    await this.reply(msg + (detail ? '\n' + detail : ''))
  }
}
