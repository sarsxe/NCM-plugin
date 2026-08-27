import fs from 'node:fs'
import path from 'node:path'
import { exec, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const logger = globalThis.logger || {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  mark: (...args) => console.log(...args),
  log: (...args) => console.log(...args)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginPath = path.resolve(__dirname, '..')
const kugouPath = path.join(pluginPath, 'resources', 'kugou')
const tempDir = path.join(pluginPath, '../../temp/ncm-kugou-update-tmp')
const backupDir = path.join(pluginPath, '../../temp/ncm-kugou-backup')

const UPSTREAM_REPO = 'https://github.com/MakcRe/KuGouMusicApi.git'
const MIRROR_REPO = 'https://ghproxy.com/https://github.com/MakcRe/KuGouMusicApi.git'

function runCmd(command, options = {}) {
  return new Promise(resolve => {
    exec(command, {
      cwd: options.cwd || pluginPath,
      windowsHide: true,
      timeout: options.timeout || 120000,
      env: { ...process.env, ...options.env }
    }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr })
    })
  })
}

async function checkFileExists(filePath) {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

async function mkdirIfNotExists(dir) {
  try {
    await fs.promises.access(dir)
  } catch {
    await fs.promises.mkdir(dir, { recursive: true })
  }
}

async function copyFiles(srcDir, destDir, exclude = []) {
  try {
    await mkdirIfNotExists(destDir)
    const files = await fs.promises.readdir(srcDir)
    for (const file of files) {
      if (exclude.includes(file)) continue
      const srcFile = path.join(srcDir, file)
      const destFile = path.join(destDir, file)
      const stat = await fs.promises.stat(srcFile)
      if (stat.isDirectory()) {
        await copyFiles(srcFile, destFile, exclude)
      } else {
        await fs.promises.copyFile(srcFile, destFile)
      }
    }
  } catch (err) {
    logger.error(`[NCM-plugin][拷贝文件] 失败: ${err.message}`)
    throw err
  }
}

async function deleteFolderRecursive(folderPath) {
  try {
    const exists = await checkFileExists(folderPath)
    if (!exists) return
    const files = await fs.promises.readdir(folderPath)
    for (const file of files) {
      const curPath = path.join(folderPath, file)
      const stat = await fs.promises.stat(curPath)
      if (stat.isDirectory()) {
        await deleteFolderRecursive(curPath)
        await fs.promises.rmdir(curPath)
      } else {
        await fs.promises.unlink(curPath)
      }
    }
  } catch (err) {
    logger.error(`[NCM-plugin][清理目录] 失败: ${err.message}`)
    throw err
  }
}

function getLocalVersion() {
  try {
    const pkgPath = path.join(kugouPath, 'package.json')
    if (!fs.existsSync(pkgPath)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return pkg.version || null
  } catch {
    return null
  }
}

function getUpstreamVersion(repoDir) {
  try {
    const pkgPath = path.join(repoDir, 'package.json')
    if (!fs.existsSync(pkgPath)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return pkg.version || null
  } catch {
    return null
  }
}

async function cloneUpstream(useMirror = false) {
  const repo = useMirror ? MIRROR_REPO : UPSTREAM_REPO
  const repoName = useMirror ? '镜像源' : '官方源'
  
  logger.info(`[NCM-plugin][酷狗API] 正在从${repoName}克隆上游仓库...`)
  
  await deleteFolderRecursive(tempDir)
  await mkdirIfNotExists(path.dirname(tempDir))
  
  const cloneRet = await runCmd(`git clone --depth 1 ${repo} "${tempDir}"`, {
    timeout: 180000
  })
  
  if (cloneRet.error) {
    return { success: false, error: cloneRet.error, stderr: cloneRet.stderr }
  }
  
  const serverExists = await checkFileExists(path.join(tempDir, 'server.js'))
  const pkgExists = await checkFileExists(path.join(tempDir, 'package.json'))
  
  if (!serverExists || !pkgExists) {
    return { success: false, error: new Error('克隆内容不完整，缺少关键文件') }
  }
  
  return { success: true, repoDir: tempDir }
}

async function backupKugou() {
  try {
    await deleteFolderRecursive(backupDir)
    await mkdirIfNotExists(path.dirname(backupDir))
    await copyFiles(kugouPath, backupDir, ['node_modules'])
    logger.mark('[NCM-plugin][酷狗API] 备份成功')
    return { success: true }
  } catch (err) {
    logger.error(`[NCM-plugin][酷狗API] 备份失败: ${err.message}`)
    return { success: false, error: err }
  }
}

async function restoreKugou() {
  try {
    const backupExists = await checkFileExists(backupDir)
    if (!backupExists) {
      logger.warn('[NCM-plugin][酷狗API] 备份不存在，无法回滚')
      return { success: false }
    }
    await deleteFolderRecursive(kugouPath)
    await copyFiles(backupDir, kugouPath)
    logger.mark('[NCM-plugin][酷狗API] 已回滚到更新前版本')
    return { success: true }
  } catch (err) {
    logger.error(`[NCM-plugin][酷狗API] 回滚失败: ${err.message}`)
    return { success: false, error: err }
  }
}

async function syncKugou(repoDir) {
  const excludeFiles = ['node_modules', '.env', 'data', '.git']
  
  try {
    const files = await fs.promises.readdir(kugouPath)
    for (const file of files) {
      if (excludeFiles.includes(file)) continue
      const filePath = path.join(kugouPath, file)
      const stat = await fs.promises.stat(filePath)
      if (stat.isDirectory()) {
        await deleteFolderRecursive(filePath)
      } else {
        await fs.promises.unlink(filePath)
      }
    }
    
    await copyFiles(repoDir, kugouPath, excludeFiles)
    
    logger.mark('[NCM-plugin][酷狗API] 文件同步完成')
    return { success: true }
  } catch (err) {
    logger.error(`[NCM-plugin][酷狗API] 文件同步失败: ${err.message}`)
    return { success: false, error: err }
  }
}

async function installKugouDeps() {
  logger.info('[NCM-plugin][酷狗API] 正在重建依赖环境（清除旧依赖后全新安装）...')

  // 先清除旧依赖目录，防止符号链接因目录迁移或根依赖变动而断链
  await runCmd('rm -rf node_modules', { cwd: kugouPath, timeout: 60000 })

  const installRet = await runCmd('pnpm install', {
    cwd: kugouPath,
    timeout: 300000
  })
  
  if (installRet.error) {
    return { success: false, error: installRet.error, stderr: installRet.stderr }
  }
  
  return { success: true }
}

async function cleanupStaleTemps(maxAgeMs = 24 * 60 * 60 * 1000) {
  const dirs = [tempDir, backupDir]
  for (const dir of dirs) {
    try {
      const exists = await checkFileExists(dir)
      if (!exists) continue
      const stat = await fs.promises.stat(dir)
      if (Date.now() - stat.mtimeMs > maxAgeMs) {
        await deleteFolderRecursive(dir)
        await fs.promises.rmdir(dir).catch(() => {})
        logger.info(`[NCM-plugin][酷狗API] 已清理陈旧临时目录: ${path.basename(dir)}`)
      }
    } catch (err) {
      logger.warn(`[NCM-plugin][酷狗API] 清理陈旧临时目录失败: ${err.message}`)
    }
  }
}

export async function updateKugou(options = {}) {
  const { useMirror = false, force = false } = options

  await cleanupStaleTemps()

  const localVersion = getLocalVersion()
  logger.info(`[NCM-plugin][酷狗API] 当前版本: ${localVersion || 'unknown'}`)
  
  let cloneResult = await cloneUpstream(useMirror)
  
  if (!cloneResult.success && !useMirror) {
    logger.warn('[NCM-plugin][酷狗API] 官方源克隆失败，尝试镜像源...')
    cloneResult = await cloneUpstream(true)
  }
  
  if (!cloneResult.success) {
    return {
      success: false,
      error: '克隆上游仓库失败',
      detail: cloneResult.stderr || String(cloneResult.error)
    }
  }
  
  const upstreamVersion = getUpstreamVersion(cloneResult.repoDir)
  logger.info(`[NCM-plugin][酷狗API] 上游版本: ${upstreamVersion || 'unknown'}`)
  
  if (!force && localVersion && upstreamVersion && localVersion === upstreamVersion) {
    await deleteFolderRecursive(tempDir)
    return {
      success: true,
      updated: false,
      message: `酷狗API已是最新版本 ${localVersion}`,
      localVersion,
      upstreamVersion
    }
  }
  
  const backupResult = await backupKugou()
  if (!backupResult.success) {
    await deleteFolderRecursive(tempDir)
    return {
      success: false,
      error: '备份失败，更新已中止',
      detail: String(backupResult.error)
    }
  }
  
  const syncResult = await syncKugou(cloneResult.repoDir)
  if (!syncResult.success) {
    await restoreKugou()
    await deleteFolderRecursive(tempDir)
    return {
      success: false,
      error: '文件同步失败，已回滚',
      detail: String(syncResult.error)
    }
  }
  
  const installResult = await installKugouDeps()
  if (!installResult.success) {
    await restoreKugou()
    await deleteFolderRecursive(tempDir)
    return {
      success: false,
      error: '依赖安装失败，已回滚',
      detail: installResult.stderr || String(installResult.error)
    }
  }
  
  await deleteFolderRecursive(tempDir)
  await deleteFolderRecursive(backupDir)
  
  return {
    success: true,
    updated: true,
    message: `酷狗API更新成功 ${localVersion || 'unknown'} → ${upstreamVersion || 'unknown'}`,
    localVersion,
    upstreamVersion
  }
}

export async function checkKugouDeps() {
  const pkgPath = path.join(kugouPath, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    return { success: false, error: 'kugou package.json 不存在' }
  }
  
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const deps = Object.keys(pkg.dependencies || {})
  const missing = []
  
  let hasBrokenLink = false
  for (const dep of deps) {
    const depPath = path.join(kugouPath, 'node_modules', dep)
    if (!fs.existsSync(depPath)) {
      try {
        fs.lstatSync(depPath)
        hasBrokenLink = true
        logger.warn(`[NCM-plugin][酷狗API] 检测到失效链接: ${dep}`)
      } catch {}
      missing.push(dep)
    }
  }
  if (hasBrokenLink) {
    logger.warn('[NCM-plugin][酷狗API] 依赖存在失效链接，已触发完整重建')
  }
  
  if (missing.length === 0) {
    return { success: true, missing: [] }
  }
  
  logger.warn(`[NCM-plugin][酷狗API] 检测到缺失依赖: ${missing.join(', ')}`)
  
  const installResult = await installKugouDeps()
  if (!installResult.success) {
    return {
      success: false,
      error: '依赖补全失败',
      missing,
      detail: installResult.stderr || String(installResult.error)
    }
  }
  
  return {
    success: true,
    missing,
    message: `已补全 ${missing.length} 个缺失依赖`
  }
}

export function getKugouVersion() {
  return getLocalVersion()
}
