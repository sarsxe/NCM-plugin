import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')
const CONFIG_FILE = join(DATA_DIR, 'config.json')

const DEFAULT_CONFIG = {
  // 顶层扁平配置（兼容原有 service.js 的网易云服务配置）
  host: '127.0.0.1',
  port: 3030,
  // 多平台服务配置
  ncm: {
    enabled: true,
    host: '127.0.0.1',
    port: 3030,
    cookie: ''
  },
  kugou: {
    enabled: true,
    host: '127.0.0.1',
    port: 3040,
    cookie: ''
  },
  // 帮助图样式配置
  style: {
    backdrop: '',
    backdropDefault: 'random',
    backdropTimeout: 5000
  }
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8')
      const saved = JSON.parse(content)
      return mergeConfig(DEFAULT_CONFIG, saved)
    }
  } catch (err) {
    console.warn('[NCM-plugin] 读取配置文件失败:', err.message)
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG))
}

export function saveConfig(config) {
  try {
    ensureDataDir()
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
  } catch (err) {
    console.error('[NCM-plugin] 保存配置文件失败:', err.message)
  }
}

export function getServiceConfig(serviceName) {
  const config = loadConfig()
  return config[serviceName] || null
}

export function setServiceConfig(serviceName, updates) {
  const config = loadConfig()
  if (!config[serviceName]) {
    config[serviceName] = {}
  }
  Object.assign(config[serviceName], updates)
  saveConfig(config)
  return config[serviceName]
}

/**
 * 获取顶层服务配置（供原有 service.js 使用）
 */
export function getTopConfig() {
  const config = loadConfig()
  return { host: config.host, port: config.port }
}

/**
 * 保存顶层服务配置（供原有 service.js 使用）
 */
export function saveTopConfig(updates) {
  const config = loadConfig()
  if (updates.host !== undefined) config.host = updates.host
  if (updates.port !== undefined) config.port = updates.port
  saveConfig(config)
}

export function getDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG))
}

function mergeConfig(defaults, saved) {
  const result = JSON.parse(JSON.stringify(defaults))
  for (const key of Object.keys(saved)) {
    if (typeof saved[key] === 'object' && saved[key] !== null && !Array.isArray(saved[key])) {
      if (!result[key]) result[key] = {}
      Object.assign(result[key], saved[key])
    } else {
      result[key] = saved[key]
    }
  }
  return result
}
