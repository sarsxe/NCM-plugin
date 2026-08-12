import { replyCard } from '../lib/render.js'

const REDIS_ORIG_IMG_KEY = 'ncm:origImg:'

export class NcmHelp extends plugin {
  constructor() {
    super({
      name: '双管乐·API帮助',
      dsc: 'NCM-plugin 双管乐·API 帮助信息（图片版）',
      event: 'message',
      priority: 4000,
      rule: [
        { reg: '^#*(NCM|ncm)(帮助|help)$', fnc: 'help' },
        { reg: '^#?原图$', fnc: 'origImg' }
      ]
    })
  }

  async help() {
    const ok = await replyCard(this.e, 'help')
    if (!ok) await this.reply(this.getTextHelp())
    return true
  }

  async origImg(e) {
    const message_id = e.reply_id || (e.source
      ? (e.group?.getChatHistory
          ? (await e.group.getChatHistory(e.source.seq, 1))[0]?.message_id
          : (await e.friend?.getChatHistory(e.source.time, 1))?.[0]?.message_id
        )
      : false)
    if (!message_id) return false

    const data = await redis.get(REDIS_ORIG_IMG_KEY + message_id)
    if (!data) return false

    e.reply(segment.image(data))
    return true
  }

  getTextHelp() {
    return [
      'NCM-plugin 双管乐·API 统一管理',
      '',
      '【状态查看】',
      '  #ncm状态 - 查看所有服务状态',
      '  #ncm网易云状态 - 查看网易云API状态',
      '  #ncm酷狗状态 - 查看酷狗API状态',
      '',
      '【服务控制】(需主人权限)',
      '  #ncm启动 - 启动所有服务',
      '  #ncm停止 - 停止所有服务',
      '  #ncm重启 - 重启所有服务',
      '  #ncm网易云启动/停止/重启',
      '  #ncm酷狗启动/停止/重启',
      '',
      '【端口变更】(需主人权限)',
      '  #ncm网易云端口3030',
      '  #ncm酷狗端口3040',
      '',
      '【登录】(需主人权限)',
      '  #ncm网易登录 - 网易云扫码登录',
      '  #ncm酷狗登录 - 酷狗扫码登录',
      '',
      '【账号信息】',
      '  #ncm网易云信息 - 查看网易云账号/会员状态',
      '  #ncm酷狗信息 - 查看酷狗账号/会员状态',
      '',
      '【依赖管理】(需主人权限)',
      '  #ncm安装api [版本] - 安装指定/最新版API',
      '  #ncm更新api - 更新API到最新版',
      '  #ncmapi版本 - 查看API版本信息',
      '',
      '【其他】',
      '  #ncm帮助 - 显示本帮助',
      '  #原图 - 回复图片获取背景原图'
    ].join('\n')
  }
}
