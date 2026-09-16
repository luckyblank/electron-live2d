# 外部系统消息接入指南

本文档描述外部系统如何通过 HTTP 或 WebSocket 向 Live2DCompanion 发送消息，以及 App 如何区分消息来源、以最高优先级显示角色气泡、隔离 App/外部上下文、调用 Chat AI 和 TTS。

## 1. 功能概览

外部系统可发送两类消息：

| 类型 | `type` | 是否调用 Chat AI | 最终显示内容 |
|---|---|---:|---|
| 直接消息 | `direct` | 否 | 外部系统传入的原文 |
| AI问答 | `relay` | 是 | 当前桌宠角色基于外部问题生成回复 |

每条消息还可以通过 `speak` 决定是否调用当前启用的 TTS 模型进行语音播报。

所有外部消息在 App 内都带有以下来源信息：

```json
{
  "source": "external",
  "sourceLabel": "外部",
  "sender": "日程系统"
}
```

App 内部对话使用：

```json
{
  "source": "app",
  "sourceLabel": "APP"
}
```

底部聊天面板只显示并保存 `APP` 消息。外部消息不进入聊天面板，而是在角色上方气泡中显示“外部”标识；测试窗口的“消息历史”会保留外部原文、AI 回复、完整请求/响应、来源、参数和处理状态。

## 2. 启用接入服务

1. 打开 Live2DCompanion 设置。
2. 进入“系统”页面。
3. 开启“允许外部消息接入”。
4. 等待“外部消息服务”状态变为“运行中”。
5. 在“打开方式”中选择“APP 内部打开”（默认）或“浏览器打开”，再点击“打开测试页面”开始联调。

默认配置：

| 项目 | 值 |
|---|---|
| HTTP 基地址 | `http://127.0.0.1:17373` |
| 消息接口 | `http://127.0.0.1:17373/api/v1/messages` |
| WebSocket | `ws://127.0.0.1:17373/api/v1/events` |
| 在线测试页 | `http://127.0.0.1:17373/external-message-tester.html` |
| 默认状态 | 关闭 |
| 监听范围 | 仅本机回环地址 |

关闭开关后，HTTP 监听和 WebSocket 连接会停止。已经进入处理阶段的消息可能完成当前处理，但不会再接受新连接或新请求。

选择“APP 内部打开”时，测试台是独立的 Electron 顶级窗口：移动、最小化、刷新或关闭测试台不会改变 App 设置页和桌宠窗口。它仍受“允许外部消息接入”总开关管理；关闭该开关时，App 内部测试台窗口会立即关闭。选择“浏览器打开”时由系统默认浏览器打开相同地址；关闭总开关会停止服务，但 App 无权主动关闭已经打开的第三方浏览器标签页。

## 3. 协议约定

### 3.1 HTTP 方法

所有业务 API 统一使用 `POST`：

```text
POST /api/v1/health
POST /api/v1/session
POST /api/v1/messages
POST /api/v1/history
POST /api/v1/history/clear
```

测试页属于静态资源，使用 `GET /external-message-tester.html`；历史语音试听使用只读的 `GET /api/v1/history/audio/{messageId}`。WebSocket 的协议升级握手按照 WebSocket 标准使用 GET；建立连接后的业务消息使用 `message.post` 动作，并复用 HTTP POST 消息接口的校验、幂等和调度逻辑。

### 3.2 Content-Type 与编码

消息请求应使用 `Content-Type: application/json`，请求和响应统一使用 UTF-8。

## 4. 发送消息

### 4.1 请求结构

```json
{
  "type": "direct",
  "content": "您的会议将在十分钟后开始。",
  "speak": true,
  "sender": "日程系统",
  "requestId": "calendar-20260914-001",
  "useCurrentCharacterProfile": true,
  "useExternalContext": true
}
```

字段说明：

| 字段 | 类型 | 必填 | 限制 | 说明 |
|---|---|---:|---|---|
| `type` | string | 是 | `direct` / `relay` | 直连显示或交给当前 Chat AI 回答 |
| `content` | string | 是 | 去除首尾空白后最多 2,000 字符 | 外部消息正文 |
| `speak` | boolean | 否 | 默认 `false` | 是否播报最终显示内容 |
| `sender` | string | 否 | 最多 60 字符 | 外部系统名称；默认“外部系统” |
| `requestId` | string | 否 | 最多 120 字符 | 调用方幂等键；未传时由 App 生成 UUID |
| `useCurrentCharacterProfile` | boolean | 否 | 默认 `true` | `relay` 是否注入当前角色昵称与人设；`false` 时使用中性问答助手 |
| `useExternalContext` | boolean | 否 | 默认 `true` | `relay` 是否读取并写入独立外部上下文；`false` 时本次请求无历史且不留 AI 上下文 |

未识别的额外字段不会参与消息处理。

### 4.2 直接消息

直接消息不调用 Chat AI，适合通知、提醒、状态推送和业务播报。

```bash
curl -X POST "http://127.0.0.1:17373/api/v1/messages" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "direct",
    "content": "构建任务已经完成。",
    "speak": false,
    "sender": "CI 系统",
    "requestId": "ci-build-8421"
  }'
```

处理结果：

- 原文只显示在角色上方气泡中，气泡带“外部”标识；
- 不打开、不关闭、不折叠、不锁定也不写入底部聊天框；
- 不调用 Chat AI；
- 不写入 AI 对话上下文，避免业务通知改变角色后续回答；
- `speak: true` 时只调用当前 TTS 模型。

### 4.3 AI问答消息

AI问答消息会把外部正文作为一轮用户消息交给当前启用的 Chat 插件。默认使用当前角色昵称与人设，并读写“外部 AI问答专用上下文”；可通过两个布尔参数分别关闭角色设定和上下文。

```bash
curl -X POST "http://127.0.0.1:17373/api/v1/messages" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "relay",
    "content": "提醒用户今天下班前提交日报。",
    "speak": true,
    "sender": "办公系统",
    "requestId": "oa-daily-report-20260914",
    "useCurrentCharacterProfile": true,
    "useExternalContext": true
  }'
```

处理结果：

- 外部原文先显示在角色上方的“外部”气泡中；
- 当前 Chat AI 生成回答后更新同一外部气泡；
- `useCurrentCharacterProfile: true` 时以当前桌宠角色身份回复；设为 `false` 时使用不带角色姓名和人设的中性问答助手；
- `useExternalContext: true` 时该轮只写入当前角色的“外部 AI问答上下文”；它与 App 聊天上下文完全分开；
- `useExternalContext: false` 时既不读取历史，也不保存本轮 AI 上下文；
- 整个过程不会改变底部 App 聊天框状态或聊天历史；
- `speak: true` 时播报剥离情绪标签后的最终回复。

### 4.4 是否语音播报

| `speak` | 行为 |
|---|---|
| `false` 或省略 | 只显示消息，不调用 TTS |
| `true` | 对直连原文或 AI问答结果调用当前启用的 TTS |

外部请求明确设置 `speak: true` 时，视为该请求的播报指令。它会抢占正在播放的 App 内语音，并执行本次外部播报，不受聊天面板当前静音按钮影响。若没有启用或配置 TTS，消息仍会正常显示，响应中的语音状态为 `skipped`。

外部语音使用本机持久缓存。缓存命中标准为“规范化后的最终播报文本 + 当前 TTS 插件 ID / 版本 + 插件声明的语音配置字段”：

- 阿里云 Qwen-TTS：`model + voice`；
- 智谱 GLM-TTS：`model + voice + speed + volume`；
- 后续 TTS 插件通过清单的 `ttsCacheKeyFields` 声明参与缓存键的配置字段；未声明时安全回退为上述四个通用字段。

相同文本与有效配置再次播报时直接使用完整本地音频，不再访问供应商。文本、插件、插件版本或参与缓存键的任一配置不同都会重新生成。缓存只用于 `source: external` 的直连消息和 AI问答，App 内聊天语音保持原有的逐次实时生成行为。

## 5. HTTP 响应

成功示例：

```json
{
  "ok": true,
  "requestId": "calendar-20260914-001",
  "messageId": "2fa32e14-7384-45ab-8ee9-c2856262dc6c",
  "source": "external",
  "sourceLabel": "外部",
  "sender": "日程系统",
  "type": "direct",
  "result": {
    "text": "您的会议将在十分钟后开始。",
    "emotion": "",
    "aiGenerated": false,
    "speech": {
      "requested": true,
      "status": "ready",
      "pluginId": "zhipu-tts",
      "model": "glm-tts",
      "voice": "douji",
      "mimeType": "audio/wav",
      "cached": false
    }
  },
  "receivedAt": "2026-09-14T04:20:00.000Z",
  "completedAt": "2026-09-14T04:20:01.230Z"
}
```

`result.speech.status`：

| 状态 | 说明 |
|---|---|
| `disabled` | 请求没有要求语音播报 |
| `ready` | TTS 已生成并提交给桌宠播放 |
| `skipped` | 请求要求播报，但没有可用的 TTS 插件 |
| `failed` | TTS 调用失败；文字消息仍视为处理成功 |

`result.speech.cached` 仅在 `ready` 状态下返回：`false` 表示本次向供应商生成，`true` 表示命中本机缓存或复用同一时刻已在生成的同键请求。

HTTP 响应不返回音频 Base64 和本机存档路径，避免响应体过大或泄露本机目录。音频只通过 App 内部事件交给渲染器播放。

失败示例：

```json
{
  "ok": false,
  "error": "type 必须是 direct 或 relay",
  "code": "INVALID_REQUEST"
}
```

## 6. 健康检查与能力发现

### 6.1 健康检查

```bash
curl -X POST "http://127.0.0.1:17373/api/v1/health"
```

响应中的 `service` 包括 `enabled`、`status`、`running`、`host`、`port`、`messageUrl`、`websocketUrl`、`queueDepth`、`websocketClients` 和 `error`。

### 6.2 能力发现

```bash
curl -X POST "http://127.0.0.1:17373/api/v1/session"
```

此接口返回协议版本、支持的能力以及当前服务地址。调用方可在启动时检查能力，而不必硬编码全部路径。支持外部语音缓存的版本会在 `capabilities` 中包含 `speech-cache`。

## 7. WebSocket 接入

连接地址：

```text
ws://127.0.0.1:17373/api/v1/events
```

连接成功后首先收到 `session.ready`。发送消息使用：

```json
{
  "action": "message.post",
  "payload": {
    "type": "relay",
    "content": "请提醒用户检查新的工单。",
      "speak": true,
      "sender": "工单系统",
      "requestId": "ticket-9912",
      "useCurrentCharacterProfile": true,
      "useExternalContext": true
  }
}
```

请求发起连接会收到 `message.result`；校验或执行失败时收到 `message.error`。所有已连接客户端还会收到 `message.event` 生命周期广播。

`message.event.event.phase`：

| 阶段 | 说明 |
|---|---|
| `received` | 已通过校验，开始以最高优先级占用角色上方气泡；`stage` 为 `thinking`、`speech` 或 `display` |
| `progress` | 短暂的处理阶段变化；当前用于 AI 回复完成后从 `thinking` 切换到 `speech` |
| `completed` | 文本处理完成；如要求 TTS，已得到 TTS 结果 |
| `failed` | AI 或消息处理失败 |

`received` / `progress` 事件可包含 `progressText` 和 `transient: true`。它们只用来驱动当前气泡，不会作为对话消息写入 App 历史、外部 AI 上下文或外部消息的 `conversation`。

## 8. 消息优先级与并发

外部消息的“最高优先级”只作用于角色上方气泡：收到外部消息时会替换当前互动/AI 气泡，并在外部消息展示或播报完成前阻止 App 提示覆盖它。

当宠物已锁定且行为页的“锁定时显示消息”关闭时，外部消息仍会完成校验、排队、AI/TTS 处理、历史归档和事件广播，但不会创建角色上方气泡；由于没有可见消息表面，对应的气泡优先级会在完成或失败后立即释放，不阻塞后续普通提示。

气泡的阶段流转为：

- 直连消息且不播报：直接显示正文；
- 直连消息且播报：`语音合成中…` → TTS 请求完成后显示正文；
- AI问答且不播报：`思考中…` → AI 回复完成后显示正文；
- AI问答且播报：`思考中…` → AI 回复完成后切换为 `语音合成中…` → TTS 请求完成后显示正文。

`思考中…` 和 `语音合成中…` 都使用无超时的长持有气泡：对应的 AI / TTS 请求完成前不会自动消失。阶段切换是就地更新同一个气泡，只有处理完成、处理失败或被更新的最高优先级外部消息取代时才离开当前阶段。

外部消息不会取消 App 内正在进行的 Chat AI 请求，不会使 App 请求失效，也不会修改底部聊天框的显隐、折叠、输入内容、发送按钮、思考状态或历史。App 回复仍会正常写入底部聊天框；如果回复恰好在外部气泡占用期间完成，它只是不覆盖外部气泡。

App Chat 与外部 relay 即便使用同一个插件也通过独立请求通道执行，互不取消。多个外部请求仍按到达顺序串行处理，以保证稳定顺序；`queueDepth` 可通过健康检查或设置页查看。

## 9. 消息历史与上下文隔离

消息历史是外部接入审计记录，最多保存最近 200 条，和 AI 上下文不是同一个概念：

- `aiConversations` 只保存 App 内部聊天上下文，底部聊天框也只恢复这些消息；
- `aiExternalConversations` 只保存 `relay` 且 `useExternalContext: true` 的外部 AI问答上下文；
- `externalMessageHistory` 保存 direct / relay 的完整请求、完整响应、对话内容、处理状态和最终文本，供测试窗口查看；
- `思考中…` / `语音合成中…` 是短暂 UI 状态，不作为历史对话消息保存；
- direct 从不写入任何 AI 上下文；
- 清空消息历史不会清空 App 聊天，也不会清空外部 AI 上下文。

读取最近 100 条（最新在前）：

```bash
curl -X POST "http://127.0.0.1:17373/api/v1/history" \
  -H "Content-Type: application/json" \
  -d '{"limit":100}'
```

`limit` 必须是 1–200 的整数。清空消息历史：

```bash
curl -X POST "http://127.0.0.1:17373/api/v1/history/clear" \
  -H "Content-Type: application/json" \
  -d '{}'
```

当 `speak: true` 且语音合成成功时，服务会先把语音下载或写入本地 TTS 归档，再在历史响应的 `result.speech.audioUrl` 中提供只读试听地址：

```text
GET /api/v1/history/audio/{messageId}
```

音频控件通过该地址读取本地归档，支持 HTTP Range 分段播放；接口不会返回本地文件路径或 `audioBase64`。即使外部语音来自缓存，也会为当前消息创建独立归档，因此清理或淘汰缓存不会让现有历史记录立即失去试听文件。除测试页面和该只读媒体地址外，其余 HTTP 业务接口仍统一使用 POST。若历史归档已被清理，返回 `404 AUDIO_NOT_FOUND`。

外部语音缓存位于用户数据目录的 `tts/cache-v1/`。缓存文件名使用 SHA-256 内容键，元数据不保存明文消息、API Key 或本机凭据。单条音频上限 32 MiB；缓存最多保留 200 条、合计 256 MiB，超过限制时优先淘汰最久未使用项。缓存损坏或不可读时按未命中处理，不影响正常调用 TTS。

## 10. 幂等与重试

建议每次业务事件都传入稳定且唯一的 `requestId`。

- 相同 `requestId` 在 10 分钟内重复提交时，返回第一次请求的同一个处理结果；
- 重复请求不会再次显示、再次调用 AI 或再次播报；
- 最多缓存最近 200 个请求；
- 超过 10 分钟后，相同 `requestId` 可能被视为新请求；
- 调用方网络超时时，可以使用同一 `requestId` 安全重试。

## 11. 限制和错误码

| 项目 | 限制 |
|---|---:|
| HTTP 请求体 / WebSocket 消息帧 | 32 KiB |
| `content` | 2,000 字符 |
| `sender` | 60 字符 |
| `requestId` | 120 字符 |
| 并发执行 | 外部请求串行处理 |
| Chat AI 超时 | 45 秒 |
| TTS 超时 | 60 秒 |

| HTTP 状态 | `code` | 说明 |
|---:|---|---|
| 400 | `INVALID_REQUEST` | JSON 或消息字段无效 |
| 404 | `NOT_FOUND` | 接口路径不存在 |
| 405 | `METHOD_NOT_ALLOWED` | 业务接口没有使用 POST |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体或消息帧超过 32 KiB |
| 500 | `MESSAGE_FAILED` | 未分类的服务端错误 |
| 503 | `PET_UNAVAILABLE` / `PET_NOT_READY` / `MESSAGE_PROCESSING_FAILED` | 桌宠、AI 或消息处理链路暂不可用 |

## 12. JavaScript 示例

```js
const response = await fetch('http://127.0.0.1:17373/api/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'direct',
    content: '下载任务已经完成。',
    speak: true,
    sender: '下载器',
    requestId: `download-${taskId}`,
    useCurrentCharacterProfile: true,
    useExternalContext: true,
  }),
})

const result = await response.json()
if (!response.ok) throw new Error(result.error)
console.log(result)
```

WebSocket 示例：

```js
const socket = new WebSocket('ws://127.0.0.1:17373/api/v1/events')

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({
    action: 'message.post',
    payload: {
      type: 'relay',
      content: '告诉用户新的工单需要处理。',
      speak: false,
      sender: '工单系统',
      requestId: 'ticket-9912',
      useCurrentCharacterProfile: false,
      useExternalContext: true,
    },
  }))
})

socket.addEventListener('message', event => {
  const frame = JSON.parse(event.data)
  console.log(frame.action, frame)
})
```

## 13. Python 示例

```python
import requests

payload = {
    "type": "direct",
    "content": "数据同步已经完成。",
    "speak": False,
    "sender": "数据平台",
    "requestId": "sync-20260914-001",
    "useCurrentCharacterProfile": True,
    "useExternalContext": True,
}

response = requests.post(
    "http://127.0.0.1:17373/api/v1/messages",
    json=payload,
    timeout=70,
)
response.raise_for_status()
print(response.json())
```

AI问答与 TTS 的总耗时可能超过普通 HTTP 客户端的默认超时时间。调用方超时建议至少设置为 70 秒，并使用同一个 `requestId` 重试。

## 14. 安全边界

当前版本仅监听 `127.0.0.1`，因此只能由同一台电脑上的程序访问。这是有意的默认安全策略：消息接口能够驱动桌宠显示、Chat AI 和语音，不应在没有认证、TLS、访问控制和限流的情况下直接暴露到局域网或公网。

WebSocket 连接允许：

- 没有 `Origin` 请求头的本机程序；
- 测试页自身的同源地址；
- `http://localhost:17373`。

若未来需要 LAN 或公网接入，建议新增 API Token、Token 安全存储与轮换、TLS、来源白名单、限流、审计日志和可配置端口后再开放监听地址。不要通过端口转发、`0.0.0.0` 绑定或公网隧道直接暴露当前无认证接口。

## 15. Electron 测试窗口与在线测试页面

服务运行后，App 系统页提供两种打开方式：

- `APP 内部打开`（默认）：点击“打开测试页面”后创建无边框 Electron 独立窗口；页面顶部使用与 App 一致的自定义可拖动标题栏，并提供最小化和关闭按钮，不显示系统标题栏或 Electron 菜单；
- `浏览器打开`：点击“打开测试页面”后交给 Windows 当前默认浏览器。

APP 内部测试台与 App 设置页使用相同的 `floating` 窗口层级，二者都会显示在普通应用窗口上方，彼此之间仍按当前激活顺序排列；浏览器打开方式由外部浏览器自身管理窗口层级。

同一 HTML 在普通浏览器中会自动隐藏 Electron 专用的窗口控制按钮，仅保留测试台身份与服务状态，避免出现无效控件。

两种方式访问同一套本机页面：

```text
http://127.0.0.1:17373/external-message-tester.html
```

测试页支持：

- POST 健康检查；
- `direct` / `relay` 切换；
- `speak` 开关，测试台默认关闭语音播报；
- `useCurrentCharacterProfile` / `useExternalContext` 开关；
- 自定义 `sender` 和 `requestId`；
- HTTP 发送（底层统一使用 POST），支持 `Ctrl + Enter` 快速执行；
- WebSocket 发送，支持 `Alt + Enter` 快速执行；
- 实时查看 `received` / `completed` / `failed` 事件；
- 通过“消息调试 / 消息历史 / API 文档”三个页签切换工作区；
- 请求结果统一进入实时事件及消息历史，不额外占用请求表单底部空间；事件 JSON 可按需展开查看；
- 在“API 文档”中查看参数、协议、隔离规则和示例说明；
- 在“消息历史”中按“直连消息 / AI问答”分类查看，搜索、刷新和清空最多 200 条持久化记录；外部消息正文默认单行显示，溢出时可“展开/收起”，悬停可通过原生提示查看完整正文；每条记录还包含完整请求、完整响应、对话消息、语音缓存命中状态，以及已归档语音的试听控件；筛选后的结果按最新在前分页展示，默认每页 5 条，可切换为 10 或 20 条，并支持上一页、下一页和页码跳转。

开启“允许外部消息接入”后，系统托盘右键菜单会显示“外部消息调试”，可直接选择“APP 窗口”或“浏览器窗口”。服务仍在启动时入口会暂时禁用，进入运行状态后自动可用；关闭外部消息接入后，该托盘子菜单随即隐藏。

`useCurrentCharacterProfile` 与 `useExternalContext` 是 AI问答专属参数，因此测试台仅在选择“AI问答”时显示这两个开关；切回“直连消息”会收起该区域，但不会改变开关原有取值。

实时事件默认按接收时间倒序展示，最新事件位于顶部；时间戳相同时，按照测试台代码中的触发序号倒序展示，即后触发的事件排在前面。

同一次请求产生的发送、接收、完成、结果或失败事件，使用 `requestId` 归为同一消息组。测试台为每组统一显示一次“消息组 01”“消息组 02”等分组标题、事件数量和展开/收起控制，完整 `requestId` 可通过分组标题悬停查看。分组在展开和折叠状态下均保留 1px 细边框，不使用左侧粗色条；折叠标题通过协议标签、背景色和文字色区分系统事件、HTTP 与 WebSocket。消息组按组内最新事件倒序排列，组内事件继续按接收时间和触发序号倒序排列；用户折叠分组后，即使该组收到新事件也会保留折叠状态。没有 `requestId` 的连接状态和会话状态统一收纳到可折叠的“系统事件”分组。

“查看事件数据”展开后使用事件卡片的完整横向宽度，并在受控高度内提供可滚动的完整 JSON；测试台会自动调整事件面板位置，分组标题会在事件视口顶部吸附，避免展开数据时丢失当前分组信息。实时事件区和事件 JSON 使用窄幅滚动条，鼠标滚轮、触控板、拖动滚动条和键盘均可浏览全部数据。

App 内部测试窗口默认宽度为 `820`，最小宽度为 `640`；高度直接复用 App 设置窗口的自适应高度规则（上限 `760`，并根据当前屏幕工作区调整），且保持固定，因此两个窗口在同一设备上的高度一致。测试台最外层容器直接贴合 Electron 客户区四边，不保留透明留白；内部面板仍使用统一间距和外层圆角。各页签使用单一内容视口；调试页只在实时事件列表及展开的 JSON 数据确有溢出时显示窄滚动条，其他容器不重复出现滚动条。

推荐验收顺序：

1. 直接消息 + 不播报；
2. 直接消息 + 播报；
3. AI问答 + 不播报；
4. AI问答 + 播报；
5. App 内发起 AI 请求时发送外部消息，确认 App 请求继续完成、底部聊天框状态不变且 App 结果不会覆盖外部气泡；
6. 使用同一个 `requestId` 重复提交，确认不会重复显示或重复播报；
7. 关闭系统页开关，确认 HTTP 与 WebSocket 连接停止。

## 16. 故障排查

### 测试页打不开

- 确认 App 正在运行；
- 确认系统页开关已开启；
- 确认状态为“运行中”；
- 若提示端口占用，关闭占用 `17373` 的程序后重新切换开关。

### 直接消息成功，但没有语音

- 确认请求中 `speak` 是布尔值 `true`，不是字符串 `"true"`；
- 在 AI 设置页安装、配置并启用一个 TTS 插件；
- 查看响应中的 `result.speech.status` 和 `error`。

### AI问答失败

- 确认已安装、配置并启用 Chat 插件；
- 在 AI 设置页执行连接测试；
- 检查 Chat 服务商额度、模型权限和网络状态；
- 使用相同 `requestId` 重试，避免重复消息。

### WebSocket 浏览器连接被拒绝

- 使用 App 提供的测试页，或由无 `Origin` 头的本机客户端连接；
- 确认地址是 `/api/v1/events`；
- 浏览器从其他 Origin 连接会被安全策略拒绝。
