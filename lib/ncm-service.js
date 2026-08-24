import {
  getNcmApiServiceStatus,
  startNcmApiService,
  stopNcmApiService,
  reloadNcmApiService
} from './service.js'
import { getServiceConfig } from './config.js'

/**
 * 网易云音乐 API 服务适配器
 * 桥接到 service.js 的全局服务状态，避免与原有网易云管理逻辑重复启动
 * 默认端口：3030
 */
class NcmServiceAdapter {
  constructor() {
    const cfg = getServiceConfig('ncm') || {}
    this.name = 'ncm'
    this.displayName = '网易云API'
    this.defaultHost = cfg.host || '127.0.0.1'
    this.defaultPort = cfg.port || 3030
  }

  async start(options = {}) {
    return startNcmApiService({
      host: options.host || this.defaultHost,
      port: options.port || this.defaultPort
    })
  }

  async stop() {
    const result = await stopNcmApiService()
    return { stopped: result.stopped, reason: result.reason }
  }

  async restart(options = {}) {
    await reloadNcmApiService({
      host: options.host || this.defaultHost,
      port: options.port || this.defaultPort
    })
    return this.getFullStatus()
  }

  async getFullStatus() {
    const status = await getNcmApiServiceStatus()
    return {
      name: this.name,
      displayName: this.displayName,
      started: status.started,
      starting: status.starting,
      external: status.external,
      config: status.config,
      actualPort: status.config?.port || this.defaultPort,
      startTime: status.startTime,
      uptimeMs: status.uptimeMs,
      reachable: status.reachable,
      error: status.error
    }
  }

}

// 单例
const ncmService = new NcmServiceAdapter()
export default ncmService
