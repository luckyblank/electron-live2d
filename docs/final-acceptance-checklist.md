# Live2D 桌面伙伴最终任务清单与验收手册

更新日期：2026-09-11  
适用版本：当前工作区未提交版本  
文档用途：汇总本轮 `app 页面设计` 接管后的全部用户需求、实现位置、可重复验收步骤和持久化位置。  
当前阶段：**最终自动化回归全部通过；原生物理拖动、真实桌面合成和真实服务凭据仍待人工实机验收。**

## 1. 状态口径

本文使用三种状态，避免把“看到了实现代码”误写成“运行时已经通过”：

- **实现已定位**：当前工作区存在对应实现路径，仍需运行回归确认行为与视觉结果。
- **待主任务动态回填**：已有自动化脚本或明确人工步骤，必须由主任务在最终代码稳定后执行并回填第 7 节。
- **待实机**：自动化 BrowserWindow 无法替代物理鼠标、真实桌面合成或真实服务凭据，必须人工签字。

最终只有同时满足以下条件才能把总状态改为“完成”：

1. 第 2 节所有自动化项均为通过；
2. 第 7 节中的静态检查和五组回归均有本次运行结果；
3. 第 8 节的实机项已有执行人、日期和结论；
4. 没有残留 P0/P1，且验收截图对应最终代码而不是中间版本。

## 2. 累计任务验收矩阵

### 2.1 桌宠边框、聊天布局与尺寸反馈

| ID | 用户需求 / 期望结果 | 主要实现位置 | 自动化或人工验收 | 当前文档状态 |
|---|---|---|---|---|
| FRAME-01 | 开启聊天不创建整窗边框；整窗边框只由背景检测控制 | `renderer/app.js` 的 `applySnapshot()`；`renderer/styles.css` 的 `#pet-stage::after` | `qa/chat-acceptance.cjs`：`noChatOwnedWindowFrame`、`chatDoesNotChangeDetectionFrame` | 实现已定位，待主任务动态回填 |
| FRAME-02 | 背景检测框为单层、四边一致、圆角自然，关闭后完全隐藏 | `renderer/styles.css` 的背景检测框规则 | 同脚本：`detectionFrameSingleLine`、`noFrameWhenDetectionDisabled`；另需肉眼比对左右阴影 | 实现已定位，待主任务动态回填 |
| FRAME-03 | 锁定宠物时背景检测在宠物窗口暂停、不显示边框；设置页开关保持正常状态并可继续调整 | `renderer/app.js` 的 `applySnapshot()`；`renderer/settings.js` 的 `renderToggles()` | `qa/chat-acceptance.cjs`：`lockSuspendsDetectionFrame`；`qa/settings-ui.cjs`：`lockLeavesBackgroundDetectionControlEnabled` | 实现已定位，待主任务动态回填 |
| FRAME-04 | 聊天打开时只有角色和聊天框实际区域命中，透明空白继续穿透；锁定始终全局穿透，并自动隐藏聊天/收起长消息、保留草稿 | `main.js` 的 `applyPetInteractionRegion()`；`config/pet-interaction-region.js`；`renderer/app.js` 的 `reportChatPanelVisualBounds()`、`applySnapshot()` | `npm run qa:input-region`；`qa/chat-acceptance.cjs` 的 `lockInteractionBehavior`；另需实机点击角色周围空白确认桌面收到鼠标 | 自动化通过，实机点击待复核 |
| CHAT-01 | 聊天每次打开默认折叠，只能点击左侧按钮展开；hover、移出和失焦不改变状态 | `renderer/app.js` 的 `setChatOpen()`、`setChatCollapsed()`；`renderer/styles.css` 的折叠态 | 同脚本：`opensCollapsed` 至 `secondClickCollapses` | 实现已定位，待主任务动态回填 |
| CHAT-02 | 两主题切换时展开聊天框始终完整，底部输入和按钮不被裁切 | `renderer/app.js` 的 `updateChatPosition()`、`syncChatPositionDuringTransition()`、`ResizeObserver`；`renderer/styles.css` 的主题高度上限 | 同脚本：`runExpandedThemeSwitch()` | 实现已定位，待主任务动态回填 |
| CHAT-03 | 折叠态左侧控件简洁，聊天框左右视觉重量与阴影一致 | `renderer/styles.css` 的 `.ai-chat-panel.is-collapsed`、`.ai-chat-toggle` | 两主题 400×600 截图人工比对 | 实现已定位，待主任务动态回填 |
| SCALE-01 | 无聊天框时滚轮缩放也立即显示尺寸，不依赖背景检测或角色点击 | `renderer/app.js` 的 `applyWheelScale()`、`showStatus()`；`main.js` 的 `pet:status-bounds` 命中区 | 同脚本：`visibleWithoutChat`；分别在背景检测开/关状态人工滚轮复验 | 实现已定位，待主任务动态回填 |
| SCALE-02 | 尺寸提示无聊天时位于窗口底部；有聊天时位于聊天框上方，不遮挡角色脸部 | `renderer/app.js` 的 `updateStatusToastPosition()`；`renderer/styles.css` 的 `.status-toast.is-scale-status` | 同脚本：`defaultsToBottomWithoutChat`、`sitsAboveChat` | 实现已定位，待主任务动态回填 |
| SCALE-03 | 到达 10% / 200% 边界时仍给出“已达”提示 | `renderer/app.js` 的 `applyWheelScale()` | 连续滚轮缩小/放大至边界，确认提示出现且数值不越界 | 实现已定位，待主任务动态回填 |

### 2.2 顶部气泡与聊天消息

| ID | 用户需求 / 期望结果 | 主要实现位置 | 自动化或人工验收 | 当前文档状态 |
|---|---|---|---|---|
| BUBBLE-01 | 同时只允许一个顶部气泡；当前气泡未消失时，后来消息直接丢弃，不覆盖、不排队 | `renderer/app.js` 的 `showBubble()`、`dismissBubble()` 和 lease 状态 | `qa/chat-acceptance.cjs`：`runBubbleLifecycle()` 的单实例断言 | **自动化通过** |
| BUBBLE-02 | AI 语音回复严格经历“思考中 → 语音合成中 → 最终语音”；两个过程气泡都保持到对应请求完成，最终气泡持续到音频播放 Promise 结束 | `renderer/app.js` 的 `submitChat()`、`playGeneratedSpeech()` 和气泡 lease 状态 | `qa/chat-acceptance.cjs`：阶段顺序、AI/TTS 完成边界、语音存续与竞争消息断言 | **自动化通过** |
| BUBBLE-03 | 模型加载完成前不显示欢迎语或其他顶部气泡 | `renderer/app.js` 的模型 ready 状态、`ensureChatGreeting()` 和待显示气泡触发点 | QA 主动阻塞模型加载：加载期气泡隐藏；`phase=ready` 且角色命中边界出现后才显示欢迎气泡，7 项断言 | **自动化通过** |
| CHAT-04 | 聊天滚动条停在最底部时，最后一条消息、滚动位置和面板本身不持续抖动 | `renderer/app.js` 的消息滚动逻辑；`renderer/styles.css` 的消息布局/动画 | `qa/chat-acceptance.cjs`：glass/healing 的思考中与长回复共 4 个阶段持续采样，全部 spread 为 0px | **自动化通过** |

### 2.3 设置页、角色列表与行为逻辑

| ID | 用户需求 / 期望结果 | 主要实现位置 | 自动化或人工验收 | 当前文档状态 |
|---|---|---|---|---|
| SETTINGS-01 | 设置页已打开时，右键“打开设置”只恢复并聚焦窗口，不刷新、不跳回第一个页签 | `main.js` 的 `openSettings(section, notice)` | 进入“行为”页，隐藏/失焦设置，再右键打开；页签、滚动位置和表单状态保持 | 实现已定位，待主任务动态回填 |
| SETTINGS-02 | 切换设置页签后，动态背景宠物立即继续鼠标跟随，不需要先点击宠物 | `renderer/settings.js` 页签事件；`settings-preload.js` 的 `refreshCursorFollow()`；`main.js` 的 `cursor:refresh` | 连续切换角色/行为/AI/系统并移动鼠标，确认跟随立即生效 | 实现已定位，待主任务动态回填 |
| SETTINGS-03 | 设置页四周留白、圆角一致；底部内容和按钮不被页脚遮挡；版本号清晰 | `renderer/settings.css` 的 window shell、section scroll padding、footer 和 `#app-version` | `qa/settings-ui.cjs` 双主题四页截图；人工检查 470×760 底部 | 实现已定位，待主任务动态回填 |
| SETTINGS-04 | 治愈主题页脚恢复原设计：左侧产品名，右侧猫咪、圆形更新按钮和普通版本文字 | `renderer/settings.css` 的 `.app-footer`、`.footer-right`、更新按钮 | `qa/settings-ui.cjs` 的 healing 四页截图 | 实现已定位，待主任务动态回填 |
| MODEL-UX-01 | 角色卡片支持拖动排序，排序持久化；拖动手柄不与横向轮播/点击选择冲突 | `renderer/settings.js` 的 dragstart/dragover/dragend；`main.js` 的 `updateModelOrder()`；`settings-preload.js` 的 `reorderModels()` | `qa/settings-ui.cjs`：`modelOrderPersists`；重启后人工确认顺序 | 实现已定位，待主任务动态回填 |
| MODEL-UX-02 | 初次运行默认选中 `mori-suit`，已有有效选择的老用户不被覆盖 | `main.js` 的 `selectedModel()`、`migrateStore()` | 隔离空 userData 启动应为 mori-suit；已有 currentModelId 启动应保持原角色 | 实现已定位，待主任务动态回填 |
| MODEL-UX-03 | 调整角色尺寸时不重建角色卡片，分页圆点和滚动位置不跳动 | `renderer/settings.js` 的 `renderedModelListKey` / `modelListRenderKey` | `qa/settings-ui.cjs`：`scaleKeepsCarouselStable` | 实现已定位，待主任务动态回填 |
| MODEL-UX-04 | 选中角色卡片顶部描边完整，不被横向列表裁切 | `renderer/settings.css` 的 `.model-list` 上下内边距 | 双主题角色页截图人工检查 | 实现已定位，待主任务动态回填 |
| MODEL-UX-05 | 拖动桌宠时设置页背景角色不消失，松手后自动恢复实时帧 | `renderer/app.js` 与 `renderer/settings.js` 的双端透明帧保护；主进程背景帧转发 | `qa/settings-background.cjs` | 实现已定位，待主任务动态回填 |
| MODEL-UX-06 | 每个角色独立保存 10%～100% 不透明度；切换模型后恢复各自数值，且聊天、气泡、特效与命中区域不变 | `modelOpacities`、`model:opacity-update`、`--pet-character-opacity` | `qa/settings-ui.cjs` 的 `modelOpacityPersistsPerCharacter`；桌宠窗口截图对照 | 实现已定位，待主任务动态回填 |
| MODEL-UX-07 | 尺寸和不透明度均可切换为“应用于全角色”；启用后切换或新导入角色沿用共享值，关闭后恢复其他角色的独立值 | `modelScaleApplyToAll` / `sharedModelScale`、`modelOpacityApplyToAll` / `sharedModelOpacity`、`model:display-scope-update` | `npm run qa:character-ranges`；双主题 470×760 截图人工比对 | 实现已定位，待主任务动态回填 |
| MODEL-UX-06 | Windows 目录型 `.model3.json` 模型可真实加载 | `renderer/app.js` 的 URL-aware path 处理 | `qa/directory-model.cjs` | 实现已定位，待主任务动态回填 |
| BEHAVIOR-01 | “安静陪伴 / 自然互动 / 省电陪伴”是组合预设；“自适应 / 省资源 / 高质量”只设置性能档，两者状态来源一致且能互相反映 | `renderer/settings.js` 的 `companionPresets`、`renderCompanionState()`、`renderToggles()` | `qa/settings-ui.cjs` 的 `companionPresets`、`externalSnapshotUpdatesSelection`；手动交叉修改验证 | 实现已定位，待主任务动态回填 |
| BEHAVIOR-02 | “闲置与睡眠”开启后：30 秒进入轻闲置，90 秒困倦，180 秒深度休息并降帧；任意有效互动重置计时 | `renderer/app.js` 的 `updateIdle()` / 帧率策略；设置项 `idleEnabled` | 开启后按 30/90/180 秒观察；关闭后同等时间不触发；互动后重新计时 | 实现已定位，待主任务动态回填 |

### 2.4 AI 模型管理与提示

| ID | 用户需求 / 期望结果 | 主要实现位置 | 自动化或人工验收 | 当前文档状态 |
|---|---|---|---|---|
| AI-01 | 删除“智谱 GLM · v1.0.0”文字模型，只保留 DeepSeek 文本和智谱 GLM-TTS 语音 | 已删除 `plugins/zhipu-chat/`；`package.json` 检查脚本和 `README.md` 同步 | `rg -n "zhipu-chat|glm-4" .` 不应命中有效实现；AI 页截图仅显示两张模型卡 | 实现已定位，待主任务动态回填 |
| AI-02 | 已启用模型可以停用；移除“卸载”按钮与卸载逻辑，配置与密钥保留 | `ai/plugin-manager.js` 的 `deactivate()`；`main.js` 的 `ai:plugin-deactivate`；设置页启用/停用按钮 | `qa/settings-ui.cjs`：`activeAIModelCanStopAndRestart`；`rg` 不应命中卸载 IPC/API | 实现已定位，待主任务动态回填 |
| AI-03 | “停用”是管理按钮，不使用绿色能力标签的胶囊样式 | `renderer/settings.css` 的 `.plugin-select-action.is-active` | 双主题 AI 页截图比对按钮与 `可以对话` 标签 | 实现已定位，待主任务动态回填 |
| AI-04 | 文字和语音卡片配置文案不换行；折叠逻辑一致；语音卡片不出现重复的“可以发声/插件设置”区域 | `renderer/settings.css` 的统一 collapsed 规则、按钮最小宽度和 voice ready badge 隐藏 | `qa/settings-ui.cjs` 双主题 AI 页截图与 overflow 指标 | 实现已定位，待主任务动态回填 |
| AI-05 | 右键对话：未配置文本模型提示“请先配置文本模型”；已配置但未启用提示“文本模型尚未启用…” | `main.js` 的 `aiCapabilityAvailability()`、`aiCapabilitySetupMessage()`、`openAIChat()` | 两种状态分别打开右键菜单并点击，确认设置 AI 页提示准确 | 实现已定位，待主任务动态回填 |
| AI-06 | 聊天开启语音：未配置与未启用分别提示，不错误解除静音 | `renderer/app.js` 的 `chatCapabilityAvailability()` 和 mute 事件 | 两种状态点击语音按钮，确认提示文字、静音状态和无 TTS 请求 | 实现已定位，待主任务动态回填 |

### 2.5 按角色隔离的持久化会话

| ID | 用户需求 / 期望结果 | 主要实现位置 | 自动化或人工验收 | 当前文档状态 |
|---|---|---|---|---|
| MEMORY-01 | 对话历史按角色 ID 隔离；角色 A 的上下文不会发送给角色 B | `ai/plugin-manager.js` 的 `conversationKeyFor()`、`readConversation()`、`chat()`；`main.js` 注入当前 `modelId` | `npm run qa:conversation` | 实现已定位，待主任务动态回填 |
| MEMORY-02 | 应用重启后历史恢复；切换/停用文字模型不清除角色历史 | `electron-store` 的 `aiConversations`；renderer 的 `restoreChatHistory()` | 同脚本重建 manager；另做一次真实应用重启检查 | 实现已定位，待主任务动态回填 |
| MEMORY-03 | “清空”只清除当前角色；其他角色历史保留 | `main.js` 的 `ai:conversation-clear`；`renderer/app.js` 清空事件；plugin manager `clearConversation()` | 同脚本 role-a / role-b 断言；真实 UI 切角色复验 | 实现已定位，待主任务动态回填 |
| MEMORY-04 | 只持久化文本 `role/content`；不保存音频 Base64、归档路径或音频二进制 | `ai/plugin-manager.js` 的消息归一化与 TTS 独立归档 | 同脚本的存储字段断言 | 实现已定位，待主任务动态回填 |

## 3. 三组模式的逻辑关系

用户在角色页看到的三个陪伴选项与行为页三个性能选项，不是两套重复的标签：

| 角色页陪伴预设 | 光标跟随 | 轻量点击反馈 | 闲置与睡眠 | 性能模式 |
|---|---|---|---|---|
| 安静陪伴 | 关闭 | 关闭 | 开启 | 自适应 |
| 自然互动 | 靠近时跟随 | 开启 | 开启 | 自适应 |
| 省电陪伴 | 关闭 | 关闭 | 开启 | 省资源 |

行为页的“自适应 / 省资源 / 高质量”只修改 `qualityMode`。角色页预设会一次写入多项行为设置，其中包括性能模式。当前所有设置均从同一份 `preferences` 快照渲染，因此：

- 点击“省电陪伴”后，行为页应同步选中“省资源”；
- 点击“安静陪伴”或“自然互动”后，行为页应同步选中“自适应”；
- 用户在行为页单独改动任一组合字段后，如果不再完整匹配某个预设，角色页三个陪伴预设都可以不选中；
- “高质量”没有对应的角色页组合预设，这是预期，不应错误高亮任一陪伴预设。

## 4. 数据保存位置与隐私边界

对话内容保存在**物理机磁盘**，不是浏览器 `localStorage`，也不是只存在于物理内存。Windows 默认位置为：

`%APPDATA%\Live2DCompanion\config.json`

`electron-store` 在该文件的 `aiConversations` 字段中按角色 ID 保存：

```json
{
  "aiConversations": {
    "senko": {
      "messages": [
        { "role": "user", "content": "..." },
        { "role": "assistant", "content": "..." }
      ],
      "updatedAt": "2026-09-11T00:00:00.000Z"
    }
  }
}
```

存储边界：

- 运行时 `Map` 只是内存缓存，应用退出后由 `config.json` 恢复；
- 会话键是角色 `modelId`，不是当前文字插件 ID，因此切换文字服务仍延续该角色上下文；
- 每条消息持久化前最多保留 2000 个字符，整个角色最多保留 40 条，实际发送/保存还受用户配置的 `historyLimit` 限制；
- 情绪标签在入库前剥离；只保存 `role` 与 `content`；
- TTS 音频不写入 `aiConversations`，单独归档到 `%APPDATA%\Live2DCompanion\tts\`；
- 角色排序保存在同一 `config.json` 的 `modelOrder`；角色独立尺寸保存在 `modelScales`；昵称保存在 `modelNicknames`；
- 用户模型位于 `%APPDATA%\Live2DCompanion\models\`，用户插件位于 `%APPDATA%\Live2DCompanion\plugins\`。

验收时不得把真实用户 `config.json` 上传或附入报告；只记录字段结构、角色数量和断言结果。

## 5. 建议验收顺序

### 5.1 自动化

在仓库根目录依次执行：

```powershell
npm run check
npm run lint
git diff --check
npm run qa:conversation
npm run qa:settings
npm run qa:chat
npm run qa:background
npm run qa:directory
```

任何命令失败后都应先修复，再从静态检查开始完整重跑，避免用旧截图和旧 JSON 拼接终验结论。

### 5.2 真实应用快速检查

1. 使用隔离的新用户数据启动，确认默认角色是 `mori-suit`。
2. 打开设置并停留在“行为”，失焦后右键再次打开设置，确认仍在“行为”且页面未刷新。
3. 在四个页签之间切换，移动鼠标，确认设置背景中的角色无需点击即可跟随。
4. 在角色页拖动调整顺序，重启应用，确认顺序保持；调整尺寸时分页圆点不移动。
5. 背景检测关闭、聊天关闭时滚轮缩放，确认尺寸提示在底部；打开聊天后再次缩放，确认提示位于聊天框上方。
6. 在 glass/healing 间来回切换，展开聊天，确认输入区、静音和发送按钮始终完整。
7. 让一个普通气泡显示期间触发第二次互动，确认第二条被丢弃；播放语音回复，确认气泡到播放结束才消失。
8. 使用慢加载模型打开聊天，确认模型可见且状态 ready 之前不会出现顶部欢迎气泡。
9. 向角色 A、B 分别发送可识别文本，重启应用后分别检查历史；在 A 中清空，确认 B 不受影响。
10. 把聊天消息滚至最底部停留 3 秒，确认最后一条消息和滚动条不抖动。

### 5.3 实机专项

- 物理鼠标执行慢拖、快拖、越窗松手各 5 次，确认原生窗口坐标变化、松手不漂移、重启后位置恢复。
- 在纯白、纯黑和高纹理桌面各检查一次 glass 主题文字、边框、阴影和版本号。
- 使用真实 DeepSeek / GLM-TTS 配置各完成一次对话与语音播放；报告只记录成功/失败与错误摘要，不记录密钥或原文隐私数据。

## 6. 自动化证据位置

| 脚本 | 主要覆盖 | 默认输出 |
|---|---|---|
| `qa/settings-ui.cjs` | 设置页双主题四页、陪伴预设、排序、分页稳定、AI 启停和基础可访问性 | `%TEMP%\live2d-companion-qa\` |
| `qa/chat-acceptance.cjs` | 聊天布局、主题切换、边框、气泡、尺寸提示位置、滚动防抖 | `%TEMP%\live2d-chat-acceptance\results.json` |
| `qa/settings-background.cjs` | 真实双窗口动态背景、拖动透明帧、显隐和失败恢复 | `%TEMP%\live2d-settings-background-qa\results.json` |
| `qa/directory-model.cjs` | Windows 目录型 Cubism 模型真实加载；测试时自动解压临时夹具 | `%TEMP%\live2d-directory-model-qa\results.json` |
| `qa/conversation-persistence.cjs` | 角色隔离、重启恢复、插件切换/停用、清空范围、音频排除 | 标准输出 JSON；脚本结束后删除隔离临时目录 |

`qa/` 是工作区回归工具目录；`package.json > build.files` 使用 `!qa/**` 排除整个目录，不应把这些脚本打入正式发行物。

## 7. 主任务最终动态结果回填区

最终工作区已于 2026-09-11 完成下列自动化回归。结果只代表自动化覆盖范围，不替代第 8 节人工实机签字。

| 检查项 | 本次执行时间 | 结果 | 关键计数 / 指标 | 证据路径或失败摘要 |
|---|---|---|---|---|
| `npm run check` | 2026-09-11 最终回归 | **通过** | 全部 JavaScript 入口语法检查通过 | 命令标准输出 |
| `npm run lint` | 2026-09-11 最终回归 | **通过** | ESLint 通过 | 命令标准输出 |
| `git diff --check` | 2026-09-11 文档收口 | **通过** | 无补丁空白错误 | 命令标准输出 |
| 会话持久化 QA | 2026-09-11 最终回归 | **通过** | 18/18 | `npm run qa:conversation` 标准输出 JSON |
| 设置页 QA | 2026-09-11 16:33 | **通过** | 双主题四页共 8 张；综合断言全部通过；consoleErrors=0 | `%TEMP%\live2d-companion-qa\metrics.json` |
| 聊天综合 QA | 2026-09-11 16:17 | **通过** | 双主题、主题切换、模型加载门槛、15 项气泡流程、4 项尺寸提示和双主题滚动稳定性全部通过 | `%TEMP%\live2d-chat-acceptance\results.json` |
| 动态背景 QA | 2026-09-11 16:33 | **通过** | 10/10；frameCount=16；nullFrameCount=0 | `%TEMP%\live2d-settings-background-qa\results.json` |
| 目录模型 QA | 2026-09-11 最终回归 | **通过** | `phase=ready`；可见边界 `x=68,y=40,w=264,h=496` | `%TEMP%\live2d-directory-model-qa\results.json` |

聊天气泡阶段实测为：思考中约 6ms 出现、语音合成中约 412ms 出现、最终语音约 872ms 出现；最终气泡可见约 925ms，并在播放结束后消失。模型加载门槛 7/7 通过：加载阻塞期间聊天内已有欢迎文案，但顶部气泡不可见且无角色命中边界，模型 ready 后才显示顶部欢迎气泡。

## 8. 人工签字区

| 项目 | 执行人 | 日期 | 结果 | 备注 |
|---|---|---|---|---|
| 原生窗口物理拖动与重启位置恢复 | 待填写 | 待填写 | 待实机 | 慢拖/快拖/越窗松手各 5 次 |
| glass 真实桌面对比度 | 待填写 | 待填写 | 待实机 | 白/黑/高纹理三类背景 |
| 真实文本与语音服务 | 待填写 | 待填写 | 待实机 | 不记录 API Key |
| 全量产品验收 | 待填写 | 待填写 | 待签字 | 自动化与前三项全部完成后签字 |

## 9. 发布前最后检查

- 文档中的状态与本次 JSON 结果一致；
- 删除的智谱文字插件没有残留入口、检查脚本或 README 描述；
- 没有“卸载模型”按钮、IPC 和 manager 逻辑残留；
- 发行包排除 `docs/`、`design-demos/`、`qa/`、`plan/`、`release/` 和开发工具；
- 不提交 `%APPDATA%` 中的真实配置、聊天内容、语音归档或 API Key；
- 用户明确要求发版前，再执行正式打包与发布流程；完成开发不等于已授权发版。
