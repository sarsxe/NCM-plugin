import { createRequire } from 'node:module'
import net from 'node:net'

const require = createRequire(import.meta.url)

import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

function runCmd(command, options = {}) {
  return new Promise(resolve => {
    exec(command, {
      cwd: options.cwd || pluginRoot,
      windowsHide: true,
      timeout: options.timeout || 300000
    }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr })
    })
  })
}

/**
 * 根目录依赖自检与自愈：检测关键依赖是否缺失或断链，必要时清除后重装
 */
async function healRootDeps() {
  const pkgPath = path.join(pluginRoot, 'package.json')
  if (!fs.existsSync(pkgPath)) return { success: false, error: 'package.json 不存在' }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  const missing = []

  for (const dep of deps) {
    const depPath = path.join(pluginRoot, 'node_modules', dep)
    if (!fs.existsSync(depPath)) {
      missing.push(dep)
    }
  }

  logger.warn('[NCM-plugin] 检测到网易云服务依赖异常（' + (missing.join(', ') || '未知') + '），正在自动疗愈（重建依赖环境）...')

  await runCmd('rm -rf node_modules')
  const installRet = await runCmd('pnpm install', { timeout: 300000 })
  if (installRet.error) {
    return { success: false, error: installRet.stderr || String(installRet.error) }
  }

  // 清除 require 缓存中的相关记录，确保能重新加载
  if (require.cache) {
    for (const key of Object.keys(require.cache)) {
      if (key.includes('NeteaseCloudMusicApi') || key.startsWith(path.join(pluginRoot, 'node_modules'))) {
        delete require.cache[key]
      }
    }
  }

  return { success: true, missing }
}

// 兼容模式：检测 NeteaseCloudMusicApi 版本并选择启动方式
function detectNcmApiVersion() {
  try {
    const ncm = require('NeteaseCloudMusicApi')
    if (typeof ncm.serveNcmApi === 'function') {
      return { version: 4, module: ncm }
    }
    if (typeof ncm.search === 'function') {
      return { version: 3, module: ncm }
    }
    return { version: 0, module: null }
  } catch (err) {
    return { version: 0, module: null, error: err }
  }
}

// 3.x 兼容模式：使用 Express 搭建服务器
async function createCompatibleServer(config, ncmModule) {
  const express = require('express')
  const app = express()
  
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  
  // 健康检查端点
  app.get('/', (req, res) => {
    res.json({ code: 200, msg: 'NeteaseCloudMusicApi 3.x Compatible Server Running' })
  })
  
  // 动态注册所有 API 路由
  const apiModules = Object.keys(ncmModule).filter(key => typeof ncmModule[key] === 'function')
  
  for (const apiName of apiModules) {
    const routePath = `/${apiName}`
    app.all(routePath, async (req, res) => {
      try {
        const params = { ...req.query, ...req.body }
        const result = await ncmModule[apiName](params)
        res.json(result)
      } catch (err) {
        res.status(500).json({ code: 500, msg: err.message })
      }
    })
  }
  
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host, (err) => {
      if (err) return reject(err)
      resolve({ app, server, close: () => server.close() })
    })
  })
}
const PLUGIN_NAME = 'NCM-plugin'
const GLOBAL_KEY = Symbol.for('trss-yunzai.ncmapi-plugin.service')
const DEFAULT_HOST = process.env.NCMAPI_HOST || '127.0.0.1'
const DEFAULT_PORT = normalizePort(process.env.NCMAPI_PORT, 3030)

// 统一配置中心：从 config.js 导入配置读写能力
import { loadConfig, saveTopConfig } from './config.js'

function normalizePort(value, fallback = 3000) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fallback
  }
  return port
}

function getConnectHost(host) {
  if (!host || host === '0.0.0.0' || host === '::') return '127.0.0.1'
  return host
}

function getState() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      started: false,
      starting: null,
      external: false,
      config: null,
      error: null,
      app: null,
      server: null,
      startTime: null
    }
  }

  return globalThis[GLOBAL_KEY]
}

function getLogger() {
  return globalThis.logger || console
}

function logInfo(message) {
  const logger = getLogger()
  ;(logger.info || logger.log || console.log).call(logger, '[' + PLUGIN_NAME + '] ' + message)
}

function logWarn(message) {
  const logger = getLogger()
  ;(logger.warn || logger.info || logger.log || console.warn).call(logger, '[' + PLUGIN_NAME + '] ' + message)
}

function logError(message, err) {
  const logger = getLogger()
  ;(logger.error || logger.warn || logger.log || console.error).call(logger, '[' + PLUGIN_NAME + '] ' + message)
  if (err) {
    ;(logger.error || logger.warn || logger.log || console.error).call(logger, err)
  }
}

function resolveConfig(options = {}) {
  const state = getState()
  const baseConfig = state.config || {}
  const savedConfig = loadConfig()
  const host = options.host || baseConfig.host || savedConfig.ncm?.host || savedConfig.host || DEFAULT_HOST
  const port = normalizePort(options.port || baseConfig.port || savedConfig.ncm?.port || savedConfig.port || DEFAULT_PORT, DEFAULT_PORT)
  return { host, port }
}

export function saveNcmApiConfig(config) {
  saveTopConfig(config)
}

function normalizeError(err) {
  return err ? String(err?.message || err) : null
}

function isAddressInUse(err) {
  const text = [err?.code, err?.message, err?.cause?.message].filter(Boolean).join(' ')
  return /EADDRINUSE|address already in use/i.test(text)
}

function isPortReachable(host, port, timeout = 1000) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: getConnectHost(host), port })
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

function attachServer(server) {
  if (!server || typeof server.once !== 'function') return

  server.once('close', () => {
    const state = getState()
    if (state.server !== server) return

    state.started = false
    state.external = false
    state.app = null
    state.server = null
    state.startTime = null
  })
}

function clearRuntimeState({ preserveConfig = true } = {}) {
  const state = getState()
  const config = preserveConfig ? (state.config || resolveConfig()) : null

  state.started = false
  state.external = false
  state.app = null
  state.server = null
  state.startTime = null
  state.error = null
  state.config = config
}

export function getNcmApiServiceState() {
  const state = getState()
  return {
    started: state.started,
    starting: Boolean(state.starting),
    external: state.external,
    config: state.config,
    startTime: state.startTime,
    uptimeMs: state.startTime ? Math.max(0, Date.now() - state.startTime) : 0,
    error: normalizeError(state.error)
  }
}

export async function getNcmApiServiceStatus(options = {}) {
  const state = getState()
  const config = resolveConfig(options)
  const reachable = await isPortReachable(config.host, config.port)

  if (state.started && !state.external && (!state.server || !state.server.listening) && !state.starting) {
    clearRuntimeState()
  }

  if (state.started && state.external && !reachable && !state.starting) {
    clearRuntimeState()
  }

  return {
    started: state.started,
    starting: Boolean(state.starting),
    external: state.external,
    managed: state.started && !state.external,
    config,
    reachable,
    startTime: state.startTime,
    uptimeMs: state.startTime ? Math.max(0, Date.now() - state.startTime) : 0,
    error: normalizeError(state.error)
  }
}

export async function startNcmApiService(options = {}) {
  const state = getState()
  const config = resolveConfig(options)

  if (state.started) {
    if (state.external) {
      if (await isPortReachable(config.host, config.port)) return state.config || config
      clearRuntimeState()
    } else if (state.server && state.server.listening) {
      return state.config || config
    } else {
      clearRuntimeState()
    }
  }

  if (state.starting) return state.starting

  state.starting = (async () => {
    try {
      let ncmInfo = detectNcmApiVersion()

      if (ncmInfo.version === 0) {
        // 依赖自愈：模块加载失败时自动重建依赖环境并重试一次
        const healResult = await healRootDeps()
        if (healResult.success) {
          logInfo('依赖疗愈完成，正在重试启动网易云API...')
          ncmInfo = detectNcmApiVersion()
        }
        if (ncmInfo.version === 0) {
          throw new Error('无法加载 NeteaseCloudMusicApi 模块' + (ncmInfo.error ? ': ' + ncmInfo.error.message : ''))
        }
      }
      
      let app, server
      
      if (ncmInfo.version === 4) {
        // 禁用 4.x 内置的 2 分钟响应缓存，避免下游插件（如 rconsole-plugin）
        // 请求 /login/qr/key 等接口时命中缓存拿到旧的 unikey，导致扫码登录失败
        try {
          require('NeteaseCloudMusicApi/util/apicache').options({ enabled: false })
        } catch {}
        // 4.x 版本：使用原生 serveNcmApi
        const result = await ncmInfo.module.serveNcmApi(config)
        app = result
        server = result?.server || null
        logInfo('使用 NeteaseCloudMusicApi 4.x 原生模式启动')
      } else {
        // 3.x 版本：使用兼容模式
        const result = await createCompatibleServer(config, ncmInfo.module)
        app = result.app
        server = result.server
        logInfo('使用 NeteaseCloudMusicApi 3.x 兼容模式启动')
      }

      state.started = true
      state.external = false
      state.config = config
      state.error = null
      state.app = app || null
      state.server = server
      state.startTime = Date.now()

      attachServer(server)
      logInfo('本地 NeteaseCloudMusicApi 已启动：http://' + config.host + ':' + config.port)
      return config
    } catch (err) {
      if (isAddressInUse(err) && await isPortReachable(config.host, config.port)) {
        state.started = true
        state.external = true
        state.config = config
        state.error = null
        state.app = null
        state.server = null
        state.startTime = Date.now()

        logWarn('检测到 ' + config.host + ':' + config.port + ' 已有服务占用，跳过内置启动并复用现有服务')
        return config
      }

      state.started = false
      state.external = false
      state.app = null
      state.server = null
      state.startTime = null
      state.config = config
      state.error = err

      logError('本地 NeteaseCloudMusicApi 启动失败', err)
      throw err
    } finally {
      state.starting = null
    }
  })()

  return state.starting
}

export async function stopNcmApiService(options = {}) {
  const state = getState()
  const config = resolveConfig(options)

  if (state.starting) {
    try {
      await state.starting
    } catch {}
  }

  if (!state.started) {
    return {
      stopped: false,
      reason: 'not_started',
      external: false,
      config
    }
  }

  if (state.external) {
    return {
      stopped: false,
      reason: 'external',
      external: true,
      config
    }
  }

  const server = state.server || state.app?.server
  if (!server) {
    clearRuntimeState()
    return {
      stopped: true,
      reason: 'no_server_handle',
      external: false,
      config
    }
  }

  await new Promise((resolve, reject) => {
    try {
      server.close(err => err ? reject(err) : resolve())
    } catch (err) {
      reject(err)
    }
  })

  clearRuntimeState()
  logInfo('本地 NeteaseCloudMusicApi 已停止')

  return {
    stopped: true,
    reason: 'stopped',
    external: false,
    config
  }
}

export async function reloadNcmApiService(options = {}) {
  const config = resolveConfig(options)
  const status = await getNcmApiServiceStatus(config)

  if (status.external) {
    return {
      reloaded: false,
      reason: 'external',
      config: status.config
    }
  }

  if (status.started) {
    await stopNcmApiService(config)
    await startNcmApiService(config)
    return {
      reloaded: true,
      reason: 'restarted',
      config
    }
  }

  await startNcmApiService(config)
  return {
    reloaded: true,
    reason: 'started',
    config
  }
}
