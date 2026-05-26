import fs from 'node:fs'
import path from 'node:path'
import { exec, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pluginDir = 'NCMApi-plugin'
const pluginPath = fileURLToPath(new URL('../', import.meta.url))
const tempBackupDir = path.join(pluginPath, '../../temp/ncmapi-update-tmp')

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

/**
 * 异步检查文件/目录是否存在
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function checkFileExists(filePath) {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * 递归创建目录（如果不存在）
 * @param {string} dir
 */
async function mkdirIfNotExists(dir) {
  try {
    await fs.promises.access(dir)
  } catch {
    await fs.promises.mkdir(dir, { recursive: true })
  }
}

/**
 * 拷贝文件/目录
 * @param {string} srcDir 源目录
 * @param {string} destDir 目标目录
 * @param {string[]} specificFiles 指定拷贝的文件列表，为空则拷贝全部
 */
async function copyFiles(srcDir, destDir, specificFiles = []) {
  try {
    await mkdirIfNotExists(destDir)
    const files = await fs.promises.readdir(srcDir)
    for (const file of files) {
      if (specificFiles.length > 0 && !specificFiles.includes(file)) continue
      const srcFile = path.join(srcDir, file)
      const destFile = path.join(destDir, file)
      const stat = await fs.promises.stat(srcFile)
      if (stat.isDirectory()) {
        await copyFiles(srcFile, destFile)
      } else {
        await fs.promises.copyFile(srcFile, destFile)
      }
    }
  } catch (err) {
    logger.error(`[NCMApi-plugin][拷贝文件] 失败: ${err.message}`)
    throw err
  }
}

/**
 * 递归删除文件夹
 * @param {string} folderPath
 */
async function deleteFolderRecursive(folderPath) {
  try {
    const exists = await checkFileExists(folderPath)
    if (!exists) return
    const files = await fs.promises.readdir(folderPath)
    for (const file of files) {
      const curPath = path.join(folderPath, file)
      const stat = await fs.promises.stat(curPath)
      if (stat.isDirectory()) {
        await deleteFolderRecursive(curPath)
        await fs.promises.rmdir(curPath)
      } else {
        await fs.promises.unlink(curPath)
      }
    }
  } catch (err) {
    logger.error(`[NCMApi-plugin][清理临时文件] 失败: ${err.message}`)
    throw err
  }
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

    // 备份 data 目录
    const dataDir = path.join(pluginPath, 'data')
    const hasData = await checkFileExists(dataDir)
    let backupSuccess = false
    if (hasData) {
      try {
        await deleteFolderRecursive(tempBackupDir)
        await copyFiles(dataDir, tempBackupDir)
        backupSuccess = true
        logger.mark('[NCMApi-plugin] data 目录备份成功')
      } catch (err) {
        logger.error(`[NCMApi-plugin] data 目录备份失败: ${err.message}`)
        await this.reply('data 目录备份失败，更新已中止，请检查权限或磁盘空间')
        return false
      }
    }

    if (isForce) {
      const resetRet = await runCmd('git checkout .')
      if (resetRet.error) {
        await this.gitErr(resetRet.error, resetRet.stdout, resetRet.stderr)
        // 恢复 data 目录
        if (backupSuccess) {
          try {
            await deleteFolderRecursive(dataDir)
            await copyFiles(tempBackupDir, dataDir)
            await deleteFolderRecursive(tempBackupDir)
            await this.reply('已恢复 data 目录备份')
          } catch (err) {
            logger.error(`[NCMApi-plugin] 恢复 data 目录失败: ${err.message}`)
          }
        }
        return false
      }
    }

    const pullRet = await runCmd('git pull --no-rebase')
    if (pullRet.error) {
      await this.gitErr(pullRet.error, pullRet.stdout, pullRet.stderr)
      // 恢复 data 目录
      if (backupSuccess) {
        try {
          await deleteFolderRecursive(dataDir)
          await copyFiles(tempBackupDir, dataDir)
          await deleteFolderRecursive(tempBackupDir)
          await this.reply('已恢复 data 目录备份')
        } catch (err) {
          logger.error(`[NCMApi-plugin] 恢复 data 目录失败: ${err.message}`)
        }
      }
      return false
    }

    const npmRet = await runCmd('pnpm install')
    if (npmRet.error) {
      await this.reply('代码已更新，但 pnpm install 执行失败，请手动检查依赖')
      await this.reply((npmRet.stderr || npmRet.stdout || String(npmRet.error)).slice(0, 1000))
      // 恢复 data 目录
      if (backupSuccess) {
        try {
          await deleteFolderRecursive(dataDir)
          await copyFiles(tempBackupDir, dataDir)
          await deleteFolderRecursive(tempBackupDir)
          await this.reply('已恢复 data 目录备份')
        } catch (err) {
          logger.error(`[NCMApi-plugin] 恢复 data 目录失败: ${err.message}`)
        }
      }
      return false
    }

    const time = this.getTime()
    const pullOutput = String(pullRet.stdout || '') + '\n' + String(pullRet.stderr || '')
    if (/Already up[ -]to[ -]date|已经是最新/i.test(pullOutput)) {
      await this.reply('NCMApi-plugin 已经是最新版本，最后更新时间：' + time)
      // 清理临时备份
      if (backupSuccess) {
        try {
          await deleteFolderRecursive(tempBackupDir)
        } catch (err) {
          logger.error(`[NCMApi-plugin] 清理临时备份失败: ${err.message}`)
        }
      }
      return true
    }

    await this.reply([
      'NCMApi-plugin 更新成功',
      '最后更新时间：' + time,
      '依赖已安装，请重启 Yunzai 使更新与内置 NCM API 服务生效'
    ].join('\n'))

    // 获取更新日志并以转发消息形式发送
    const log = this.getLog()
    if (log) {
      const forwardMsg = await this.makeForwardMsg('NCMApi-plugin 更新日志', log, '')
      if (forwardMsg) await this.reply(forwardMsg)
    }

    // 清理临时备份
    if (backupSuccess) {
      try {
        await deleteFolderRecursive(tempBackupDir)
        logger.mark('[NCMApi-plugin] 临时备份已清理')
      } catch (err) {
        logger.error(`[NCMApi-plugin] 清理临时备份失败: ${err.message}`)
      }
    }

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

  /**
   * 制作转发消息
   * @param {string} title 标题 - 首条消息
   * @param {string} msg 日志信息
   * @param {string} end 最后一条信息
   * @returns
   */
  async makeForwardMsg(title, msg, end) {
    let { nickname } = this.e.bot ?? Bot
    if (this.e.isGroup) {
      let info = await (this.e.bot ?? Bot).getGroupMemberInfo(this.e.group_id, (this.e.bot ?? Bot).uin)
      nickname = info.card || info.nickname
    }
    let userInfo = {
      user_id: (this.e.bot ?? Bot).uin,
      nickname
    }
    let forwardMsg = [
      {
        ...userInfo,
        message: title
      },
      {
        ...userInfo,
        message: msg
      }
    ]
    if (end) {
      forwardMsg.push({
        ...userInfo,
        message: end
      })
    }
    /** 制作转发内容 */
    if (this.e.group?.makeForwardMsg) {
      forwardMsg = await this.e.group.makeForwardMsg(forwardMsg)
    } else if (this.e?.friend?.makeForwardMsg) {
      forwardMsg = await this.e.friend.makeForwardMsg(forwardMsg)
    } else {
      return msg
    }
    let dec = 'NCMApi-plugin 更新日志'
    /** 处理描述 */
    if (typeof (forwardMsg.data) === 'object') {
      let detail = forwardMsg.data?.meta?.detail
      if (detail) {
        detail.news = [{ text: dec }]
      }
    } else {
      forwardMsg.data = forwardMsg.data
        .replace(/\n/g, '')
        .replace(/<title color="#777777" size="26">(.+?)<\/title>/g, '___')
        .replace(/___+/, `<title color="#777777" size="26">${dec}</title>`)
    }
    return forwardMsg
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
