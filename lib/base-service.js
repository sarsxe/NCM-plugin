import net from 'node:net'

const PLUGIN_NAME = 'NCM-plugin'

/**
 * 通用 API 服务基类
 * 提供端口检测、自动递增、状态管理、启停控制等通用能力
 */
export class BaseService {
  constructor(name, options = {}) {
    this.name = name
    this.displayName = options.displayName || name
    this.defaultHost = options.host || '127.0.0.1'
    this.defaultPort = options.port || 3000
    this.maxPortRetry = options.maxPortRetry || 10

    // 运行时状态
    this.started = false
    this.starting = null
    this.external = false
    this.config = null
    this.error = null
    this.app = null
    this.server = null
    this.startTime = null
    this.actualPort = null
  }

  getLogger() {
    return globalThis.logger || console
  }

  logInfo(message) {
    const logger = this.getLogger()
    ;(logger.info || logger.log || console.log).call(logger, '[' + PLUGIN_NAME + '][' + this.displayName + '] ' + message)
  }

  logWarn(message) {
    const logger = this.getLogger()
    ;(logger.warn || logger.log || console.warn).call(logger, '[' + PLUGIN_NAME + '][' + this.displayName + '] ' + message)
  }

  logError(message, err) {
    const logger = this.getLogger()
    ;(logger.error || logger.log || console.error).call(logger, '[' + PLUGIN_NAME + '][' + this.displayName + '] ' + message)
    if (err) {
      ;(logger.error || logger.log || console.error).call(logger, err)
    }
  }

  normalizePort(value, fallback) {
    const port = Number(value)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return fallback || this.defaultPort
    }
    return port
  }

  getConnectHost(host) {
    if (!host || host === '0.0.0.0' || host === '::') return '127.0.0.1'
    return host
  }

  isPortReachable(host, port, timeout = 1000) {
    return new Promise(resolve => {
      const socket = net.createConnection({ host: this.getConnectHost(host), port })
      let settled = false

      const finish = value => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve(value)
      }

      socket.setTimeout(timeout)
      socket.once('connect', () => finish(true))
      socket.once('timeout', () => finish(false))
      socket.once('error', () => finish(false))
    })
  }

  /**
   * 自动寻找可用端口，从 basePort 开始，被占用则 +1
   */
  async findAvailablePort(host, basePort) {
    for (let i = 0; i < this.maxPortRetry; i++) {
      const port = basePort + i
      const inUse = await this.isPortReachable(host, port)
      if (!inUse) {
        return port
      }
      this.logWarn('端口 ' + port + ' 已被占用，尝试 ' + (port + 1))
    }
    throw new Error('无法找到可用端口（已尝试 ' + basePort + '-' + (basePort + this.maxPortRetry - 1) + '）')
  }

  isAddressInUse(err) {
    const text = [err?.code, err?.message, err?.cause?.message].filter(Boolean).join(' ')
    return /EADDRINUSE|address already in use/i.test(text)
  }

  clearState() {
    this.started = false
    this.starting = null
    this.external = false
    this.app = null
    this.server = null
    this.startTime = null
    this.error = null
    this.actualPort = null
  }

  getStatus() {
    return {
      name: this.name,
      displayName: this.displayName,
      started: this.started,
      starting: Boolean(this.starting),
      external: this.external,
      config: this.config,
      actualPort: this.actualPort,
      startTime: this.startTime,
      uptimeMs: this.startTime ? Math.max(0, Date.now() - this.startTime) : 0,
      error: this.error ? String(this.error?.message || this.error) : null
    }
  }

  async getFullStatus() {
    const config = this.config || { host: this.defaultHost, port: this.defaultPort }
    const port = this.actualPort || config.port
    const reachable = await this.isPortReachable(config.host, port)

    return {
      ...this.getStatus(),
      reachable,
      config: { host: config.host, port }
    }
  }

  /**
   * 启动服务（子类需实现 _doStart 方法）
   */
  async start(options = {}) {
    const host = options.host || this.defaultHost
    const port = this.normalizePort(options.port, this.defaultPort)

    if (this.started) {
      if (this.external) {
        if (await this.isPortReachable(host, this.actualPort || port)) {
          return this.config
        }
        this.clearState()
      } else if (this.server && this.server.listening) {
        return this.config
      } else {
        this.clearState()
      }
    }

    if (this.starting) return this.starting

    this.starting = (async () => {
      try {
        // 自动寻找可用端口
        const availablePort = await this.findAvailablePort(host, port)
        const config = { host, port: availablePort }

        const { app, server } = await this._doStart(config)

        this.started = true
        this.external = false
        this.config = config
        this.actualPort = availablePort
        this.error = null
        this.app = app || null
        this.server = server || null
        this.startTime = Date.now()

        if (server && typeof server.once === 'function') {
          server.once('close', () => {
            if (this.server === server) {
              this.clearState()
            }
          })
        }

        this.logInfo('已启动：http://' + host + ':' + availablePort)
        return config
      } catch (err) {
        if (this.isAddressInUse(err)) {
          const reachable = await this.isPortReachable(host, port)
          if (reachable) {
            this.started = true
            this.external = true
            this.config = { host, port }
            this.actualPort = port
            this.error = null
            this.startTime = Date.now()
            this.logWarn('端口 ' + port + ' 已有服务占用，复用现有服务')
            return this.config
          }
        }

        this.started = false
        this.error = err
        this.logError('启动失败', err)
        throw err
      } finally {
        this.starting = null
      }
    })()

    return this.starting
  }

  /**
   * 停止服务
   */
  async stop() {
    if (this.starting) {
      try { await this.starting } catch {}
    }

    if (!this.started) {
      return { stopped: false, reason: 'not_started' }
    }

    if (this.external) {
      return { stopped: false, reason: 'external' }
    }

    const server = this.server
    if (!server) {
      this.clearState()
      return { stopped: true, reason: 'no_server_handle' }
    }

    await new Promise((resolve, reject) => {
      try {
        server.close(err => err ? reject(err) : resolve())
      } catch (err) {
        reject(err)
      }
    })

    this.clearState()
    this.logInfo('已停止')
    return { stopped: true, reason: 'stopped' }
  }

  /**
   * 重启服务
   */
  async restart(options = {}) {
    const host = options.host || this.config?.host || this.defaultHost
    const port = options.port || this.config?.port || this.defaultPort

    if (this.started && !this.external) {
      await this.stop()
    }

    return this.start({ host, port })
  }

  /**
   * 子类必须实现：实际启动逻辑
   * @returns {{ app, server }}
   */
  async _doStart(config) {
    throw new Error('子类必须实现 _doStart 方法')
  }
}
