# Live2D 桌面 Q 版宠物 🐾

基于 Electron + Live2D Cubism SDK 的桌面 Q 版（chibi）宠物应用。一个无边框、透明、置顶的桌面窗口，渲染一只可交互的 Live2D 动画角色，支持点击互动、拖拽移动、随机空闲动画、系统托盘控制和多模型切换。

<p align="center">
  <img src="resources/icon.png" width="128" alt="icon">
</p>

## ✨ 功能

- **桌面宠物** — 无边框透明窗口，角色悬浮在桌面上
- **点击互动** — 单击、双击、三连击触发不同反应（表情气泡、粒子特效、震动）
- **拖拽移动** — 按住角色拖动即可移动位置，自动保存位置
- **光标跟随** — 角色眼球/头部跟随鼠标移动
- **随机空闲动画** — 闲置时自动播放动画、气泡对话、打盹 Zzz
- **右键菜单** — 右键点击角色触发特殊反应
- **键盘快捷键** — H/S/B/F 键触发不同特效
- **系统托盘** — 显示/隐藏、切换模型、退出
- **多模型支持** — 12 个内置模型，可在托盘菜单中切换

## 📦 已内置模型（12 个）

| 模型 | 来源 | 动画数 | 大小 |
|------|------|--------|------|
| **mori-miko** | Fox Hime Zero — 狐娘巫女森美子 | 85 | 5.7 MB |
| **ruri-miko** | Fox Hime Zero — 狐娘巫女瑠璃美子 | 85 | 6.6 MB |
| **mori-suit** | Fox Hime Zero — 森美子便服版 | 85 | 4.9 MB |
| **konosuba-aqua** | 为美好的世界献上祝福 — 阿库娅 | 32 | 2.5 MB |
| **konosuba-001** | 为美好的世界献上祝福 | 38 | 1.9 MB |
| **konosuba-002** | 为美好的世界献上祝福 | 26 | 2.3 MB |
| **azur-01** | 碧蓝航线 (aersasi) | 28 | 13.9 MB |
| **azur-02** | 碧蓝航线 (aierdeliqi) | 15 | 5.6 MB |
| **azur-03** | 碧蓝航线 (aidang) | 14 | 3.9 MB |
| **shoujo-01** | 少女次元 | 15 | 1.5 MB |
| **senko** | Live2D 官方示例 (带 hit 检测) | 4 | 6.9 MB |
| **hiyori** | live2d-renderer 示例 | — | 4.4 MB |

## 🚀 快速开始

### 前置条件

1. **Live2D Cubism Core** — 将 `live2dcubismcore.min.js` 放入 `static/` 目录
   - 从 [Live2D 官网](https://www.live2d.com/download/cubism-sdk/) 下载 Cubism SDK for Web（需免费注册）
   - 解压后将 `Core/live2dcubismcore.min.js` 复制到 `static/live2dcubismcore.min.js`

2. **Node.js** >= 18

### 安装与运行

```bash
# 安装依赖
npm install

# 启动开发模式（带热重载）
npm run dev

# 或直接启动
npm start

# 检查主进程、预加载和渲染脚本语法
npm run check

# 代码规范检查（需先 npm install）
npm run lint
```

### 打包为 Windows 安装包

```bash
npm run package:win
```

输出在 `dist/` 目录。

## 🎮 交互说明

| 操作 | 效果 |
|------|------|
| **单击角色** | 触发点击动画 + 粒子特效，点击头部有爱心特效 |
| **双击** | 触发强烈动画 + 表情气泡 + 大量粒子 |
| **三连击** | 触发终极动画 + 星星爆发 + 窗口震动 |
| **右键点击** | 吐槽气泡 + 震动 |
| **拖拽** | 移动窗口位置（自动保存） |
| **光标悬停** | 角色眼球跟随 |
| **H 键** | 爱心特效 |
| **S 键** | 惊吓特效 |
| **B 键** | 随机对话气泡 |
| **F 键** | 全套开心特效 |

### 空闲行为

- **30 秒无操作** → 随机空闲气泡
- **60 秒无操作** → 打盹提示
- **120 秒无操作** → 深度睡眠 Zzz

## 📁 项目结构

```
electron-live2d/
├── main.js              # Electron 主进程（窗口/托盘/IPC/模型发现）
├── preload.js           # 预加载脚本（contextBridge API）
├── renderer/
│   └── index.html       # 渲染进程（Live2D 渲染 + 交互逻辑 + 特效）
├── static/
│   ├── live2dcubismcore.min.js  # Cubism Core（需手动下载）
│   └── models/                  # Live2D 模型包（.zip）
│       ├── mori-miko/mori-miko.zip
│       ├── senko/senko.zip
│       ├── ...（共 12 个模型）
│       └── _repo/               # 模型源仓库（Eikanya/Live2d-model）
├── resources/
│   └── icon.png         # 托盘图标
├── download-models.cjs  # 批量模型下载脚本（git 方式）
└── package.json         # 打包配置（含 electron-builder 配置）
```

## 🔧 添加新模型

模型支持两种格式：

**格式 1：目录形式（Cubism 3+）**
```
static/models/my-model/
├── my-model.model3.json
├── my-model.moc3
├── my-model.physics3.json
├── textures/
│   └── texture_00.png
└── motions/
    ├── idle.motion3.json
    └── ...
```

**格式 2：Zip 包**
```
static/models/my-model/
└── my-model.zip        # 内部结构与格式1相同
```

放入模型后重启应用，新模型会自动出现在托盘切换菜单中。窗口位置、当前模型和角色缩放会自动保存；切换模型时会先加载新模型，加载失败会保留当前角色，避免出现空白窗口。

### 获取更多模型

- [Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model) — 1000+ 社区模型
- [Live2D 官网 SDK](https://www.live2d.com/download/cubism-sdk/) — 官方示例（Haru, Mao, Nito 等）
- 运行 `node download-models.cjs` 从内置仓库下载更多模型

## 🛠 技术栈

- **Electron** — 桌面框架
- **live2d-renderer** — Cubism SDK 渲染封装
- **electron-store** — 窗口位置持久化
- **Live2D Cubism 3 SDK** — 模型驱动

## 📄 许可证

本项目代码仅供学习参考。Live2D 模型版权归原作者所有，来自 [Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model) 社区仓库。Cubism Core 需从 Live2D 官网获取，遵循其许可协议。
