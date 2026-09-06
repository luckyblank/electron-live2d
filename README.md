# Live2D 桌面伙伴

基于 Electron 与 Live2D Cubism SDK 的透明桌面伙伴。宠物窗口保持无边框、不抢焦点，可拖动、点击互动、跟随近距离光标，并通过独立设置窗口切换角色和调整性能策略。

<p align="center">
  <img src="resources/icon.png" width="128" alt="Live2D 桌面伙伴图标">
</p>

## 功能

- 透明无边框宠物窗口，不占任务栏、不打断当前工作
- 拖动角色移动位置并自动保存，允许贴近屏幕边缘
- 点击角色触发动作与轻量反馈
- 近距离光标跟随，远离角色后停止高频光标采样
- 30 / 60 / 10 FPS 自适应调度，支持省资源与高质量模式
- 独立设置窗口，用于切换模型、调整尺寸、锁定交互和系统选项
- 系统托盘支持显示、隐藏、切换模型、锁定和退出
- 模型切换时主动释放 WebGL、纹理与音频资源
- 角色卡片视图与自动封面缩略图
- 用户模型目录（应用数据目录 `models`，卸载/更新不删除）
- 可选 AI 插件：DeepSeek、智谱 GLM-4.7-Flash 文本对话，以及智谱 GLM-TTS 语音回复
- 文本模型与语音模型独立选择；语音播放时驱动 Live2D 口型
- TTS 音频自动归档到应用数据目录 `tts`，升级应用不会覆盖
- 版本检查更新（打开设置自动检查，有新版本提示下载）

## 内置模型

当前只保留以下 5 个模型：

- `azur-03`
- `hiyori`
- `mori-miko`
- `mori-suit`
- `senko`

## 快速开始

### 前置条件

1. Node.js 18 或更高版本。
2. 将 Live2D Cubism SDK for Web 中的 `Core/live2dcubismcore.min.js` 放到 `static/live2dcubismcore.min.js`。

### 安装与运行

```bash
npm install
npm start
```

开发模式会额外打开开发者工具：

```bash
npm run dev
```

### 检查与打包

```bash
npm run check
npm run lint
npm run package:win
```

Windows 安装包输出到 `dist/`。

发版与更新发布流程见 [RELEASE.md](RELEASE.md)，更新日志见 [release/release-notes.md](release/release-notes.md)。

## 使用方式

| 操作 | 结果 |
|---|---|
| 左键轻点角色 | 播放点击动作与轻量特效 |
| 按住角色拖动 | 移动宠物窗口并保存位置 |
| 右键角色 | 打开快捷菜单和设置入口 |
| 托盘图标 | 显示或隐藏角色 |
| 托盘菜单 | 切换模型、锁定交互、打开设置或退出 |

锁定后宠物会完全穿透鼠标，可从系统托盘菜单解除锁定。

## AI 对话与语音

在设置的「AI 对话」中安装并配置所需模型。文本模型组支持 DeepSeek 与智谱 `glm-4.7-flash`，语音模型组支持智谱 `glm-tts`；每组同时只启用一个插件。

智谱插件优先读取环境变量 `ZHIPU_API_KEY`，DeepSeek 插件优先读取 `DEEPSEEK_API_KEY`。没有环境变量时，也可以在设置页填写 Key；Key 由 Electron 系统安全存储加密保存，界面只显示脱敏预览。

智谱 TTS 生成的 WAV 文件保存在 `%APPDATA%\Live2DCompanion\tts\`，并按月份归档。该目录与用户 `models` 目录同级，不随应用更新被覆盖。

## 项目结构

```text
electron-live2d/
├── main.js                 # 窗口、托盘、IPC、偏好设置和模型发现
├── preload.js              # 宠物窗口桥接 API
├── settings-preload.js     # 设置窗口桥接 API
├── ai/
│   └── plugin-manager.js   # AI 插件发现、凭据、启用状态、记忆和语音归档
├── plugins/                # 内置 AI 服务适配器
├── renderer/
│   ├── index.html          # 透明宠物舞台
│   ├── app.js              # Live2D 渲染、拖动、点击与调度器
│   ├── styles.css          # 宠物窗口样式
│   ├── settings.html       # 设置窗口结构
│   ├── settings.js         # 设置窗口交互
│   └── settings.css        # 设置窗口视觉样式
├── models/                 # 内置 Live2D 模型（随安装包发货）
├── static/
│   └── live2dcubismcore.min.js
├── resources/
│   └── icon.png
└── package.json
```

## 添加模型

推荐在设置的「角色」页面点击「导入 ZIP」，应用会在复制前检查模型格式和压缩包结构；不支持的 Cubism 2 模型或无效模型会直接提示，不会写入用户模型目录。也可以在 `%APPDATA%\Live2DCompanion\models\` 下手动新建目录，放入 `.model3.json` 及其依赖资源或结构完整的 `.zip`，然后通过托盘刷新模型列表。只有可加载的模型会出现在右键和托盘的切换菜单中。

内置模型位于项目 `models/` 目录，随安装包发货，供首次安装的用户直接使用。

## 许可证

项目代码仅供学习参考。Live2D 模型及 Cubism Core 的版权与许可归各自权利人所有。
