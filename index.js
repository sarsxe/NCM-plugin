import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { startNcmApiService, stopNcmApiService, reloadNcmApiService } from './lib/service.js'

const pluginDir = 'NCMApi-plugin'
const appDir = './plugins/' + pluginDir + '/apps'
const pluginPath = './plugins/' + pluginDir

// 回退控制配置
const FALLBACK_VERSION = '4.30.0'
const UPDATE_CONFIG = {
  autoUpdate: true,           // 是否启用自动更新
  updateTime: '05:15',        // 每日更新时间 (HH:MM)
  fallbackOnFailure: true,    // 更新失败是否回退
  checkInterval: 60000        // 检查间隔 (毫秒)
}

// 更新状态记录
let updateState = {
  lastCheck: null,
  lastUpdate: null,
  currentVersion: null,
  updateInProgress: false,
  lastError: null
}

async function ensureDependency() {
  try {
    await import('NeteaseCloudMusicApi')
    return true
  } catch (e) {
    return false
  }
}

function getInstalledVersion() {
  try {
    const pkgPath = pluginPath + '/node_modules/NeteaseCloudMusicApi/package.json'
    if (!fs.existsSync(pkgPath)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return pkg.version || null
  } catch (err) {
    logger.warn('[' + pluginDir + '] 获取已安装版本失败: ' + err.message)
    return null
  }
}

function installDependency(version = null) {
  const targetVersion = version || FALLBACK_VERSION
  logger.info('[' + pluginDir + '] 正在安装 NeteaseCloudMusicApi ' + targetVersion + '，请稍候...')
  
  try {
    // 先更新 package.json 中的版本
    const pkgPath = pluginPath + '/package.json'
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    pkg.dependencies['NeteaseCloudMusicApi'] = targetVersion
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    
    // 执行安装
    execSync('npm install', {
      cwd: pluginPath,
      stdio: 'inherit',
      timeout: 120000
    })
    
    updateState.currentVersion = getInstalledVersion()
    updateState.lastUpdate = Date.now()
    logger.info('[' + pluginDir + '] NeteaseCloudMusicApi ' + targetVersion + ' 安装完成')
    return true
  } catch (err) {
    updateState.lastError = err.message
    logger.error('[' + pluginDir + '] 安装 NeteaseCloudMusicApi ' + targetVersion + ' 失败: ' + err.message)
    return false
  }
}

async function updateToLatest() {
  if (updateState.updateInProgress) {
    logger.warn('[' + pluginDir + '] 更新正在进行中，跳过本次检查')
    return false
  }
  
  updateState.updateInProgress = true
  logger.info('[' + pluginDir + '] 开始检查 NeteaseCloudMusicApi 更新...')
  
  try {
    // 获取当前版本
    const currentVersion = getInstalledVersion()
    if (!currentVersion) {
      logger.warn('[' + pluginDir + '] 未检测到已安装版本，将安装 ' + FALLBACK_VERSION)
      const result = installDependency(FALLBACK_VERSION)
      updateState.updateInProgress = false
      return result
    }
    
    // 获取最新版本信息
    logger.info('[' + pluginDir + '] 当前版本: ' + currentVersion + '，正在查询最新版本...')
    
    let latestVersion
    try {
      const npmView = execSync('npm view NeteaseCloudMusicApi version', {
        cwd: pluginPath,
        encoding: 'utf8',
        timeout: 30000
      }).trim()
      latestVersion = npmView
    } catch (err) {
      logger.warn('[' + pluginDir + '] 查询最新版本失败: ' + err.message)
      updateState.updateInProgress = false
      return false
    }
    
    if (latestVersion === currentVersion) {
      logger.info('[' + pluginDir + '] 当前已是最新版本 (' + currentVersion + ')，无需更新')
      updateState.updateInProgress = false
      return true
    }
    
    logger.info('[' + pluginDir + '] 发现新版本: ' + latestVersion + '，当前版本: ' + currentVersion)
    
    // 备份当前版本信息
    const backupVersion = currentVersion
    
    // 尝试更新到最新版本
    logger.info('[' + pluginDir + '] 正在更新到 ' + latestVersion + '...')
    
    try {
      // 更新 package.json
      const pkgPath = pluginPath + '/package.json'
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      pkg.dependencies['NeteaseCloudMusicApi'] = latestVersion
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
      
      // 执行更新
      execSync('npm install', {
        cwd: pluginPath,
        stdio: 'inherit',
        timeout: 120000
      })
      
      // 验证更新后的版本
      const newVersion = getInstalledVersion()
      if (newVersion === latestVersion) {
        updateState.currentVersion = newVersion
        updateState.lastUpdate = Date.now()
        updateState.lastError = null
        logger.info('[' + pluginDir + '] 更新成功！当前版本: ' + newVersion)
        
        // 重启服务
        logger.info('[' + pluginDir + '] 正在重启 NeteaseCloudMusicApi 服务...')
        await reloadNcmApiService()
        
        updateState.updateInProgress = false
        return true
      } else {
        throw new Error('版本验证失败，期望: ' + latestVersion + '，实际: ' + newVersion)
      }
    } catch (err) {
      logger.error('[' + pluginDir + '] 更新到 ' + latestVersion + ' 失败: ' + err.message)
      
      if (UPDATE_CONFIG.fallbackOnFailure) {
        logger.warn('[' + pluginDir + '] 正在回退到稳定版本 ' + FALLBACK_VERSION + '...')
        
        try {
          // 回退到稳定版本
          const pkgPath = pluginPath + '/package.json'
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
          pkg.dependencies['NeteaseCloudMusicApi'] = FALLBACK_VERSION
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
          
          execSync('npm install', {
            cwd: pluginPath,
            stdio: 'inherit',
            timeout: 120000
          })
          
          updateState.currentVersion = getInstalledVersion()
          updateState.lastError = '更新失败已回退: ' + err.message
          logger.info('[' + pluginDir + '] 已回退到稳定版本 ' + FALLBACK_VERSION)
          
          // 重启服务
          await reloadNcmApiService()
        } catch (fallbackErr) {
          logger.error('[' + pluginDir + '] 回退失败: ' + fallbackErr.message)
          updateState.lastError = '更新失败且回退失败: ' + err.message + ' | 回退错误: ' + fallbackErr.message
        }
      }
      
      updateState.updateInProgress = false
      return false
    }
  } catch (err) {
    logger.error('[' + pluginDir + '] 更新检查失败: ' + err.message)
    updateState.lastError = err.message
    updateState.updateInProgress = false
    return false
  }
}

function scheduleDailyUpdate() {
  if (!UPDATE_CONFIG.autoUpdate) {
    logger.info('[' + pluginDir + '] 自动更新已禁用')
    return
  }
  
  const [targetHour, targetMinute] = UPDATE_CONFIG.updateTime.split(':').map(Number)
  
  function checkAndSchedule() {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMinute, 0)
    
    if (target <= now) {
      target.setDate(target.getDate() + 1)
    }
    
    const delay = target.getTime() - now.getTime()
    
    logger.info('[' + pluginDir + '] 下次自动更新时间: ' + target.toLocaleString())
    
    setTimeout(() => {
      updateToLatest().then(() => {
        // 安排下一次更新
        checkAndSchedule()
      })
    }, delay)
  }
  
  // 立即执行一次检查
  updateToLatest().then(() => {
    // 然后安排定时更新
    checkAndSchedule()
  })
}

async function initService() {
  let hasDep = await ensureDependency()
  if (!hasDep) {
    hasDep = installDependency(FALLBACK_VERSION)
    if (!hasDep) return
  }
  
  // 记录当前版本
  updateState.currentVersion = getInstalledVersion()
  
  startNcmApiService({ from: 'plugin' }).catch(err => {
    const message = String((err && err.message) || err)
    if (/Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND/.test(message)) {
      logger.warn('[' + pluginDir + '] 依赖加载异常，尝试重新安装...')
      installDependency(FALLBACK_VERSION).then(ok => {
        if (ok) startNcmApiService({ from: 'plugin' })
      })
      return
    }
    logger.error('[' + pluginDir + '] 自动启动本地 NeteaseCloudMusicApi 失败')
    logger.error(err)
  })
  
  // 启动定时更新任务
  scheduleDailyUpdate()
}

initService()

const files = fs.existsSync(appDir)
  ? fs.readdirSync(appDir).filter(file => file.endsWith('.js')).sort()
  : []

let ret = files.map(file => import('./apps/' + file))
ret = await Promise.allSettled(ret)

let apps = {}
for (let i in files) {
  const name = files[i].replace('.js', '')

  if (ret[i].status !== 'fulfilled') {
    handleError(name, ret[i].reason)
    continue
  }

  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}

logger.info('[' + pluginDir + '] 初始化完成，已加载 ' + Object.keys(apps).length + ' 个功能模块')

export { apps }

function handleError(name, err) {
  const message = String((err && err.message) || err)

  if (/Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND/.test(message)) {
    logger.warn('[' + pluginDir + '] ' + logger.yellow(name) + ' 缺少依赖，请进入 ./plugins/' + pluginDir + ' 执行 npm install')
    logger.warn('[' + pluginDir + '] 详细错误：' + message)
    return
  }

  logger.error('[' + pluginDir + '] 载入插件错误：' + logger.red(name))
  logger.error(err)
}
