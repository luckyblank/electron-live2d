# Live2D 桌面伙伴 UI 修复与状态流说明

更新日期：2026-09-11
适用范围：当前工作区内的桌宠聊天、背景检测框、设置页动态角色背景、角色排序与尺寸反馈、AI 模型管理、角色会话持久化和目录型 Live2D 模型加载。

## 1. 文档目的

本文记录本轮 UI 接管开发中已经落地的机制、回归原因和验证入口。产品验收结论以 `docs/ui-acceptance-report.md` 为准，重复执行的测试用例以 `docs/ui-regression-test-report.md` 为准。

## 2. 聊天与背景检测框的职责边界

### 2.1 规则

- 打开聊天只控制聊天面板的显示状态，不创建整窗边框。
- 聊天面板每次打开默认为折叠态。
- 聊天面板只响应左侧切换按钮；悬停、移出和失焦不改变展开状态。
- 整窗轮廓只由有效的“背景检测”状态控制；锁定宠物时仅暂停宠物窗口中的检测效果并隐藏整窗轮廓，设置页开关保持正常、可操作状态，解锁后按当前开关值生效。
- 背景检测关闭时，整窗轮廓不显示。

### 2.2 状态流

```text
chat visibility changed
  -> setChatOpen(open)
  -> open: reset to collapsed
  -> update chat panel and accessibility state
  -> do not add a document/body border class

backgroundDetection changed
  -> pet-stage toggles has-background-detection
  -> dragging adds is-dragging
  -> #pet-stage::after displays one rounded outline
```

背景检测框采用单层 `1px` 轮廓、`8px` 内缩和 `26px` 圆角。拖动时只改变颜色与辉光强度，不叠加第二条内边线。

## 3. 设置页动态角色背景

### 3.1 回归根因

Windows 移动透明原生窗口时，Live2D WebGL canvas 可能在短时间内读出全透明帧。旧链路会继续把该帧编码为 WebP 并发送给设置窗口；设置窗口在绘制前先清空 canvas，因此最后一张有效角色画面会被透明帧覆盖。仅暂停模型更新不足以保证 WebGL 绘制缓冲在系统合成周期内持续有效。

### 3.2 当前状态流

```text
Live2D canvas
  -> captureSettingsPetBackground()
  -> skip capture while dragging
  -> downsample alpha probe
  -> transparent frame: reject and keep last valid frame
  -> visible frame: encode WebP
  -> main-process IPC relay
  -> settings renderer decodes bitmap
  -> second alpha probe
  -> transparent bitmap: reject
  -> visible bitmap: atomically replace settings canvas
```

拖动结束时会重置采集节流时间和恢复尝试次数，并触发健康检查，使新有效帧无需依赖显隐窗口或切换模型即可恢复。

切换模型期间不再主动发送空帧。设置页保留旧模型最后一张有效画面，待新模型首张有效帧就绪后再替换；加载失败回退时同样不会出现空白闪烁。

### 3.3 双重空帧保护

- 桌宠 renderer：编码前检查降采样画布的 alpha 像素。
- 设置 renderer：提交到可见 canvas 前再次检查已解码 bitmap。

双端检查用于防止 WebGL 读取、编码、IPC 或解码任一阶段产生的透明帧覆盖有效画面。

## 4. Windows 目录型 Live2D 模型加载

### 4.1 回归根因

`live2d-renderer` 通过 Node `path.dirname()` 与 `path.join()` 解析 `.model3.json` 引用的 moc、纹理、physics 和动作文件。在 Windows 下把 `file:///D:/...` 交给这些路径函数会得到 `file:/...` 或 `.\file:\D:\...`，随后 `fetch()` 将其解释为非法相对地址。

### 4.2 修复策略

renderer 在载入 `live2d-renderer` 前保留普通文件系统路径行为，并只对包含 URL scheme 的资源路径使用标准 `URL` 解析：

- URL 的目录通过 `new URL('.', modelUrl)` 取得；
- 相对资源通过 `new URL(relativePath, baseUrl)` 解析；
- 非 URL 路径仍使用 Node 原生 `path.dirname()` / `path.join()`；
- zip 模型链路保持不变。

这样目录模型可以使用规范 `file:///...` URL 读取所有相对依赖，同时不修改第三方依赖包文件。

## 5. AI 插件卡片可读性

插件卡片不再使用 `-webkit-line-clamp` 和固定高度裁切说明：

- 卡片高度根据内容增长；
- 标题、说明、状态徽标和操作按钮使用独立网格区域；
- 说明允许正常换行和完整显示；
- 页面承担纵向滚动，不再通过继续缩小字号压入固定卡片。

插件目录长路径仍采用省略展示，这是路径字段的预期行为，不影响插件说明语义；完整路径仍保留在 DOM 文本中，并可通过旁边的“打开插件文件夹”操作直接访问。

## 6. 角色排序、尺寸、透明度与设置窗口恢复

角色顺序由设置 renderer 的拖动手柄更新，经过 `settings-preload.js` 的 `model:reorder` IPC 写入主进程。主进程会校验角色 ID、去重、补齐新发现的模型，再把顺序写入 `electron-store` 的 `modelOrder`。列表普通拖动仍用于横向轮播，只有从排序手柄开始才进入排序状态。

角色尺寸默认按 `modelId` 独立保存在 `modelScales`。勾选“将尺寸应用于全角色”后，`modelScaleApplyToAll` 启用 `sharedModelScale`：当前值立即成为所有现有和后续导入角色的显示尺寸，设置页滑杆与桌宠滚轮都会更新该共享值。取消勾选时只把共享值写回当前角色，其余角色恢复此前的独立尺寸。设置页渲染使用不包含 scale 的模型列表 key，因此尺寸快照变化不会重建卡片 DOM、重置 `scrollLeft` 或改变分页圆点。桌宠滚轮反馈在 IPC 保存前乐观显示：

角色不透明度默认按同一模型 ID 独立保存在 `modelOpacities`，允许范围为 10%～100%。勾选“将不透明度应用于全角色”后，`modelOpacityApplyToAll` 启用 `sharedModelOpacity`，切换角色和后续导入角色都沿用共享值；取消后当前角色保留共享值，其余角色恢复各自保存值。renderer 只把不透明度应用到活动角色 Canvas 与模型切换冻结帧；特效 Canvas、聊天面板、气泡、状态提示、背景检测边框、命中蒙版和设置页背景采集保持原样。旧配置没有对应键时回退到 100%，两个全角色开关默认为关闭。

- 聊天关闭：状态提示固定在窗口底部 18px；
- 聊天打开：提示移到聊天框上方约 10px；
- 达到 10% / 200% 边界：仍显示当前极限值；
- 状态提示的可见包围盒会上报主进程，背景检测关闭时也保留该区域的鼠标命中，从而不会因为透明窗口穿透而丢失后续滚轮事件。

`openSettings()` 区分“恢复现有窗口”和“带目标页导航”：普通右键打开只执行 show/focus/moveTop，保留当前页签；只有 AI 缺少配置等明确入口才发送 `settings:navigate`。设置页切换页签时主动发送 `cursor:refresh`，主进程立即推送当前位置，动态背景中的角色不再依赖额外点击才恢复跟随。

## 7. 陪伴预设与性能模式

角色页三个陪伴选项是多字段组合预设，不是性能模式的别名：

- 安静陪伴：关闭光标跟随和轻量特效，保留闲置睡眠，性能为自适应；
- 自然互动：靠近时跟随并开启轻量特效，保留闲置睡眠，性能为自适应；
- 省电陪伴：关闭光标跟随和轻量特效，保留闲置睡眠，性能为省资源。

行为页“自适应 / 省资源 / 高质量”只更新 `qualityMode`。两个区域都从同一份 `preferences` 快照推导选中态；如果用户手工调整后不再完整匹配预设，角色页允许没有任何预设高亮。闲置睡眠开启时，30 秒进入轻闲置、90 秒进入困倦、180 秒进入深度休息并进一步降帧；有效互动会重置计时。

## 8. AI 模型状态与顶部气泡

AI 管理从“安装/卸载”改为“安装后启用/停用”：停用只清空对应能力的 active ID 并中止进行中的请求，保留模型配置和安全存储中的凭据。内置智谱文字插件已经删除；文字能力为 DeepSeek，语音能力为智谱 GLM-TTS。设置页的“停用”使用普通管理按钮样式，不复用绿色能力徽标。

文字与语音能力分别判断“是否存在已配置模型”和“是否存在已启用且已配置模型”。因此：

- 未配置时提示“请先配置文本模型/语音模型”；
- 已配置但停用时提示“模型尚未启用”；
- 语音不可用时不能通过点击静音按钮进入伪启用状态。

顶部气泡用 lease 表示唯一占用者。已有气泡时，后续普通互动直接丢弃，不覆盖且不排队。语音回复取得 hold lease，直到 Live2D 音频播放 Promise 完成或主动停止才释放。模型加载门槛必须在最终回归中确认：欢迎语和其他顶部气泡只能在当前模型 ready 且已有可见角色边界后显示，不能先于角色出现在空窗口上。

## 9. 按角色隔离的持久化会话

会话由主进程 `ai/plugin-manager.js` 管理，角色 `modelId` 是唯一隔离键。renderer 内的 `Map` 仅用于当前运行期快速切换；真正的持久化数据由 `electron-store` 写入 Windows 默认应用数据文件：

`%APPDATA%\Live2DCompanion\config.json`

文件中的 `aiConversations` 结构为 `角色 ID -> messages + updatedAt`。消息只包含 `role` 与 `content`；情绪标签在保存前移除，TTS Base64、音频文件路径和二进制数据不进入会话字段。切换或停用文字插件不会删除角色历史；“清空”只删除当前角色。TTS WAV 继续单独归档到 `%APPDATA%\Live2DCompanion\tts\`。

持久化防护包括：单条消息最多 2000 字符、每个角色最多 40 条，并继续服从当前配置的 `historyLimit`。renderer 从主进程异步恢复时使用序列号校验，避免快速切换角色后把旧请求结果画到新角色聊天框。

## 10. 验证记录

开发侧已执行：

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

关键自动化结果：

- 设置窗口固定、不可拉伸、不可最大化、无系统阴影；
- 两主题四页背景角色位置统一；
- 聊天展开后完整位于 400×600 窗口内；
- 聊天开关不会新增整窗边框；
- 背景检测框为单层圆角轮廓；
- 设置页动态背景真实双窗口链路 10/10 通过，拖动中保留有效帧，松手后自动恢复；
- AI 插件说明不再出现在文字裁切检测结果中；
- `openSource.model3.json` 加载为 `ready`，交互命中区域为 `264×496`。

本轮新增角色排序、AI 停用、陪伴预设、尺寸提示位置、气泡 lease、聊天滚动防抖和会话持久化后，以上结果必须由主任务在最终代码稳定后重新执行并回填 `docs/final-acceptance-checklist.md` 第 7 节；不得沿用中间版本的历史通过记录。

## 11. 发布前注意事项

- `qa/` 是工作区验收工具目录；`package.json > build.files` 已明确加入 `!qa/**`，可以保留脚本用于后续回归，同时避免进入安装包。
- 自动化不能替代物理鼠标拖动和真实桌面背景可读性检查。最终签字前仍应在白色、黑色和高纹理桌面上检查玻璃主题，并执行慢拖、快拖、越窗松手和重启位置恢复。
- 如未来调整聊天或背景检测样式，不得重新引入聊天专属整窗边框类；整窗轮廓所有权必须继续归背景检测状态。
