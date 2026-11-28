# 未随仓库发布的素材清单

本仓库已包含完整可运行游戏与运行时资源。下面这些是制作期原始素材，未纳入 Git；
它们大多可以从官方 OST、动画原声和 B 站成品页找回，这里只保留名称与用途，
方便日后替换或重新收集。

## 背景音乐（官方 OST）

| 文件 | 用途 |
| --- | --- |
| `罗小黑战记2_14_追踪若木.mp3` | 早期段 BGM，游戏内使用裁掉首尾静音的版本 |
| `罗小黑战记2_16_灵力追踪.mp3` | 五钟段 BGM，游戏内使用裁掉首尾静音的版本 |
| `罗小黑战记2_23_尊师重道.mp3` | 备用曲，未进入运行时 |

来源：《罗小黑战记2》官方 OST。运行时版本见 `assets/audio/bgm-early.mp3` 与
`assets/audio/bgm-five.mp3`。

## 语音与音效原始件

`background/语音播报存档/`：

- `4321走-1.mp3`、`4321走-2.mp3`、`4321走-3.mp3`
- `人物落地音效.mp3`、`人物跳跃音效.mp3`、`人物跳跃音效-2.mp3`
- `传送门打开音效.mp3`
- `前方就是感应区.mp3`、`已经进入感应区域-稍等.mp3`
- `无限大人，波又出现了.mp3`
- `波过来还有段距离，你先维持现在速度.mp3`
- `目前五个源头，均不在同一高度上.mp3`
- `跳跃三次后准备进入感应范围-4321走.mp3`
- `喵-1.mp3` 至 `喵-5.mp3`

来源：动画原声与游戏内录，按文件名重新截取即可；运行时处理版见 `assets/audio/`。

## 美术参考

`background/美术参考图/`：

- `开场溶洞.png`、`开场溶洞 (2).png`
- `传送门正视图.png`、`传送门侧视图.png`
- `红色袋子-文白岩截面.png`、`蓝色袋子-金刚岩截面.png`
- `白游.png`
- `东东（目标物在感知中的样子，蓝色团状火焰）.png`

另有 `background/撼地钟布局.png`。来源为动画截图、官方设定与制作期参考图；
两张开场溶洞图原先在 `reference/hall/` 还有一份重复副本，已删除。

## B 站发布物

- 作品页：<https://www.bilibili.com/toy/Agw7AdiJQwz74BZP/index.html>
- 绑定动态：<https://www.bilibili.com/opus/1273487683416489986>
- 线上 4:3 封面（旧版）：<https://i0.hdslb.com/bfs/static/toy/app/Agw7AdiJQwz74BZP/poster_58383.jpg>
- 首版包：`冬冬拯救行动方案五-Toy.zip`（保留作回滚包）
- 触屏更新包：`冬冬拯救行动方案五-Toy-2026-11-23.zip`
- 4:3 / 16:9 分享封面：`cover-4x3.png`、`cover-16x9.png`、`icon.png`
- 封面迭代与终版：`封面-醒目版/`（含 `versions/` 备份与 `render-cover.mjs`）
- 发布时部署副本：`deploy/`，可由本仓库历史提交重建

注意：`封面-醒目版/cover-4x3-final.png` 与 `cover-16x9-final.png` 是尚未上传
B 站的新封面，线上找不到；如果需要保留，请单独留档。发布记录与表单细节见
`publish/bilibili/发布计划.md`。

## 运行时音频原始件

`assets/audio-original/`：`jump-1.mp3`、`jump-2.mp3`、`land.mp3`、`meow-1.mp3`
至 `meow-5.mp3`、`portal-open.mp3`。这是未做淡化和混响的短音效原件。

## 不在本清单内

以下不是网络素材，但同样未同步到本仓库：

- `background/游戏背景.md`、`background/玩法设定.md`：项目设定文档
- `publish/bilibili/发布计划.md`：B 站发布记录
- `tools/` 与 `renderer-check.mjs`：开发期验证脚本

如果要把整个本地工作区删除，这几项需要单独保留或另行备份。
