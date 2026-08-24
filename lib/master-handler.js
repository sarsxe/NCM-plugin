import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginPath = path.resolve(__dirname, '..')
const yunzaiPath = path.resolve(pluginPath, '../..')
const configPath = path.join(yunzaiPath, 'config/config/other.yaml')

// 验证码存储（内存级，重启失效）
const verifyCodes = new Map()
const CODE_EXPIRE_MS = 5 * 60 * 1000 // 5分钟有效期

function getLogger() {
  return globalThis.logger || console
}

function logInfo(message) {
  const logger = getLogger()
  ;(logger.info || logger.log || console.log).call(logger, '[NCM-plugin] ' + message)
}

function logError(message, err) {
  const logger = getLogger()
  ;(logger.error || logger.warn || logger.log || console.error).call(logger, '[NCM-plugin] ' + message)
  if (err) {
    ;(logger.error || logger.warn || logger.log || console.error).call(logger, err)
  }
}

// 读取 Yunzai 主人配置
export function isMaster(userId) {
  try {
    if (!fs.existsSync(configPath)) {
      logError('主人配置文件不存在：' + configPath)
      return false
    }

    const yaml = require('yaml')
    const content = fs.readFileSync(configPath, 'utf8')
    const doc = yaml.parse(content)

    if (!doc || !Array.isArray(doc.masterQQ)) {
      return false
    }

    // masterQQ 数组可能包含字符串（如 "stdin"）和数字（QQ号）
    return doc.masterQQ.some(id => {
      if (typeof id === 'number') return id === userId
      if (typeof id === 'string') {
        const num = Number(id)
        return !isNaN(num) && num === userId
      }
      return false
    })
  } catch (err) {
    logError('读取主人配置失败', err)
    return false
  }
}

// 生成 ULID 格式的验证码
function generateUlid() {
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let time = Date.now()
  let str = ''

  // 10字符时间戳（48位）
  for (let i = 0; i < 10; i++) {
    str = ENCODING[time % 32] + str
    time = Math.floor(time / 32)
  }

  // 16字符随机数
  const random = crypto.randomBytes(10)
  for (let i = 0; i < 16; i++) {
    if (i < 10) {
      str += ENCODING[random[i] % 32]
    } else {
      str += ENCODING[Math.floor(Math.random() * 32)]
    }
  }

  return str
}

// 生成验证码
export function generateMasterVerifyCode(userId) {
  const code = generateUlid()
  const expireAt = Date.now() + CODE_EXPIRE_MS
  verifyCodes.set(String(userId), { code, expireAt })

  logInfo('为用户 [' + userId + '] 生成验证码：' + code)
  return code
}

// 验证验证码并设置主人
export async function verifyAndSetMaster(userId, inputCode) {
  const record = verifyCodes.get(String(userId))

  if (!record) {
    return { success: false, message: '未找到验证码，请先发送 #ncm设置主人' }
  }

  if (Date.now() > record.expireAt) {
    verifyCodes.delete(String(userId))
    return { success: false, message: '验证码已过期（有效期5分钟），请重新发送 #ncm设置主人' }
  }

  if (record.code !== inputCode.trim().toUpperCase()) {
    return { success: false, message: '验证码错误，请检查后重新输入' }
  }

  // 验证通过，写入配置
  try {
    const yaml = require('yaml')
    let doc

    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8')
      doc = yaml.parseDocument(content)
    } else {
      doc = new yaml.Document({})
    }

    // 确保 masterQQ 字段存在且为数组
    if (!doc.has('masterQQ')) {
      doc.set('masterQQ', new yaml.YAMLSeq())
    }

    const masterQQ = doc.get('masterQQ')
    if (!(masterQQ instanceof yaml.YAMLSeq)) {
      doc.set('masterQQ', new yaml.YAMLSeq())
    }

    // 检查是否已存在
    const existing = doc.get('masterQQ').items.some(item => {
      const val = item.value
      if (typeof val === 'number') return val === userId
      if (typeof val === 'string') {
        const num = Number(val)
        return !isNaN(num) && num === userId
      }
      return false
    })

    if (existing) {
      verifyCodes.delete(String(userId))
      return { success: true, message: '您已经是主人了，无需重复设置' }
    }

    // 添加新主人
    doc.get('masterQQ').add(yaml.Scalar(userId))

    // 写入文件
    fs.writeFileSync(configPath, doc.toString(), 'utf8')
    verifyCodes.delete(String(userId))

    logInfo('用户 [' + userId + '] 已成功设置为主人')
    return { success: true, message: '设置主人完成，您现在拥有双管乐·API 管理权限' }
  } catch (err) {
    logError('写入主人配置失败', err)
    return { success: false, message: '设置主人失败：' + String(err?.message || err) }
  }
}

// 清理过期验证码（可定时调用）
export function cleanExpiredCodes() {
  const now = Date.now()
  for (const [userId, record] of verifyCodes.entries()) {
    if (now > record.expireAt) {
      verifyCodes.delete(userId)
    }
  }
}
