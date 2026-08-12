import fs from 'node:fs'
import { startNcmApiService } from './lib/service.js'

const pluginDir = 'NCM-plugin'
const appDir = './plugins/' + pluginDir + '/apps'
const pluginPath = './plugins/' + pluginDir

async function ensureDependency() {
  try {
    await import('NeteaseCloudMusicApi')
    return true
  } catch (e) {
    return false
  }
}

async function initService() {
  const hasDep = await ensureDependency()
  if (!hasDep) {
    logger.warn('[' + pluginDir + '] 未检测到 NeteaseCloudMusicApi，请使用 #ncm安装 指令安装依赖')
    return
  }
  startNcmApiService({ from: 'plugin' }).catch(err => {
    logger.error('[' + pluginDir + '] 自动启动本地 NeteaseCloudMusicApi 失败')
    logger.error(err)
  })
}

initService()

// 启动酷狗等新增平台服务（网易云由上方 initService 负责）
import('./lib/handler.js').then(({ startAllServices }) => {
  startAllServices().then(results => {
    for (const r of results) {
      if (r.name === 'ncm') continue
      if (r.skipped) {
        logger.info('[' + pluginDir + '] ' + r.name + ' 已禁用，跳过启动')
      } else if (r.success) {
        logger.info('[' + pluginDir + '] ' + r.name + ' 服务启动成功')
      } else {
        logger.warn('[' + pluginDir + '] ' + r.name + ' 服务启动失败：' + (r.error || '未知错误'))
      }
    }
  }).catch(err => {
    logger.error('[' + pluginDir + '] 多平台服务初始化异常')
    logger.error(err)
  })
}).catch(() => {})

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
    logger.warn('[' + pluginDir + '] ' + logger.yellow(name) + ' 缺少依赖，请进入 ./plugins/' + pluginDir + ' 执行 pnpm install')
    logger.warn('[' + pluginDir + '] 详细错误：' + message)
    return
  }

  logger.error('[' + pluginDir + '] 载入插件错误：' + logger.red(name))
  logger.error(err)
}
