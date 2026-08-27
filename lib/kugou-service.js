import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { BaseService } from './base-service.js'
import { getServiceConfig } from './config.js'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 酷狗音乐 API 服务
 * 默认端口：3040
 * 基于 KuGouMusicApi 开源项目提供完整酷狗 API
 */
class KugouService extends BaseService {
  constructor() {
    const cfg = getServiceConfig('kugou') || {}
    super('kugou', {
      displayName: '酷狗API',
      host: cfg.host || '127.0.0.1',
      port: cfg.port || 3040
    })
  }

  async _doStart(config) {
    const kugouRoot = path.resolve(__dirname, '../resources/kugou')

    // 设置环境变量供 KuGouMusicApi 读取
    const originalPort = process.env.PORT
    const originalHost = process.env.HOST
    process.env.PORT = String(config.port)
    process.env.HOST = config.host

    const restoreEnv = () => {
      if (originalPort !== undefined) process.env.PORT = originalPort
      else delete process.env.PORT
      if (originalHost !== undefined) process.env.HOST = originalHost
      else delete process.env.HOST
    }

    const tryStart = async () => {
      const serverModule = require(path.join(kugouRoot, 'server.js'))
      const appExt = await serverModule.startService()
      return { app: appExt, server: appExt.service }
    }

    try {
      const result = await tryStart()
      restoreEnv()
      return result
    } catch (err) {
      restoreEnv()

      // 模块缺失/断链自愈：检测到 MODULE_NOT_FOUND 时自动补装依赖并重试一次
      if (err && err.code === 'MODULE_NOT_FOUND') {
        this.logWarn('检测到依赖缺失或失效，正在自动疗愈（重新安装依赖）...')
        try {
          const { checkKugouDeps } = await import('./kugou-updater.js')
          const healResult = await checkKugouDeps()
          if (healResult.success) {
            this.logInfo('依赖疗愈完成，正在重试启动...')
            // 清除 require 缓存中该模块的失败记录，确保能重新加载
            const serverPath = require.resolve ? path.join(kugouRoot, 'server.js') : null
            if (serverPath && require.cache) {
              for (const key of Object.keys(require.cache)) {
                if (key.startsWith(kugouRoot)) delete require.cache[key]
              }
            }
            const retryResult = await tryStart()
            this.logInfo('酷狗API自动疗愈并启动成功')
            return retryResult
          }
        } catch (healErr) {
          this.logError('自动疗愈失败', healErr)
        }
      }
      throw err
    }
  }

}

const kugouService = new KugouService()
export default kugouService
