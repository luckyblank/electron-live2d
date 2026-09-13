# Live2D 桌面伙伴独立回归测试报告

执行日期：2026-09-11  
执行角色：`app验收`  
被测版本：当前工作区未提交版本  
测试结论：**自动化通过，2 项待人工实机确认**

## 1. 测试原则

本报告记录可重复执行的测试本身；产品判定与整改优先级见 `docs/ui-acceptance-report.md`。

- 开发任务的自测只作为输入，验收任务独立执行全部关键路径；
- 视觉测试同时使用截图、DOM 几何和像素数据，不以“看起来差不多”代替阈值；
- 动态背景必须走实际 Live2D/WebGL/IPC 链路，不使用静态封面图冒充；
- 当前自动化接口不能控制原生 Electron 窗口，无法完成的项目明确标记为“待实机”，不推断为通过；
- 主题、页签、聊天和背景检测均覆盖用户实际使用的默认状态与状态切换。

## 2. 环境

| 项目 | 值 |
|---|---|
| 操作系统 | Windows |
| Electron | 项目本地依赖 `37.10.3` |
| 设置窗口 | 470×760，透明、无框、固定尺寸 |
| 桌宠窗口 | 400×600，透明、无框 |
| 测试模型 | `hiyori/Hiyori.zip`；目录兼容性使用 `openSource.model3.json` |
| 设置主题 | `glass`、`healing` |
| 设置页面 | `characters`、`behavior`、`ai`、`system` |

## 3. 自动化入口

```powershell
npm run check
npm run lint
git diff --check
npm run qa:settings
npm run qa:chat
npm run qa:background
npm run qa:directory
npm run qa:conversation
```

脚本用途：

- `qa/settings-ui.cjs`：设置页双主题四页截图、几何、文字裁切、透明角、控件标签和基础交互；
- `qa/chat-acceptance.cjs`：真实 hiyori 模型下的聊天折叠/展开、边框与背景检测框；
- `qa/settings-background.cjs`：真实双 BrowserWindow 动态背景链路、拖动、显隐和切模失败恢复。
- `qa/directory-model.cjs`：Windows 下目录型 `.model3.json` 模型与相对资源真实加载，运行时从现有 ZIP 创建临时夹具。
- `qa/conversation-persistence.cjs`：角色隔离、manager 重建恢复、插件切换/停用、按角色清空和 TTS 数据排除。

这些脚本是工作区验收工具。`package.json > build.files` 已加入 `!qa/**`；五个脚本可以留在仓库复验，同时不会进入安装包文件集。

## 4. 测试用例结果

### 4.1 静态与窗口

| ID | 测试 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| STATIC-01 | JavaScript 语法检查 | 全部入口无语法错误 | `npm run check` 通过 | 通过 |
| STATIC-02 | ESLint | 无 lint 错误 | `npm run lint` 通过 | 通过 |
| STATIC-03 | Patch whitespace | 无空白错误 | `git diff --check` 通过 | 通过 |
| WIN-01 | 设置窗口尺寸 | 470×760，不可拉伸/最大化 | 符合；`hasShadow=false` | 通过 |
| WIN-02 | 透明圆角 | 四角透明，无方形底色 | 8 张截图角点 alpha=0 | 通过 |
| WIN-03 | 设置外框留白 | 四边留白一致，不贴窗 | shell `(8,8,454,744)` | 通过 |

### 4.2 两主题四页面

| ID | 测试 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| PAGE-01 | 主题切换 | glass/healing 即时生效 | 两主题均正确渲染 | 通过 |
| PAGE-02 | 四页切换 | 只有目标页 active，标签同步 | 四页均正确 | 通过 |
| PAGE-03 | 背景角色几何 | 四页位置和大小一致 | canvas 均 `(245,92,190,285)` | 通过 |
| PAGE-04 | 角色横向列表 | 可横向滚动且选中态唯一 | `0 -> 18`，max `719`；选中 1 项 | 通过 |
| PAGE-05 | 行为开关 | 可切换并反映状态 | `cursorFollow` 从 true 变 false | 通过 |
| PAGE-06 | AI 插件详情 | 正文无裁切/重叠，可读 | 两主题均为 `25/25、25/25、37/37`，无溢出或重叠 | 通过 |
| PAGE-07 | 系统页结构 | 主题、更新、恢复、退出等完整 | 结构完整，可滚动访问 | 通过 |
| A11Y-01 | 可见按钮名称 | 每个按钮有文字/aria-label/title | 未发现空名称按钮 | 通过 |
| A11Y-02 | 活动页表单标签 | input/textarea/select 有 label | 未发现未标注输入 | 通过 |

截图证据：

`C:\Users\lucky\AppData\Local\Temp\live2d-companion-qa\`

### 4.3 聊天与边框

| ID | 测试 | 期望 | Glass | Healing | 结果 |
|---|---|---|---|---|---|
| CHAT-01 | 初始状态 | 每次打开默认折叠，64px | 64px | 64px | 通过 |
| CHAT-02 | 悬停 | pointerenter 不展开 | 保持折叠 | 保持折叠 | 通过 |
| CHAT-03 | 点击切换 | 第一次展开、第二次折叠 | 符合 | 符合 | 通过 |
| CHAT-04 | 移出/失焦 | 不自动折叠 | 保持展开 | 保持展开 | 通过 |
| CHAT-05 | 展开位置 | bottom ≤ 590 | bottom=590 | bottom=590 | 通过 |
| CHAT-06 | 聊天边框 | 四边同宽同色 | 四边 1px | 四边 1px | 通过 |
| FRAME-01 | 背景检测框 | 单层统一 1px 轮廓 | inset 8 / radius 26 | inset 8 / radius 26 | 通过 |
| FRAME-02 | 聊天与整窗框解耦 | 开聊天不新增整窗框 | 无 `has-ai-chat`/`body::before` | 同左 | 通过 |
| FRAME-03 | 关闭背景检测 | 不显示整窗框 | opacity=0 | opacity=0 | 通过 |

证据：

`C:\Users\lucky\AppData\Local\Temp\live2d-chat-acceptance\results.json`

### 4.4 真实动态宠物背景

| ID | 测试 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| BG-01 | 设置首次打开 | 收到并显示非透明角色帧 | opaquePixels=16992 | 通过 |
| BG-02 | 四页往返 | 每页持续显示且几何不变 | 各页约 16900，几何一致 | 通过 |
| BG-03 | 拖动期间 | 背景不消失；可暂停采集并保留最后有效帧 | opaquePixels=16991 | 通过 |
| BG-04 | 松手恢复 | 下一帧自动恢复 | opaquePixels=15698，无需显隐/切模 | 通过 |
| BG-05 | 桌宠隐藏/恢复 | 设置打开时背景仍可见 | 15525 / 15617 | 通过 |
| BG-06 | 切模失败回退 | 旧模型重新加载并恢复背景 | 回退 hiyori 后 16950 | 通过 |

证据：

`C:\Users\lucky\AppData\Local\Temp\live2d-settings-background-qa\results.json`

### 4.5 模型兼容性

| ID | 测试 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| MODEL-01 | ZIP 模型 | 发现并加载完成 | hiyori ready，像素边界可检测 | 通过 |
| MODEL-02 | 目录 `.model3.json` | ready 项实际可加载 | openSource `phase=ready`，可见边界 264×496 | 通过 |
| MODEL-03 | 加载失败恢复 | 回到上个可用模型 | 测试中的失败路径可回退 hiyori | 通过 |

### 4.6 性能观察

在真实开发会话中同时打开桌宠和设置页，等待空闲后用 5 秒 CPU 时间差采样 6 个 Electron 进程：

| 指标 | 观测值 |
|---|---:|
| 合计私有内存 | 577.3 MB |
| 合计工作集 | 866.9 MB |
| 5 秒合计 CPU | 约 44.7% 的一个逻辑核心 |
| 主要 CPU 来源 | GPU 进程约 25.6%，桌宠 renderer 约 12.2%，main 约 6.9% |

该数据包含开发态 Electron、GPU 共享内存和设置页 15 FPS 动态背景采集，不能直接等同于打包版本资源占用，因此当前标记为 **P2 性能预算风险**，不是本轮 P1 阻断。发布前应分别测量：仅桌宠空闲、桌宠+设置、聊天展开/TTS、`eco/auto/high` 三档，以及设置关闭 10 分钟后的稳态。

### 4.7 实机项目

| ID | 测试 | 期望 | 当前状态 |
|---|---|---|---|
| MANUAL-01 | 物理鼠标拖动 | BrowserWindow 坐标改变，松手不漂移，重启位置保留 | 待实机 |
| MANUAL-02 | 真实桌面可读性 | glass 在白/黑/复杂壁纸和图标上文字清晰 | 待实机 |

## 5. 失败复现摘要

### PAGE-06 原始失败基线

1. 启动 470×760 设置窗口；
2. 分别切换 glass/healing；
3. 打开 AI 助手页；
4. 检查三个已安装插件卡片的 `.plugin-detail`；
5. 两主题均出现 `scrollHeight > clientHeight`，肉眼可见正文极小或被截断。

整改后复验：三个详情在 glass 和 healing 下均为 `25/25、25/25、37/37`（scrollHeight/clientHeight），scrollWidth 也等于 clientWidth；截图中正文、徽标与按钮不重叠。当前唯一被裁切检测命中的内容是有意使用省略号的插件目录长路径。

### BG-03 / BG-04 原始失败基线

1. 启动真实 hiyori 桌宠窗口；
2. 打开真实设置窗口并启用动态宠物背景；
3. 确认设置 canvas 非透明像素约 16900；
4. 在角色实体内按下并移动，renderer 进入 `is-dragging`；
5. 主进程继续收到帧，但设置 canvas 非透明像素变为 0；
6. 松手等待 500ms，仍为 0；
7. 只有显隐或模型重载等强制唤醒路径能恢复。

整改后再次执行同一脚本：首次打开、四页切换、拖动中、松手后、显隐和失败切模恢复共 10 项断言全部通过；拖动中非透明像素为 16991，松手后为 15698，`nullFrameCount=0`。因此 BG-03 / BG-04 已关闭，原始失败数据保留用于说明回归原因。

### MODEL-02 原始失败基线

1. 扫描 `models/openSource`；
2. `inspectModelDirectory()` 返回 `ready`；
3. renderer 把 `.model3.json` 的 `file:` URL 交给 `live2d-renderer`；
4. 库用 Node path 方法拼接 URL，moc 依赖读取失败；
5. 同样流程改为 hiyori ZIP 后加载成功。

整改后复验：同一 `openSource.model3.json` 返回 `phase=ready`，`lastHitBounds={x:68,y:40,width:264,height:496}`；角色截图可见且纹理完整，控制台没有 `./file:/...` 加载错误。

## 6. 修复后的回归门槛

以下自动化门槛已经全部满足：

- 两主题所有 `.plugin-detail` 均满足 `scrollHeight <= clientHeight + 2`，正文不重叠；
- BG-01 至 BG-06 每个阶段非透明像素均 `>100`；
- 拖动期间背景保持可见；允许暂停采集并保留最后有效帧，任何空帧不能覆盖它；
- 松手后无需显隐或切模即可恢复；
- 目录模型可真实加载，或在发现阶段被正确标记不可用并向用户解释；
- 聊天与边框全部既有断言继续通过，防止修复引入回归；
- 静态检查全部通过；

仍待完成的正式签字条件：两项实机项目有明确执行者和结果。

## 7. 当前测试判定

**自动化通过，等待两项人工实机确认。**

静态检查、双主题四页面、聊天/边框、真实动态背景和目录模型五组回归均通过。报告保留了整改前的失败基线；当前没有仍然失败的自动化 P0/P1。

物理鼠标拖动原生窗口、glass 主题叠加真实复杂桌面的可读性不在当前自动化表面能力内，仍需人工执行。两项完成后，测试判定可升级为正式通过。

## 8. 后续累计需求回归门槛

本节覆盖第 7 节历史判定之后加入的功能。最终验收必须重新运行所有脚本，并把本次结果填写到 `docs/final-acceptance-checklist.md` 第 7 节。

| ID | 回归项 | 必须满足的门槛 | 负责脚本 / 方法 |
|---|---|---|---|
| REG-ORDER-01 | 角色排序 | 拖动后的 DOM 顺序、IPC 保存顺序和重启顺序一致 | `qa/settings-ui.cjs` + 实际重启 |
| REG-SCALE-01 | 尺寸与分页 | scale 快照不替换首张卡片，不改变当前圆点或角色顺序 | `qa/settings-ui.cjs` |
| REG-SCALE-02 | 尺寸提示位置 | 无聊天时底边距 18px；有聊天时完整位于聊天框上方 16px 内 | `qa/chat-acceptance.cjs` |
| REG-SETTINGS-01 | 设置窗口复用 | 普通右键恢复设置时不重载、不改变页签 | 真实窗口人工检查 |
| REG-CURSOR-01 | 页签后鼠标跟随 | 页签切换即刷新光标，不需点击角色 | 真实窗口人工检查 |
| REG-PRESET-01 | 三个陪伴预设 | 组合字段全部正确；外部 preference 快照会更新唯一选中态 | `qa/settings-ui.cjs` |
| REG-AI-01 | 模型启停 | 停用后按钮变“启用”、能力变未启用；重新启用恢复；没有卸载入口 | `qa/settings-ui.cjs` + `rg` |
| REG-AI-02 | 文本/语音提示 | 未配置与已配置未启用使用不同提示，且路由到 AI 页 | 状态矩阵人工检查 |
| REG-BUBBLE-01 | 气泡单实例 | 竞争消息不覆盖、不排队；语音气泡持续至播放结束 | `qa/chat-acceptance.cjs` |
| REG-BUBBLE-02 | 模型加载门槛 | ready 且角色已渲染前气泡不可见 | 慢加载/失败模型集成检查 |
| REG-SCROLL-01 | 聊天底部防抖 | 连续 60 帧 scrollTop、最后消息和面板位置 spread 均 ≤ 1px | `qa/chat-acceptance.cjs` |
| REG-MEMORY-01 | 角色持久会话 | 角色隔离、重启恢复、切换/停用不清空、clear 只影响目标角色 | `npm run qa:conversation` |
| REG-MEMORY-02 | 持久化数据边界 | 只含 role/content，不含音频、Base64 和归档路径 | 同上 |

本节所有结果在本文更新时均标记为“待主任务最终运行回填”。旧版 JSON 或截图不能代替最终工作区的新结果。
