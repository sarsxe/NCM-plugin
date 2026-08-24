import {
  getNcmApiServiceStatus,
  reloadNcmApiService,
  startNcmApiService,
  stopNcmApiService,
  saveNcmApiConfig
} from './service.js'
import ncmService from './ncm-service.js'
import kugouService from './kugou-service.js'
import { loadConfig, setServiceConfig } from './config.js'

export function formatDuration(ms) {
  if (!ms || ms < 1000) return '0秒'

  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts = []

  if (days) parts.push(days + '天')
  if (hours) parts.push(hours + '小时')
  if (minutes) parts.push(minutes + '分钟')
  if (seconds || !parts.length) parts.push(seconds + '秒')

  return parts.join('')
}

export function formatTime(timestamp) {
  if (!timestamp) return '未记录'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

export function trimText(text, max = 500) {
  const value = String(text || '')
  return value.length > max ? value.slice(0, max) + '...' : value
}

function getStatusLines(status) {
  const stateText = status.starting ? '启动中' : status.started ? '运行中' : '未运行'
  const modeText = status.started ? (status.external ? '外部复用' : '内置服务') : '未启动'
  const lines = [
    '网易云API 运行状态',
    '状态：' + stateText,
    '模式：' + modeText,
    '地址：http://' + status.config.host + ':' + status.config.port,
    '端口可达：' + (status.reachable ? '是' : '否'),
    '启动时间：' + (status.startTime ? formatTime(status.startTime) : '未记录'),
    '运行时长：' + (status.startTime ? formatDuration(status.uptimeMs) : '未开始')
  ]

  if (!status.started && status.reachable) {
    lines.push('提示：目标端口可达，但当前插件尚未接管该服务')
  }

  if (status.error) {
    lines.push('最近错误：' + trimText(status.error, 300))
  }

  return lines
}

function buildStatusMessage(status) {
  return getStatusLines(status).join('\n')
}

function buildActionMessage(title, status) {
  return [title, ...getStatusLines(status).slice(1)].join('\n')
}

// 检查权限（使用 Yunzai 内置 isMaster）
export function checkPermission(e) {
  if (!e.isMaster) {
    return { allowed: false, message: '您无权操作' }
  }
  return { allowed: true }
}

// 获取状态
export async function handleStatus() {
  const status = await getNcmApiServiceStatus()
  return buildStatusMessage(status)
}

// 启动服务
export async function handleStart() {
  const before = await getNcmApiServiceStatus()
  if (before.starting) {
    return { success: true, message: '网易云API 正在启动中，请稍后再查看状态' }
  }

  try {
    await startNcmApiService()
    const after = await getNcmApiServiceStatus()
    const title = before.started ? '网易云API 已在运行' : '网易云API 启动完成'
    return { success: true, message: buildActionMessage(title, after) }
  } catch (err) {
    return { success: false, message: '网易云API 启动失败\n' + trimText(err?.message || err, 500) }
  }
}

// 重载服务
export async function handleReload() {
  const before = await getNcmApiServiceStatus()
  if (before.external) {
    return {
      success: false,
      message: [
        '网易云API 当前为外部复用服务，插件无法安全重载外部进程',
        '地址：http://' + before.config.host + ':' + before.config.port,
        '如需重载，请手动重启外部服务后再执行 #NCM状态 查看结果'
      ].join('\n')
    }
  }

  try {
    const result = await reloadNcmApiService()
    const after = await getNcmApiServiceStatus()
    const title = result.reason === 'started' ? '网易云API 未运行，已直接启动' : '网易云API 已重载'
    return { success: true, message: buildActionMessage(title, after) }
  } catch (err) {
    return { success: false, message: '网易云API 重载失败\n' + trimText(err?.message || err, 500) }
  }
}

// 变更端口
export async function handleChangePort(msg) {
  const match = msg.match(/^#*(?:NCM|ncm)端口变更(\d+)$/i)
  if (!match) {
    return { success: false, message: '指令格式错误，请使用：#ncm端口变更<数字>' }
  }

  const newPort = parseInt(match[1], 10)
  if (newPort < 1 || newPort > 65535) {
    return { success: false, message: '端口范围无效，请输入 1-65535 之间的数字' }
  }

  const before = await getNcmApiServiceStatus()
  if (before.external) {
    return {
      success: false,
      message: [
        '网易云API 当前为外部复用服务，插件无法修改外部服务端口',
        '当前地址：http://' + before.config.host + ':' + before.config.port
      ].join('\n')
    }
  }

  if (before.starting) {
    return { success: false, message: '网易云API 正在启动中，请稍后再操作' }
  }

  try {
    if (before.started) {
      await stopNcmApiService()
    }
    await startNcmApiService({ port: newPort })
    saveNcmApiConfig({ port: newPort })
    const after = await getNcmApiServiceStatus()
    return { success: true, message: buildActionMessage('网易云API 端口已变更至 ' + newPort, after) }
  } catch (err) {
    return { success: false, message: '网易云API 端口变更失败\n' + trimText(err?.message || err, 500) }
  }
}

// 重启服务
export async function handleRestart() {
  const before = await getNcmApiServiceStatus()
  if (before.external) {
    return {
      success: false,
      message: [
        '网易云API 当前为外部复用服务，插件无法安全重启外部进程',
        '当前地址：http://' + before.config.host + ':' + before.config.port,
        '如需重启，请手动操作外部服务'
      ].join('\n')
    }
  }

  if (before.starting) {
    return { success: false, message: '网易云API 正在启动中，请稍后再操作' }
  }

  try {
    if (before.started) {
      await stopNcmApiService()
    }
    await startNcmApiService()
    const after = await getNcmApiServiceStatus()
    const title = before.started ? '网易云API 已重启' : '网易云API 已启动'
    return { success: true, message: buildActionMessage(title, after) }
  } catch (err) {
    return { success: false, message: '网易云API 重启失败\n' + trimText(err?.message || err, 500) }
  }
}

// ========== 多平台服务管理（网易云/酷狗） ==========

// 服务注册表
const services = {
  ncm: ncmService,
  kugou: kugouService
}

const serviceNames = {
  ncm: '网易云API',
  kugou: '酷狗API'
}

/**
 * 获取单个服务的状态文本
 */
function getServiceStatusLines(status) {
  const stateText = status.starting ? '启动中' : status.started ? '运行中' : '未运行'
  const modeText = status.started ? (status.external ? '外部复用' : '内置服务') : '未启动'
  const lines = [
    '【' + status.displayName + '】',
    '  状态：' + stateText,
    '  模式：' + modeText,
    '  地址：http://' + (status.config?.host || '127.0.0.1') + ':' + (status.actualPort || status.config?.port || '未知'),
    '  端口可达：' + (status.reachable ? '是' : '否'),
    '  运行时长：' + (status.startTime ? formatDuration(status.uptimeMs) : '未开始')
  ]
  if (status.error) {
    lines.push('  错误：' + trimText(status.error, 200))
  }
  return lines
}

/**
 * 获取所有服务的综合状态
 */
export async function handleAllStatus() {
  const lines = ['NCM-plugin 服务状态总览', '']
  for (const [name, service] of Object.entries(services)) {
    const config = loadConfig()
    if (!config[name]?.enabled) {
      lines.push('【' + serviceNames[name] + '】已禁用')
      lines.push('')
      continue
    }
    const status = await service.getFullStatus()
    lines.push(...getServiceStatusLines(status))
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * 获取单个服务的状态
 */
export async function handleServiceStatus(serviceName) {
  const service = services[serviceName]
  if (!service) {
    return '未知服务：' + serviceName
  }
  const status = await service.getFullStatus()
  return ['NCM-plugin ' + serviceNames[serviceName] + ' 状态', '', ...getServiceStatusLines(status)].join('\n')
}

/**
 * 启动所有已启用的服务
 */
export async function startAllServices() {
  const config = loadConfig()
  const results = []

  for (const [name, service] of Object.entries(services)) {
    if (!config[name]?.enabled) {
      results.push({ name, success: true, skipped: true })
      continue
    }
    try {
      await service.start({
        host: config[name].host,
        port: config[name].port
      })
      results.push({ name, success: true })
    } catch (err) {
      results.push({ name, success: false, error: err.message })
    }
  }

  return results
}

/**
 * 启动单个服务
 */
export async function handleStartService(serviceName) {
  const service = services[serviceName]
  if (!service) {
    return { success: false, message: '未知服务：' + serviceName }
  }

  const config = loadConfig()
  try {
    await service.start({
      host: config[serviceName]?.host,
      port: config[serviceName]?.port
    })
    const status = await service.getFullStatus()
    const lines = [serviceNames[serviceName] + ' 启动完成', '', ...getServiceStatusLines(status)]
    return { success: true, message: lines.join('\n') }
  } catch (err) {
    return { success: false, message: serviceNames[serviceName] + ' 启动失败\n' + trimText(err.message) }
  }
}

/**
 * 停止单个服务
 */
export async function handleStopService(serviceName) {
  const service = services[serviceName]
  if (!service) {
    return { success: false, message: '未知服务：' + serviceName }
  }

  const result = await service.stop()
  if (result.reason === 'not_started') {
    return { success: true, message: serviceNames[serviceName] + ' 当前未在运行' }
  }
  if (result.reason === 'external') {
    return { success: false, message: serviceNames[serviceName] + ' 为外部复用服务，无法停止' }
  }
  return { success: true, message: serviceNames[serviceName] + ' 已停止' }
}

/**
 * 重启单个服务
 */
export async function handleRestartService(serviceName) {
  const service = services[serviceName]
  if (!service) {
    return { success: false, message: '未知服务：' + serviceName }
  }

  const config = loadConfig()
  try {
    await service.restart({
      host: config[serviceName]?.host,
      port: config[serviceName]?.port
    })
    const status = await service.getFullStatus()
    const lines = [serviceNames[serviceName] + ' 已重启', '', ...getServiceStatusLines(status)]
    return { success: true, message: lines.join('\n') }
  } catch (err) {
    return { success: false, message: serviceNames[serviceName] + ' 重启失败\n' + trimText(err.message) }
  }
}

/**
 * 重启所有服务
 */
export async function handleRestartAll() {
  const config = loadConfig()
  const lines = ['NCM-plugin 全部服务重启', '']

  for (const [name, service] of Object.entries(services)) {
    if (!config[name]?.enabled) {
      lines.push('【' + serviceNames[name] + '】已禁用，跳过')
      continue
    }
    try {
      await service.restart({
        host: config[name].host,
        port: config[name].port
      })
      const status = await service.getFullStatus()
      lines.push(...getServiceStatusLines(status))
    } catch (err) {
      lines.push('【' + serviceNames[name] + '】重启失败：' + trimText(err.message, 200))
    }
    lines.push('')
  }

  return { success: true, message: lines.join('\n') }
}

/**
 * 变更端口
 */
export async function handleServicePort(serviceName, newPort) {
  const service = services[serviceName]
  if (!service) {
    return { success: false, message: '未知服务：' + serviceName }
  }

  if (newPort < 1 || newPort > 65535) {
    return { success: false, message: '端口范围无效，请输入 1-65535 之间的数字' }
  }

  try {
    const currentStatus = await service.getFullStatus()
    if (currentStatus.started && !currentStatus.external) {
      await service.stop()
    }
    await service.start({ port: newPort })
    setServiceConfig(serviceName, { port: newPort })
    const status = await service.getFullStatus()
    const lines = [serviceNames[serviceName] + ' 端口已变更至 ' + newPort, '', ...getServiceStatusLines(status)]
    return { success: true, message: lines.join('\n') }
  } catch (err) {
    return { success: false, message: serviceNames[serviceName] + ' 端口变更失败\n' + trimText(err.message) }
  }
}

/**
 * 获取服务实例（供外部使用）
 */
export function getService(name) {
  return services[name] || null
}

export { services, serviceNames }
