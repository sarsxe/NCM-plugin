import {
  getNcmApiServiceStatus,
  reloadNcmApiService,
  startNcmApiService,
  stopNcmApiService,
  saveNcmApiConfig
} from './service.js'

function formatDuration(ms) {
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

function formatTime(timestamp) {
  if (!timestamp) return '未记录'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function trimText(text, max = 500) {
  const value = String(text || '')
  return value.length > max ? value.slice(0, max) + '...' : value
}

function getStatusLines(status) {
  const stateText = status.starting ? '启动中' : status.started ? '运行中' : '未运行'
  const modeText = status.started ? (status.external ? '外部复用' : '内置服务') : '未启动'
  const lines = [
    'NCMApi 运行状态',
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
    return { success: true, message: 'NCMApi 正在启动中，请稍后再查看状态' }
  }

  try {
    await startNcmApiService()
    const after = await getNcmApiServiceStatus()
    const title = before.started ? 'NCMApi 已在运行' : 'NCMApi 启动完成'
    return { success: true, message: buildActionMessage(title, after) }
  } catch (err) {
    return { success: false, message: 'NCMApi 启动失败\n' + trimText(err?.message || err, 500) }
  }
}

// 重载服务
export async function handleReload() {
  const before = await getNcmApiServiceStatus()
  if (before.external) {
    return {
      success: false,
      message: [
        'NCMApi 当前为外部复用服务，插件无法安全重载外部进程',
        '地址：http://' + before.config.host + ':' + before.config.port,
        '如需重载，请手动重启外部服务后再执行 #NCM状态 查看结果'
      ].join('\n')
    }
  }

  try {
    const result = await reloadNcmApiService()
    const after = await getNcmApiServiceStatus()
    const title = result.reason === 'started' ? 'NCMApi 未运行，已直接启动' : 'NCMApi 已重载'
    return { success: true, message: buildActionMessage(title, after) }
  } catch (err) {
    return { success: false, message: 'NCMApi 重载失败\n' + trimText(err?.message || err, 500) }
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
        'NCMApi 当前为外部复用服务，插件无法修改外部服务端口',
        '当前地址：http://' + before.config.host + ':' + before.config.port
      ].join('\n')
    }
  }

  if (before.starting) {
    return { success: false, message: 'NCMApi 正在启动中，请稍后再操作' }
  }

  try {
    if (before.started) {
      await stopNcmApiService()
    }
    await startNcmApiService({ port: newPort })
    saveNcmApiConfig({ port: newPort })
    const after = await getNcmApiServiceStatus()
    return { success: true, message: buildActionMessage('NCMApi 端口已变更至 ' + newPort, after) }
  } catch (err) {
    return { success: false, message: 'NCMApi 端口变更失败\n' + trimText(err?.message || err, 500) }
  }
}

// 重启服务
export async function handleRestart() {
  const before = await getNcmApiServiceStatus()
  if (before.external) {
    return {
      success: false,
      message: [
        'NCMApi 当前为外部复用服务，插件无法安全重启外部进程',
        '当前地址：http://' + before.config.host + ':' + before.config.port,
        '如需重启，请手动操作外部服务'
      ].join('\n')
    }
  }

  if (before.starting) {
    return { success: false, message: 'NCMApi 正在启动中，请稍后再操作' }
  }

  try {
    if (before.started) {
      await stopNcmApiService()
    }
    await startNcmApiService()
    const after = await getNcmApiServiceStatus()
    const title = before.started ? 'NCMApi 已重启' : 'NCMApi 已启动'
    return { success: true, message: buildActionMessage(title, after) }
  } catch (err) {
    return { success: false, message: 'NCMApi 重启失败\n' + trimText(err?.message || err, 500) }
  }
}
