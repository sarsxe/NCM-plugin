import { loadConfig, saveConfig } from '../lib/config.js'
import { getBackdropFiles } from '../lib/backdrop.js'

function getBackdropOptions() {
  return [
    { label: '随机', value: 'random' },
    ...getBackdropFiles().map(i => ({ label: i, value: i }))
  ]
}

export function supportGuoba() {
  return {
    pluginInfo: {
      name: 'NCM-plugin',
      title: '双管乐·API',
      author: '',
      authorLink: '',
      link: '',
      isV3: true,
      isV2: false,
      description: '网易云/酷狗 API 双管乐插件，支持扫码登录、Cookie管理、会员信息查询',
      showInMenu: 'auto',
      icon: 'mdi:music-circle',
      iconColor: '#7c4dff'
    },
    configInfo: {
      schemas: [
        { label: 'Cookie 管理', component: 'SOFT_GROUP_BEGIN' },
        { component: 'Divider', label: '网易云音乐', componentProps: { orientation: 'left', plain: true } },
        {
          field: 'ncm.cookie',
          label: '网易云 Cookie',
          bottomHelpMessage: '使用 #ncm网易登录 扫码自动获取，也可手动填入。登录后自动保存完整cookie',
          component: 'InputTextArea',
          componentProps: { placeholder: '未登录，请使用 #ncm网易登录 或手动填入cookie', rows: 4 }
        },
        { component: 'Divider', label: '酷狗音乐', componentProps: { orientation: 'left', plain: true } },
        {
          field: 'kugou.cookie',
          label: '酷狗 Cookie',
          bottomHelpMessage: '使用 #ncm酷狗登录 扫码自动获取，也可手动填入完整cookie',
          component: 'InputTextArea',
          componentProps: { placeholder: '未登录，请使用 #ncm酷狗登录 或手动填入cookie', rows: 4 }
        },
        { field: 'kugou.token', label: '酷狗 Token', bottomHelpMessage: '扫码登录后自动获取，一般不需要手动填写', component: 'Input', componentProps: { placeholder: '登录后自动填入' } },
        { field: 'kugou.userid', label: '酷狗 UserID', bottomHelpMessage: '扫码登录后自动获取', component: 'Input', componentProps: { placeholder: '登录后自动填入' } },
        { field: 'kugou.dfid', label: '酷狗 DFID', bottomHelpMessage: '扫码登录后自动获取的设备标识', component: 'Input', componentProps: { placeholder: '登录后自动填入' } },
        { label: '服务配置', component: 'SOFT_GROUP_BEGIN' },
        { component: 'Divider', label: '网易云 API 服务', componentProps: { orientation: 'left', plain: true } },
        { field: 'ncm.enabled', label: '启用网易云服务', bottomHelpMessage: '是否启用网易云音乐 API 服务', component: 'Switch' },
        { field: 'ncm.host', label: '网易云服务地址', bottomHelpMessage: 'API 监听地址，默认 127.0.0.1', component: 'Input', componentProps: { placeholder: '127.0.0.1' } },
        { field: 'ncm.port', label: '网易云服务端口', bottomHelpMessage: 'API 监听端口，默认 3030', component: 'InputNumber', componentProps: { min: 1024, max: 65535, placeholder: '3030' } },
        { component: 'Divider', label: '酷狗 API 服务', componentProps: { orientation: 'left', plain: true } },
        { field: 'kugou.enabled', label: '启用酷狗服务', bottomHelpMessage: '是否启用酷狗音乐 API 服务', component: 'Switch' },
        { field: 'kugou.host', label: '酷狗服务地址', bottomHelpMessage: 'API 监听地址，默认 127.0.0.1', component: 'Input', componentProps: { placeholder: '127.0.0.1' } },
        { field: 'kugou.port', label: '酷狗服务端口', bottomHelpMessage: 'API 监听端口，默认 3040', component: 'InputNumber', componentProps: { min: 1024, max: 65535, placeholder: '3040' } },
        { label: '背景图样式配置', component: 'SOFT_GROUP_BEGIN' },
        {
          field: 'style.backdrop',
          label: '远程背景图API',
          bottomHelpMessage: '用于“#ncm帮助”等图片的背景。填写随机图API或图片直链(https://uapis.cn/api/v1/random/image?category=acg)，获取后统一转为PNG并自动适配横竖布局；留空则使用本地背景图，本地无图时渐变色兜底',
          component: 'Input',
          componentProps: { placeholder: 'https://uapis.cn/api/v1/random/image' }
        },
        {
          field: 'style.backdropTimeout',
          label: '背景图请求超时',
          bottomHelpMessage: '单位：毫秒，默认 5000',
          component: 'InputNumber',
          componentProps: { min: 1000, max: 30000, placeholder: '5000' }
        },
        {
          field: 'style.backdropDefault',
          label: '本地默认背景图',
          bottomHelpMessage: '远程API留空或请求失败时使用，选择『随机』每次随机一张。图片请放入 NCM-plugin/data/img/bg 目录，横竖图均可，自动适配布局',
          component: 'Select',
          componentProps: { options: getBackdropOptions() }
        }
      ],

      getConfigData() {
        const config = loadConfig()
        return {
          'ncm.cookie': config.ncm?.cookie || '',
          'ncm.enabled': config.ncm?.enabled !== false,
          'ncm.host': config.ncm?.host || '127.0.0.1',
          'ncm.port': config.ncm?.port || 3030,
          'kugou.cookie': config.kugou?.cookie || '',
          'kugou.token': config.kugou?.token || '',
          'kugou.userid': config.kugou?.userid || '',
          'kugou.dfid': config.kugou?.dfid || '',
          'kugou.enabled': config.kugou?.enabled !== false,
          'kugou.host': config.kugou?.host || '127.0.0.1',
          'kugou.port': config.kugou?.port || 3040,
          'style.backdrop': config.style?.backdrop || '',
          'style.backdropDefault': config.style?.backdropDefault || 'random',
          'style.backdropTimeout': config.style?.backdropTimeout || 5000
        }
      },

      setConfigData(data, { Result }) {
        try {
          const config = loadConfig()
          if (!config.ncm) config.ncm = {}
          if (!config.kugou) config.kugou = {}
          if (!config.style) config.style = {}

          if (data['ncm.cookie'] !== undefined) config.ncm.cookie = data['ncm.cookie']
          if (data['ncm.enabled'] !== undefined) config.ncm.enabled = data['ncm.enabled']
          if (data['ncm.host'] !== undefined) config.ncm.host = data['ncm.host']
          if (data['ncm.port'] !== undefined) config.ncm.port = data['ncm.port']

          if (data['kugou.cookie'] !== undefined) config.kugou.cookie = data['kugou.cookie']
          if (data['kugou.token'] !== undefined) config.kugou.token = data['kugou.token']
          if (data['kugou.userid'] !== undefined) config.kugou.userid = data['kugou.userid']
          if (data['kugou.dfid'] !== undefined) config.kugou.dfid = data['kugou.dfid']
          if (data['kugou.enabled'] !== undefined) config.kugou.enabled = data['kugou.enabled']
          if (data['kugou.host'] !== undefined) config.kugou.host = data['kugou.host']
          if (data['kugou.port'] !== undefined) config.kugou.port = data['kugou.port']

          if (data['style.backdrop'] !== undefined) config.style.backdrop = data['style.backdrop']
          if (data['style.backdropDefault'] !== undefined) config.style.backdropDefault = data['style.backdropDefault']
          if (data['style.backdropTimeout'] !== undefined) config.style.backdropTimeout = data['style.backdropTimeout']

          saveConfig(config)
          return Result.ok({}, '保存成功')
        } catch (e) {
          return Result.error('保存失败：' + e.message)
        }
      }
    }
  }
}
