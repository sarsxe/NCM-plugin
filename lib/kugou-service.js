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

    try {
      // 加载 KuGouMusicApi 的 server 模块
      const serverModule = require(path.join(kugouRoot, 'server.js'))
      const appExt = await serverModule.startService()

      // 恢复环境变量
      if (originalPort !== undefined) process.env.PORT = originalPort
      else delete process.env.PORT
      if (originalHost !== undefined) process.env.HOST = originalHost
      else delete process.env.HOST

      return { app: appExt, server: appExt.service }
    } catch (err) {
      // 恢复环境变量
      if (originalPort !== undefined) process.env.PORT = originalPort
      else delete process.env.PORT
      if (originalHost !== undefined) process.env.HOST = originalHost
      else delete process.env.HOST
      throw err
    }
  }

}

const kugouService = new KugouService()
export default kugouService
