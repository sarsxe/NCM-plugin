import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { exec } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const vendorRoot = path.join(pluginRoot, 'vendor')
const vendorRequire = createRequire(path.join(vendorRoot, 'index.js'))

const VENDOR_NPMRC = 'allow-remote=all' + String.fromCharCode(10) + 'replace-registry-host=always' + String.fromCharCode(10)

function ensureVendorNpmrc() {
  try {
    const rcPath = path.join(vendorRoot, '.npmrc')
    if (!fs.existsSync(rcPath) || fs.readFileSync(rcPath, 'utf8') !== VENDOR_NPMRC) {
      fs.mkdirSync(vendorRoot, { recursive: true })
      fs.writeFileSync(rcPath, VENDOR_NPMRC)
    }
  } catch { /* non-fatal: CLI flags below still apply */ }
}

ensureVendorNpmrc()

const logger = () => globalThis.logger || console
const log = (fn, msg) => {
  const l = logger()
  ;(l[fn] || l.log || console.log).call(l, '[NCM-plugin][vendor] ' + msg)
}

/**
 * 插件内环境（vendor）说明：
 * 根项目的 pnpm workspace 会对 body-parser 打补丁，
 * 补丁行号与 1.20.x 不匹配，会把 case 'zstd': 打到 switch 语句之外，
 * 导致语法错误，进而让 NCM/酷狗 服务全部启动失败。
 * 因此插件在 vendor/ 目录用 npm 安装一套不受补丁污染的干净依赖，
 * 并通过本模块提供的 require 加载，实现自给自足的内环境。
 */

export function vendorInstalledVersion(name) {
  try {
    const pkgPath = path.join(vendorRoot, 'node_modules', name, 'package.json')
    if (!fs.existsSync(pkgPath)) return null
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || null
  } catch {
    return null
  }
}

export const VENDOR_DEPS = {
  express: '^4.18.2',
  'body-parser': '^1.20.1',
  NeteaseCloudMusicApi: '4.32.0',
  'safe-decode-uri-component': '^1.2.1',
  axios: '^1.1.3',
  'big-integer': '^1.6.52',
  'crypto-js': '^4.2.0',
  dotenv: '^16.4.5',
  'node-forge': '^1.3.3',
  pako: '^2.1.0',
  qrcode: '^1.5.3',
  url: '^0.11.4'
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''))
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null
}

function satisfies(installed, range) {
  if (!installed) return false
  if (!/^[\^~]/.test(range)) return installed === range
  const inst = parseSemver(installed)
  const base = parseSemver(range.replace(/^[\^~]/, ''))
  if (!inst || !base) return false
  if (range.startsWith('^')) {
    if (inst.major !== base.major) return false
  } else if (range.startsWith('~')) {
    if (inst.major !== base.major || inst.minor !== base.minor) return false
  }
  if (inst.major !== base.major) return inst.major > base.major
  if (inst.minor !== base.minor) return inst.minor > base.minor
  return inst.patch >= base.patch
}

export function vendorStatus() {
  const status = {}
  for (const [name, range] of Object.entries(VENDOR_DEPS)) {
    const installed = vendorInstalledVersion(name)
    status[name] = { installed, range, ok: satisfies(installed, range) }
  }
  return status
}

export function vendorReady() {
  return Object.values(vendorStatus()).every(s => s.ok)
}

function runCmd(command, cwd) {
  return new Promise(resolve => {
    exec(command, { cwd, windowsHide: true, timeout: 300000 }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr })
    })
  })
}

export async function ensureVendor({ force = false } = {}) {
  if (!force && vendorReady()) return { success: true, installed: false }
  log('info', force ? '强制重建 vendor 内环境...' : '检测到 vendor 内环境缺失/版本不符，正在安装...')
  const specList = Object.entries(VENDOR_DEPS).map(([n, v]) => n + '@' + v).join(' ')
  ensureVendorNpmrc()
  const ret = await runCmd('npm install --omit=dev --no-audit --no-fund --loglevel=error --allow-remote=all --replace-registry-host=always ' + specList, vendorRoot)
  if (ret.error) {
    log('error', 'vendor 依赖安装失败: ' + (ret.stderr || ret.error.message))
    return { success: false, error: ret.stderr || String(ret.error) }
  }
  if (!vendorReady()) {
    return { success: false, error: '安装后版本校验未通过' }
  }
  log('info', 'vendor 内环境就绪')
  return { success: true, installed: true }
}

export async function vendorInstall(spec) {
  const m = /^(.+?)(?:@(.+))?$/.exec(spec)
  const name = m[1]
  const version = m[2] || 'latest'
  if (!(name in VENDOR_DEPS)) {
    return { success: false, error: '不支持的依赖: ' + name + '，仅允许: ' + Object.keys(VENDOR_DEPS).join(', ') }
  }
  log('info', '正在 vendor 内环境安装 ' + name + '@' + version + ' ...')
  ensureVendorNpmrc()
  const ret = await runCmd('npm install --omit=dev --no-audit --no-fund --loglevel=error --allow-remote=all --replace-registry-host=always ' + name + '@' + version, vendorRoot)
  if (ret.error) {
    log('error', 'vendor 依赖安装失败: ' + (ret.stderr || ret.error.message))
    return { success: false, error: ret.stderr || String(ret.error) }
  }
  const installed = vendorInstalledVersion(name)
  return { success: true, name, version: installed }
}

export function vend(name) {
  try {
    return vendorRequire(name)
  } catch (err) {
    if (typeof name === 'string' && name.startsWith(pluginRoot)) {
      throw err
    }
    log('warn', 'vendor load ' + name + ' failed: ' + err.message)
    throw err
  }
}

export function vendStrict(name) {
  return vendorRequire(name)
}

export { vendorRoot }
