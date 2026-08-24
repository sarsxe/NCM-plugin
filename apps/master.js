import {
  isMaster,
  generateMasterVerifyCode,
  verifyAndSetMaster
} from '../lib/master-handler.js'

export class ncmMaster extends plugin {
  constructor() {
    super({
      name: '双管乐·API主人设置',
      dsc: 'NCM-plugin 双管乐·API 备用主人设置（验证码机制）',
      event: 'message',
      priority: 4000,
      rule: [
        {
          reg: '^#*(NCM|ncm)设置主人$',
          fnc: 'setMaster'
        },
        {
          reg: '^#*(NCM|ncm)设置主人验证码',
          fnc: 'verifyMaster'
        }
      ]
    })
  }

  // 生成并发送验证码
  async setMaster() {
    const userId = this.e.user_id

    // 检查是否已经是主人
    if (isMaster(userId)) {
      await this.reply('您已经是主人了，无需重复设置')
      return true
    }

    const code = generateMasterVerifyCode(userId)

    // 向用户私聊发送验证码
    if (this.e.isGroup || this.e.group_id) {
      try {
        await this.e.bot.pickUser(userId).sendMsg('双管乐·API 设置主人验证码：' + code + '\n有效期5分钟，请在群内回复 #ncm设置主人验证码<验证码>')
        await this.reply('验证码已私聊发送，请查看私聊消息并在5分钟内完成验证')
      } catch (err) {
        await this.reply('私聊发送失败，验证码：' + code + '\n请在5分钟内回复 #ncm设置主人验证码' + code)
      }
    } else {
      await this.reply('双管乐·API 设置主人验证码：' + code + '\n请在5分钟内回复 #ncm设置主人验证码' + code)
    }

    return true
  }

  // 验证验证码并设置主人
  async verifyMaster() {
    const userId = this.e.user_id
    const msg = this.e.msg || ''

    // 提取验证码（移除指令前缀）
    const inputCode = msg.replace(/^#*(?:NCM|ncm)设置主人验证码/i, '').trim()

    if (!inputCode) {
      await this.reply('请输入验证码，格式：#ncm设置主人验证码<验证码>')
      return true
    }

    const result = await verifyAndSetMaster(userId, inputCode)
    await this.reply(result.message)
    return true
  }
}
