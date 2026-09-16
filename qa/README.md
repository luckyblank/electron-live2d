# QA 回归工具

此目录只存放可重复运行的质量验证脚本，不会打入正式安装包。脚本使用隔离的临时目录保存测试数据、截图和 JSON 报告，不会读写正式用户配置。

## 快速命令

```bash
npm run qa:check
npm run qa:conversation
npm run qa:external-messages
npm run qa:external-message-ui
npm run qa:qwen
npm run qa:settings
npm run qa:shortcuts
npm run qa:shortcut-settings
npm run qa:chat
npm run qa:background
npm run qa:directory
npm run qa:ai-environment
npm run qa:release-upload
```

| 命令 | 脚本 | 用途 | 主要输出 |
|---|---|---|---|
| `npm run qa:check` | 全部脚本 | JavaScript 语法检查 | 标准输出 |
| `npm run qa:conversation` | `conversation-persistence.cjs` | 角色会话隔离、恢复、切换、停用与清理 | 标准输出 JSON |
| `npm run qa:external-messages` | `external-message-server.cjs` | 外部消息 HTTP/WebSocket、新参数、历史接口、归档语音与 Range 播放、幂等与串行队列 | 标准输出 |
| `npm run qa:external-message-ui` | `external-message-tester-ui.cjs` | 测试台无边框标题栏、窗口四边无透明留白、舒适的多行消息编辑高度、语音播报默认关闭、AI 参数按模式显隐、事件倒序、requestId 分组/折叠/协议配色/细边框、完整事件数据、事件区细滚动条、HTTP/WS 按钮及快捷键、消息历史分类/搜索/分页/完整数据/外部消息单行折叠与悬停全文/语音试听、API 与窄屏检查 | `%TEMP%\live2d-companion-external-tester-qa-output\` |
| `npm run qa:tray-menu` | `tray-menu.cjs` | APP 长截图按开关与设置窗口可见性显示；外部消息调试按接入开关显示 APP/浏览器两个入口，并随服务就绪启用 | 标准输出 |
| `npm run qa:qwen` | `qwen-tts.cjs` | Qwen-TTS 非流式请求、48 个试听地址、WAV 下载与本地归档 | 标准输出 |
| `npm run qa:tts-cache` | `tts-cache.cjs` | 外部语音专用缓存、Qwen/智谱配置维度、跨重启命中、APP 绕过缓存、独立历史归档与元数据脱敏 | 标准输出 |
| `npm run qa:settings` | `settings-ui.cjs` | 设置页双主题、布局、交互、模型排序与 APP/外部长消息自动展开开关的独立持久化 | `%TEMP%\live2d-companion-qa\` |
| `npm run qa:shortcuts` | `shortcut-registration.cjs` | 首版开发中间配置自动补全、旧逗号键名修正，以及默认系统快捷键的实际全局注册 | 标准输出 JSON |
| `npm run qa:shortcut-settings` | `settings-ui.cjs --shortcut-settings-only` | 仅验证快捷键卡片双主题、APP 长截图默认键、编辑、恢复默认与添加/删除自定义快捷键 | `%TEMP%\live2d-shortcut-settings-qa\` |
| `npm run qa:chat` | `chat-acceptance.cjs` | 聊天布局、三行气泡预览、外部消息独立轻量来源标识、长消息展开/滚动/复制与双主题同高、APP/外部长消息自动展开的来源隔离/最终态/焦点/短消息/完整聊天视图边界、Windows 独立阅读器左右定位与展开/收起期间宠物原生 400×600 边界不变、展开期间长消息原位更新且短消息自动返回普通气泡、阅读窗外透明边缘/紧凑尾巴/标签留白、长文本外部来源标识、收起后关闭来源气泡、长消息语音标识/重播/停止/收起时清空口型、APP 消息不显示冗余来源徽标、APP/外部最终消息的可选打字机效果、语音时长同步、完成后 2 秒收起、长消息中途展开续播、APP/外部思考与语音阶段的完成边界、外部气泡优先级、聊天框状态隔离与滚动稳定性 | `%TEMP%\live2d-chat-acceptance\results.json` |
| `npm run qa:message-output` | `settings-ui.cjs --message-output-only` + `chat-acceptance.cjs --message-output-only` | 仅验证本轮“消息输出方式”：双主题分组、APP/外部开关默认关闭与独立持久化，以及气泡直接显示/逐字流式显示的来源隔离 | `%TEMP%\live2d-message-output-settings-qa\`、`%TEMP%\live2d-message-output-runtime-qa\` |
| `npm run qa:background` | `settings-background.cjs` | 宠物到设置页的动态背景链路与恢复 | `%TEMP%\live2d-settings-background-qa\results.json` |
| `npm run qa:directory` | `directory-model.cjs` | Windows 目录型 Live2D 模型加载 | `%TEMP%\live2d-directory-model-qa\results.json` |
| `npm run qa:ai-environment` | `ai-environment.cjs` | AI Key 的 `.env` 优先、空值回退系统环境变量、旧版加密值兼容及脱敏来源状态 | 标准输出 |
| `npm run qa:release-upload` | `release-upload.cjs` | `.env` 解析、版本清单校验、对象 Key/URL 安全和三文件上传计划 | 标准输出 |

`directory-model.cjs` 会从 `models/hiyori/Hiyori.zip` 创建独立临时夹具，测试结束后自动删除，不依赖已经移除的历史模型目录。
