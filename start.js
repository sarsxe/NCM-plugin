import { startNcmApiService } from './lib/service.js'

try {
  await startNcmApiService({ from: 'standalone' })
} catch (err) {
  const message = String((err && err.message) || err)

  if (/Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND/.test(message)) {
    console.error('[NCMApi-plugin] 缺少依赖 NeteaseCloudMusicApi，请先在当前插件目录执行 pnpm install')
  }

  console.error(err)
  process.exit(1)
}
