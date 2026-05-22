> [!TIP]
> 如果这个项目帮助到了你，请给我们一个星星（Starred）！谢谢！

> [!WARNING]
> 本项目仅供学习交流使用，请勿用于商业及非法用途，如有侵权请联系删除

<div align=center>

# NeteaseCloudMusicApi

**网易云音乐 Node.js API 自建部署服务**

<br>

![Nodejs](https://img.shields.io/badge/-Node.js-3C873A?style=flat&logo=Node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/-JavaScript-eed718?style=flat&logo=javascript&logoColor=ffffff)
[![license](https://img.shields.io/github/license/sarsxe/NCMApi-plugin.svg?style=flat)](https://github.com/sarsxe/NCMApi-plugin/blob/main/LICENSE)
![version](https://img.shields.io/badge/version-1.0.0-blue)

</div>

---

## 为何会有这个项目📖

让我来给您描绘一下吧：

- 现在是凌晨 3 点
- 你的机器人不能播放音乐
- 你凝视虚空，虚空也凝视着你
- 果然你依赖的第三方 API 挂了，而你对此无能为力

这个仓库正是那场存在午夜危机的结果。基于 NeteaseCloudMusicApi 的自建部署方案，在本地里你能控制、维护并信任它（希望如此）。

## 免责声明 ❗

- 本项目的功能仅限于内部交流与小范围使用，请勿将 本项目 用于任何以盈利为目的的场景。
- 仅供交流学习使用。如有侵权，请联系我们，我们会立即删除相关内容。

## 特性✨

- 完全不依赖第三方 API 服务器
- 支持全部 NeteaseCloudMusicApi 接口
- 本地运行于 127.0.0.1:3030，安全且快速
- 随Yunzai托管，自动重启，开机自启
<details><summary> You can still survive after restarting,unlike your will to learn. </summary>

- 重启后依然能存活，不像你的学习意志

</details>

## 安装教程😊

1. 推荐使用 git 进行安装，以方便后续升级

```sh
cd /root/Yunzai
```

使用 GitHub:

```sh
git clone --depth=1 https://github.com/sarsxe/NCMApi-plugin.git ./plugins/NCMApi-plugin
```

2. 进入项目

```sh
cd /root/Yunzai/plugins/NCMApi-plugin
```

3. 安装依赖

```sh
pnpm install
```


## 启动方式

### 方式一：随 Yunzai 自动启动（推荐）

重启或启动 Yunzai，无需再为本插件单独配置 pm2 进程。
插件会在 Yunzai 启动时加载本地 NeteaseCloudMusicApi 服务。

### 方式二：独立启动（兼容模式）

如需单独调试，可执行：

```sh
cd /root/Yunzai/plugins/NCMApi-plugin
```

```sh
node start.js
```

服务默认运行在 http://127.0.0.1:3030

快速验证:

```sh
curl http://127.0.0.1:3030/search?keywords=hello
```

## 功能介绍

<details>
<summary>支持的 API 接口（点击展开）</summary>

| 接口 | 说明 |
| ---- | ---- |
| /search?keywords=xxx | 搜索歌曲 |
| /cloudsearch?keywords=xxx | 高级搜索 |
| /song/url/v1?id=xxx | 获取歌曲播放链接 |
| /song/detail?ids=xxx | 获取歌曲详情 |
| /lyric?id=xxx | 获取歌词 |
| /playlist/detail?id=xxx | 获取歌单详情 |
| /artist/songs?id=xxx | 获取歌手歌曲 |
| /album?id=xxx | 获取专辑内容 |
| /comment/music?id=xxx | 获取歌曲评论 |
| /banner | 首页轮播图 |
| /personalized | 推荐歌单 |
| /toplist | 排行榜 |
| /login/status | 检查登录状态 |
| /user/cloud | 云盘歌曲列表 |

完整接口文档请参考：[NeteaseCloudMusicApi 文档](https://binaryify.github.io/NeteaseCloudMusicApi)

</details>

### 音质等级

| 等级 | 说明 |
| ---- | ---- |
| standard | 标准音质 |
| higher | 较高音质 |
| exhigh | 极高音质 |
| lossless | 无损音质（FLAC） |
| hires | Hi-Res 高解析度 |

## 更新与版本管理

插件内支持以下命令：

| 命令 | 说明 |
| ---- | ---- |
| #NCM版本 | 查看插件版本信息 |
| #NCM更新 | 更新插件并安装依赖 |
| #NCM状态 | NCMApi 运行状态查看 |
| #NCM端口变更 |本地api转发端口更改 |
| #NCM强制更新 | 放弃本地修改后强制更新 |
| #NCM更新/安装api*** | NeteaseCloudMusicApi 依赖安装与更新 |

说明：

- 更新命令会执行 git pull --no-rebase 和 npm install
- 更新完成后，请重启 Yunzai，使插件代码与内置 NCM API 服务一起生效
- 不再依赖单独的 pm2 restart NeteaseCloudMusicApi
## 对接配置示例

如需在其他插件或配置中显式指定本地网易云 API 地址，可使用：

useLocalNeteaseAPI:

```sh
true
```

neteaseCloudAPIServer:

```sh
http://127.0.0.1:3030
```


## 项目结构

    NCMApi-plugin/
    |-- apps/
    |-- service.js           # 本地 NCM API 启动封装与单例保护
    |-- index.js             # Yunzai 插件入口，随 Yunzai 自动启动服务
    |-- start.js             # 兼容独立启动入口
    |-- package.json         # 项目配置及依赖
    |-- package-lock.json    # 依赖锁定文件
    |-- README.md            # 项目文档

## Tech Stack 技术线

| 技术 | 用途 |
| ---- | ---- |
| Node.js | 运行环境 |
| Express | Web 框架 |
| NeteaseCloudMusicApi v4.32.0 | 核心 API 模块 |
| Your sanity | Troubleshooting at 3 AM |

## Acknowledgements 致谢

- [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) ——让这一切成为可能的起源项目
- [Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot) -- 让服务永远活下去

## License 许可证

<details><summary>MIT -- Do whatever you want, just do not blame me.</summary>

麻省理工 -- 爱干什么就干什么吧,别来怪我。

</details>

---

<div align=center>

<details><summary>If this repo saved your bot, consider giving it a star.</summary>

如果这个仓库拯救了你的机器人,请考虑给它点个星。

</details>

<details><summary>Made with love and frustration from expired third-party APIs.</summary>

怀着爱与无奈,用过期的第三方API制作而成。

</details>

</div>
