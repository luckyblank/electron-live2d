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

## 项目结构

```text
electron-live2d/
├── main.js                 # 窗口、托盘、IPC、偏好设置和模型发现
├── preload.js              # 宠物窗口桥接 API
├── settings-preload.js     # 设置窗口桥接 API
├── renderer/
│   ├── index.html          # 透明宠物舞台
│   ├── app.js              # Live2D 渲染、拖动、点击与调度器
│   ├── styles.css          # 宠物窗口样式
│   ├── settings.html       # 设置窗口结构
│   ├── settings.js         # 设置窗口交互
│   └── settings.css        # 设置窗口视觉样式
├── static/
│   ├── live2dcubismcore.min.js
│   └── models/             # 五个 Live2D 模型目录
├── resources/
│   └── icon.png
└── package.json
```

## 添加模型

在 `static/models/` 下新建目录，并放入 `.model3.json` 描述文件及其依赖资源；也支持将结构完整的模型放为 `.zip`。重启应用后，合法模型会自动出现在设置窗口和托盘菜单中。

## 许可证

项目代码仅供学习参考。Live2D 模型及 Cubism Core 的版权与许可归各自权利人所有。
