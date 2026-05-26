import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { reloadNcmApiService } from './service.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginPath = path.resolve(__dirname, '..')
const pluginDir = 'NCMApi-plugin'

function getPkgPath() {
  return path.join(pluginPath, 'package.json')
}

function getDepPkgPath() {
  return path.join(pluginPath, 'node_modules', 'NeteaseCloudMusicApi', 'package.json')
}

export function getInstalledVersion() {
  try {
    const pkgPath = getDepPkgPath()
    if (!fs.existsSync(pkgPath)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return pkg.version || null
  } catch (err) {
    logger.warn('[' + pluginDir + '] 获取已安装版本失败: ' + err.message)
    return null
  }
}

export function getLatestVersion() {
  try {
    const result = execSync('npm view NeteaseCloudMusicApi version', {
      cwd: pluginPath,
      encoding: 'utf8',
      timeout: 30000
    }).trim()
    return result || null
  } catch (err) {
    logger.warn('[' + pluginDir + '] 查询最新版本失败: ' + err.message)
    return null
  }
}

export function installVersion(version) {
  const targetVersion = version || 'latest'
  logger.info('[' + pluginDir + '] 正在安装 NeteaseCloudMusicApi ' + targetVersion + '...')

  try {
    const pkgPath = getPkgPath()
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    pkg.dependencies['NeteaseCloudMusicApi'] = targetVersion
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

    execSync('pnpm install', {
      cwd: pluginPath,
      stdio: 'inherit',
      timeout: 120000
    })

    const installedVersion = getInstalledVersion()
    if (installedVersion) {
      logger.info('[' + pluginDir + '] NeteaseCloudMusicApi ' + installedVersion + ' 安装完成')
      return { success: true, version: installedVersion }
    }
    return { success: false, error: '安装后未检测到版本信息' }
  } catch (err) {
    logger.error('[' + pluginDir + '] 安装 NeteaseCloudMusicApi ' + targetVersion + ' 失败: ' + err.message)
    return { success: false, error: err.message }
  }
}

export async function restartService() {
  try {
    await reloadNcmApiService()
    return { success: true }
  } catch (err) {
    logger.error('[' + pluginDir + '] 重启服务失败: ' + err.message)
    return { success: false, error: err.message }
  }
}

export function getStatus() {
  const current = getInstalledVersion()
  return {
    installed: !!current,
    version: current,
    pkgPath: getPkgPath()
  }
}
