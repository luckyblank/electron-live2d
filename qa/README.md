# QA 回归工具

此目录只存放可重复运行的质量验证脚本，不会打入正式安装包。脚本使用隔离的临时目录保存测试数据、截图和 JSON 报告，不会读写正式用户配置。

## 快速命令

```bash
npm run qa:check
npm run qa:conversation
npm run qa:qwen
npm run qa:settings
npm run qa:chat
npm run qa:background
npm run qa:directory
```

| 命令 | 脚本 | 用途 | 主要输出 |
|---|---|---|---|
| `npm run qa:check` | 全部脚本 | JavaScript 语法检查 | 标准输出 |
| `npm run qa:conversation` | `conversation-persistence.cjs` | 角色会话隔离、恢复、切换、停用与清理 | 标准输出 JSON |
| `npm run qa:qwen` | `qwen-tts.cjs` | Qwen-TTS 非流式请求、48 个试听地址、WAV 下载与本地归档 | 标准输出 |
| `npm run qa:settings` | `settings-ui.cjs` | 设置页双主题、布局、交互与模型排序 | `%TEMP%\live2d-companion-qa\` |
| `npm run qa:chat` | `chat-acceptance.cjs` | 聊天布局、气泡生命周期与滚动稳定性 | `%TEMP%\live2d-chat-acceptance\results.json` |
| `npm run qa:background` | `settings-background.cjs` | 宠物到设置页的动态背景链路与恢复 | `%TEMP%\live2d-settings-background-qa\results.json` |
| `npm run qa:directory` | `directory-model.cjs` | Windows 目录型 Live2D 模型加载 | `%TEMP%\live2d-directory-model-qa\results.json` |

`directory-model.cjs` 会从 `models/hiyori/Hiyori.zip` 创建独立临时夹具，测试结束后自动删除，不依赖已经移除的历史模型目录。
