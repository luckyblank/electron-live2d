# 扩展文档：模型与 AI 插件开发指南

本文面向桌面伙伴的内容制作者和插件开发者，说明如何增加新的 Live2D 模型、模型文件应该如何组织，以及如何开发符合当前宿主规范的 AI 插件。清单驱动的透明 WebM 角色格式见 [DeepSeek 桌宠接入说明](deepseek-pet-integration.md)。

本文以仓库当前代码为准，关键实现位于：

- `main.js`：模型/插件目录扫描、优先级、导入、配置与 IPC。
- `model-inspector.js`：目录型模型和 ZIP 模型的静态检查。
- `renderer/app.js`：模型加载、动作分组识别、表情预览、交互与口型。
- `renderer/video-pet-model.js`：透明 WebM 角色的轻量渲染与语义动作适配。
- `ai/plugin-manager.js`：插件发现、配置、凭据、调用、超时和返回值处理。
- `plugins/deepseek/`、`plugins/zhipu-tts/`、`plugins/qwen-tts/`：当前可运行的参考实现。

## 1. 扩展目录概览

应用会从三个位置扫描模型和插件，并按照以下优先级处理同名 ID：

| 优先级 | 开发环境 | 安装版 | 适用场景 |
|---|---|---|---|
| 1，最高 | `%APPDATA%\Live2DCompanion\models\` / `plugins\` | 相同 | 用户自行安装、调试或覆盖内置扩展 |
| 2 | 项目根目录的 `models\` / `plugins\` | 可执行文件同级的 `models\` / `plugins\` | 便携式扩展 |
| 3，最低 | 项目根目录的 `models\` / `plugins\` | 打包进 `app.asar` 的内置内容 | 随应用发布的扩展 |

开发环境中前两处可能指向同一个项目目录，宿主会自动去重同名 ID。用户数据目录优先级最高，因此可以用同名目录覆盖内置模型或插件。

托盘菜单中的“刷新模型列表”会同时刷新模型缓存和 AI 插件注册表。新增、替换扩展后通常不需要重启应用；但如果插件改变了环境变量、依赖或主进程已缓存的模块行为，仍建议完整退出并重新启动。

---

## 2. 增加新的 Live2D 模型

### 2.1 支持范围

当前宿主支持 Cubism 3 格式资源：

- 模型描述：`*.model3.json`
- 模型二进制：`*.moc3`
- 纹理：通常为 PNG
- 可选动作：`*.motion3.json`
- 可选表情：`*.exp3.json`
- 可选物理、姿势、用户数据和显示信息文件

当前明确不支持：

- Cubism 2 的 `*.model.json` / `*.moc`。
- ZIP64 压缩包。
- 把 `*.model3.json` 直接平铺在 ZIP 根目录的压缩包。
- 只提供 `.moc3`、但没有 `.model3.json` 的资源。

静态检查只验证最关键的描述文件和 `.moc3` 是否存在。纹理、动作、表情、物理文件是否完整，以及 JSON 中的相对路径是否正确，要到实际加载时才能完全确认。

### 2.2 模型 ID 规则

每个模型都必须拥有一层“模型 ID 目录”，目录名就是应用内部使用的模型 ID，也是未设置昵称时显示的名称。

例如：

```text
%APPDATA%\Live2DCompanion\models\my-character\
```

这里的模型 ID 是 `my-character`。

建议模型 ID：

- 使用稳定、简短的 ASCII 名称，例如 `my-character` 或 `character_v2`。
- 不要依赖大小写区分两个模型。
- 发布新资源时尽量保持 ID 不变，否则缩放、昵称、档案和对话会被视为另一名角色的数据。
- 不要使用保留目录名 `_repo`，扫描器会忽略它。
- 一个模型 ID 目录只放一个模型来源，不要同时混放目录型描述文件、Cubism 2 描述文件和 ZIP。

同名模型冲突时，用户数据目录覆盖便携式目录，便携式目录覆盖内置目录。通过设置页导入 ZIP 时，如果 ID 已存在，应用会自动生成 `my-character-2`、`my-character-3` 等新 ID，不会覆盖旧模型。

### 2.3 方式一：从设置页导入 ZIP

这是普通用户最推荐的方式：

1. 打开设置窗口。
2. 进入“角色”页。
3. 点击“导入 ZIP”。
4. 选择模型压缩包。
5. 导入成功后，从角色卡片中选择新模型。

应用在复制前会检查 ZIP：

- 扩展名必须为 `.zip`。
- ZIP 中必须有 `*.model3.json`。
- ZIP 中必须有 `*.moc3`。
- `*.model3.json` 必须位于 ZIP 内的一层或多层目录中，不能直接位于 ZIP 根部。
- ZIP 必须使用普通中央目录格式，不能是 ZIP64。

导入成功后，原 ZIP 不会被解压，而是按下面的结构复制到用户数据目录：

```text
%APPDATA%\Live2DCompanion\models\my-character\
└── my-character.zip
```

### 2.4 ZIP 内部结构

推荐让 ZIP 只包含一个顶层模型目录：

```text
my-character.zip
└── my-character/
    ├── my-character.model3.json
    ├── my-character.moc3
    ├── my-character.physics3.json
    ├── my-character.pose3.json
    ├── my-character.cdi3.json
    ├── textures/
    │   ├── texture_00.png
    │   └── texture_01.png
    ├── motions/
    │   ├── idle.motion3.json
    │   ├── tap-body.motion3.json
    │   └── tap-head.motion3.json
    └── expressions/
        ├── neutral.exp3.json
        ├── happy.exp3.json
        └── sad.exp3.json
```

错误示例——模型文件直接位于 ZIP 根部，会被拒绝：

```text
my-character.zip
├── my-character.model3.json
├── my-character.moc3
└── texture_00.png
```

推荐使用 UTF-8 和简单文件名。虽然部分中文文件名能够工作，但不同压缩软件对 ZIP 文件名编码的处理不完全一致，跨机器分发时 ASCII 文件名更稳妥。

### 2.5 方式二：手动增加目录型模型

目录型模型适合开发和调试。把模型资源直接放到模型 ID 目录根部：

```text
%APPDATA%\Live2DCompanion\models\my-character\
├── my-character.model3.json
├── my-character.moc3
├── my-character.physics3.json
├── textures/
│   └── texture_00.png
├── motions/
│   └── idle.motion3.json
└── expressions/
    └── neutral.exp3.json
```

目录型模型的 `*.model3.json` 必须直接位于模型 ID 目录根部。扫描器会读取它的 `FileReferences.Moc`，并确认该相对路径指向的 `.moc3` 文件存在。

放置完成后，从托盘选择“刷新模型列表”。如果资源有效，新模型会出现在设置页；只有状态为 `ready` 的模型会出现在右键和托盘的“切换角色”菜单中。

### 2.6 方式三：增加随应用发布的内置模型

开发者可以把模型加入仓库：

```text
models/
└── my-character/
    └── my-character.zip
```

或使用目录型结构：

```text
models/
└── my-character/
    ├── my-character.model3.json
    ├── my-character.moc3
    └── ...
```

当前 electron-builder 的 `build.files` 会包含 `models/`，不需要再单独登记模型。提交前应确认模型及纹理、动作、音频等素材拥有可随应用再分发的许可证。

如果希望它成为全新用户的默认角色，请修改 `config/defaults.json`：

```json
{
  "characters": {
    "preferredModelId": "my-character"
  }
}
```

修改默认角色只影响没有有效当前角色的新配置。若还要改变已有用户的数据，需要同步更新配置迁移逻辑，并提升 `schemaVersion`；不要直接覆盖用户已经选择的角色。

### 2.7 `model3.json` 最小示例

下面是适合本项目的简化结构。真实文件中的 drawable ID、参数 ID 和资源路径应由 Cubism Editor 导出结果决定，不能直接照抄示例值：

```json
{
  "Version": 3,
  "FileReferences": {
    "Moc": "my-character.moc3",
    "Textures": [
      "textures/texture_00.png"
    ],
    "Physics": "my-character.physics3.json",
    "Motions": {
      "Idle": [
        {
          "File": "motions/idle.motion3.json",
          "FadeInTime": 0.25,
          "FadeOutTime": 0.35
        }
      ],
      "TapBody": [
        {
          "File": "motions/tap-body.motion3.json"
        }
      ],
      "TapHead": [
        {
          "File": "motions/tap-head.motion3.json"
        }
      ],
      "PetGreet": [
        {
          "File": "motions/greet.motion3.json"
        }
      ]
    },
    "Expressions": [
      {
        "Name": "neutral",
        "File": "expressions/neutral.exp3.json"
      },
      {
        "Name": "happy",
        "File": "expressions/happy.exp3.json"
      }
    ]
  },
  "Groups": [
    {
      "Target": "Parameter",
      "Name": "EyeBlink",
      "Ids": ["ParamEyeLOpen", "ParamEyeROpen"]
    },
    {
      "Target": "Parameter",
      "Name": "LipSync",
      "Ids": ["ParamMouthOpenY"]
    }
  ],
  "HitAreas": [
    {
      "Id": "HeadDrawableId",
      "Name": "Head"
    },
    {
      "Id": "BodyDrawableId",
      "Name": "Body"
    }
  ]
}
```

各部分的作用：

| 字段 | 必需性 | 用途 |
|---|---|---|
| `Version` | 必需 | 当前应为 Cubism 3 格式 |
| `FileReferences.Moc` | 必需 | 指向 `.moc3`；目录型模型会静态检查这个路径 |
| `FileReferences.Textures` | 实际必需 | 模型纹理列表；缺失时模型通常无法正确显示 |
| `FileReferences.Motions` | 推荐 | 为点击、问候、闲置和设置页预览提供动作 |
| `FileReferences.Expressions` | 可选 | 在设置页列出并预览表情 |
| `Physics` / `Pose` | 可选 | 物理和姿势数据 |
| `Groups: EyeBlink` | 推荐 | 提供自动眨眼参数 |
| `Groups: LipSync` | 推荐 | AI 语音播放时驱动嘴型 |
| `HitAreas` | 推荐 | 改善头部/身体点击判断；`Id` 必须是真实 drawable ID |

如果模型没有 `LipSync` 组，文字聊天仍然可用，但语音播放时不会得到正常口型。如果没有 `HitAreas`，宿主仍会根据指针在窗口中的相对高度做头部回退判断，但精度较低。

### 2.8 动作组命名规范

通用模型不需要修改应用代码，只要使用能够被宿主识别的 Motion Group 名称。识别不区分大小写，并按名称中是否包含关键字分类。

推荐直接使用下表中的标准名称：

| 语义 | 推荐 Motion Group | 宿主识别关键字 |
|---|---|---|
| 闲置 | `Idle` | `idle`、`wait`、`stand`、`tick` |
| 身体点击 | `TapBody` | `tap`、`touch`、`body`、`shake` |
| 摸头 | `TapHead` | `taphead`、`pethead` |
| 问候 | `PetGreet` | `greet`、`petgreet` |
| 开心 | `PetHappy` | `happy`、`smile`、`pethappy` |
| 投喂 | `PetSnack` | `snack`、`petsnack` |
| 害羞 | `PetShy` | `shy`、`petshy` |
| 好奇 | `PetCurious` | `curious`、`petcurious` |
| 困倦 | `PetSleepy` | `sleep`、`petsleepy` |

同一组可以配置多个动作，宿主会从适用组中随机选择。设置页最多展示前 24 个可预览动作和前 24 个表情。

> 重要：不要把新模型的动作全部放在空字符串 Motion Group（`""`）中。通用加载流程会过滤空名称组，避免第三方资源把大量参数片段当作完整循环动作。当前 `mori-suit` 的空组动作能够工作，是因为 `renderer/app.js` 中存在仅针对该模型 ID 的专用 `modelReactionProfiles` 映射，并不是通用行为。

对于普通模型，语义动作主要通过上表的动作组自动匹配；`Expressions` 会出现在设置页供手动预览。如果希望模型在每种 AI 情绪下自动切换特定表情，或者希望使用空组中的特定动作，需要在 `renderer/app.js` 的 `modelReactionProfiles` 中为该模型增加显式映射，并为相关行为补充回归验证。

### 2.9 模型验证与排错

可以直接调用仓库中的检查器：

```powershell
# 检查目录型模型
node -e "const m=require('./model-inspector'); console.log(m.inspectModelDirectory(process.argv[1]))" "C:\path\to\my-character"

# 检查 ZIP 模型
node -e "const m=require('./model-inspector'); console.log(m.inspectModelArchive(process.argv[1]))" "C:\path\to\my-character.zip"
```

成功结果中的 `status` 应为 `ready`。常见错误如下：

| 现象或提示 | 原因 | 处理方式 |
|---|---|---|
| 找不到模型 | 模型 ID 目录层级不正确 | 确认结构为 `models\<model-id>\...` |
| 缺少 `.moc3` | ZIP 中没有 `.moc3`，或目录型 `FileReferences.Moc` 路径错误 | 补齐文件并修正相对路径 |
| ZIP 内模型需要放在一级子目录 | `.model3.json` 位于 ZIP 根部 | 新建顶层目录后重新打包 |
| Cubism 2 暂不支持 | 使用了 `.model.json` 或 `.moc` | 从 Cubism Editor 导出 Cubism 3 格式 |
| 模型显示但没有动作 | Motion Group 为空或命名未被识别 | 使用上一节推荐的命名 |
| 语音播放但嘴不动 | 缺少 `LipSync` 参数组 | 在 `Groups` 中登记正确的嘴部参数 |
| 头部点击识别不准 | 缺少名为 `Head` 的 Hit Area | 在 Cubism 工程与导出描述中增加头部命中区域 |
| 设置页没有表情 | `Expressions` 未登记或路径失效 | 在 `FileReferences.Expressions` 中登记 `.exp3.json` |
| 同名模型不是预期版本 | 更高优先级目录存在相同 ID | 检查用户数据、安装目录和内置目录 |

新增或修改模型后建议执行：

```bash
npm run check
npm run qa:directory
```

并手动确认：首次加载、切换、封面生成、缩放保存、拖动、点击、动作/表情预览、隐藏后恢复、AI 语音口型和重启后的状态恢复。

---

## 3. 增加新的 AI 插件

### 3.1 当前插件能力模型

当前插件系统支持两种 capability：

- `chat`：文字对话。
- `tts`：文本转语音。

一个插件可以声明其中一种或同时声明两种。每种 capability 同时只能有一个活动插件，文字模型和语音模型可以来自不同插件。

插件生命周期分为四步：

1. **发现**：目录和 `manifest.json` 通过扫描规则。
2. **安装**：用户在设置页点击安装；这里只是把插件 ID 标记为可使用，不会执行 npm 安装。
3. **配置**：保存 API Key、模型及该 capability 的相关参数。
4. **启用**：成为 `chat` 或 `tts` 的当前活动插件。

保存插件配置时，宿主会自动把该插件声明的 capability 设为活动状态。停用插件不会删除配置或凭据。

### 3.2 安全边界

> 插件入口由主进程通过 CommonJS `require()` 直接加载，拥有与 Electron 主进程相同的 Node.js、文件系统和网络权限。插件不是沙箱，也没有权限声明或进程隔离。只安装、打包和运行完全可信的插件代码。

插件不得：

- 记录、回显或上传到非目标服务的 API Key。
- 未经用户知情读写与功能无关的本地文件。
- 修改全局对象、Electron 生命周期或宿主状态。
- 捕获 `AbortError` 后继续执行已经取消的网络请求。
- 在模块加载阶段发起网络请求或执行耗时任务。
- 假设入口会在 renderer 中运行；当前入口只运行在主进程。

### 3.3 插件目录结构

最小插件由一个清单和一个 CommonJS 入口组成：

```text
my-provider/
├── manifest.json
└── index.js
```

目录名规则：

- 只能包含英文字母、数字和连字符，正则为 `^[a-z0-9-]+$`，不区分大小写检查。
- `manifest.json` 的 `id` 必须与目录名完全一致。
- 建议统一使用小写 kebab-case，例如 `my-provider-chat`。
- 入口文件必须位于插件目录内部，不能通过 `../` 指向外部文件。

普通用户或本地调试请放到：

```text
%APPDATA%\Live2DCompanion\plugins\my-provider\
```

随应用发布的内置插件请放到：

```text
plugins/my-provider/
```

放置完成后，使用托盘的“刷新模型列表”刷新插件注册表，再到设置的“AI”页完成安装、配置、连接测试和启用。

### 3.4 `manifest.json` 规范

文字插件示例：

```json
{
  "id": "my-provider-chat",
  "name": "My Provider Chat",
  "shortName": "MY",
  "version": "1.0.0",
  "description": "使用 My Provider API 进行文字对话。",
  "main": "index.js",
  "homepage": "https://example.com/docs",
  "apiKeyEnv": "MY_PROVIDER_API_KEY",
  "credentialId": "my-provider",
  "capabilities": ["chat"],
  "models": ["my-chat-model", "my-chat-model-pro"],
  "defaultModel": "my-chat-model"
}
```

语音插件示例：

```json
{
  "id": "my-provider-tts",
  "name": "My Provider TTS",
  "shortName": "TTS",
  "version": "1.0.0",
  "description": "将角色回复合成为语音。",
  "main": "index.js",
  "homepage": "https://example.com/docs/tts",
  "apiKeyEnv": "MY_PROVIDER_API_KEY",
  "credentialId": "my-provider",
  "capabilities": ["tts"],
  "models": ["my-tts-model"],
  "defaultModel": "my-tts-model",
  "ttsTuning": true,
  "voices": [
    { "id": "voice-a", "name": "音色 A" },
    { "id": "voice-b", "name": "音色 B" }
  ],
  "defaultVoice": "voice-a"
}
```

字段说明：

| 字段 | 必需 | 约束与行为 |
|---|---|---|
| `id` | 是 | 必须与目录名完全一致 |
| `name` | 是 | 必须是字符串，UI 最多使用前 60 个字符 |
| `capabilities` | 是 | 数组；有效值只有 `chat`、`tts`，过滤后不能为空 |
| `models` | 是 | 非空字符串数组，每项最长 80 个字符 |
| `main` | 否 | 默认 `index.js`；必须解析到插件目录内部且文件存在 |
| `shortName` | 否 | 插件卡片缩写，最多显示前 4 个字符 |
| `version` | 否 | 默认 `1.0.0`，最多使用前 20 个字符 |
| `description` | 否 | 插件未安装时的介绍，最多使用前 240 个字符 |
| `homepage` | 否 | 只接受以 `https://` 开头的地址 |
| `apiKeyEnv` | 否 | 必须匹配 `^[A-Z][A-Z0-9_]*$`；未配置时只能在 UI 中保存本地 Key |
| `credentialId` | 否 | 只允许字母、数字和连字符；默认等于 `id` |
| `defaultModel` | 否 | 必须存在于 `models` 中，否则回退到第一个模型 |
| `ttsTuning` | 否 | TTS 是否支持语速与音量调节，默认 `true`；设为 `false` 时设置页隐藏无效的调节项 |
| `voices` | TTS 推荐 | 可写字符串，或 `{ "id", "name", "previewUrl" }`；ID 最长 80 个字符 |
| `defaultVoice` | 否 | 必须存在于 `voices` 中，否则回退到第一个音色 |

`credentialId` 用于让同一服务商的多个插件共享一份加密凭据。例如文字插件和语音插件可以分别使用 `my-provider-chat`、`my-provider-tts` 作为插件 ID，同时都设置 `"credentialId": "my-provider"`。在其中一个插件中切换或替换本地 Key，会影响所有使用同一 credential ID 的插件。

当前音色试听 URL 有严格的宿主白名单，只接受智谱官方音频地址，以及 `https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/.../*.wav` 形式的阿里云官方文档音频。其他服务商的插件应暂时省略 `previewUrl`；若要支持新的试听域名，需要先在 `ai/plugin-manager.js` 中扩展并审查允许规则，不能依赖任意远程 URL。

### 3.5 文字对话适配器接口

声明 `"capabilities": ["chat"]` 的插件必须导出异步 `chat` 函数：

```js
async function chat({ apiKey, model, messages, maxTokens, signal }) {
  // 调用服务商 API
}

module.exports = { chat }
```

输入参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `apiKey` | `string` | 宿主从环境变量或 `safeStorage` 解密得到的完整 Key |
| `model` | `string` | 用户当前选择的模型，始终来自清单的 `models` |
| `messages` | `Array<{role, content}>` | 已组装的系统提示、角色设定、历史和当前用户消息 |
| `maxTokens` | `number` | 宿主根据回复字符限制估算出的 token 上限 |
| `signal` | `AbortSignal` | 超时、应用退出或新的同插件请求发起时用于取消请求 |

返回值：

```js
const chatResult = {
  text: '非空的回复正文',
  model: '服务商实际返回的模型名', // 可选，建议提供
  usage: {}                      // 可选，透传服务商用量信息
}
```

完整骨架：

```js
const API_URL = 'https://api.example.com/v1/chat/completions'

function apiError(status, detail) {
  if (status === 401) return new Error('API Key 无效，请检查后重新保存')
  if (status === 402) return new Error('账户余额不足')
  if (status === 429) return new Error('请求过于频繁，请稍后再试')
  if (status >= 500) return new Error('服务暂时不可用')
  return new Error(detail || `请求失败（HTTP ${status}）`)
}

async function chat({ apiKey, model, messages, maxTokens, signal }) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      stream: false,
    }),
    signal,
  })

  let payload
  try {
    payload = await response.json()
  } catch (error) {
    if (!response.ok) throw apiError(response.status)
    throw new Error('服务返回了无法解析的数据')
  }

  if (!response.ok) {
    throw apiError(response.status, payload && payload.error && payload.error.message)
  }

  const text = payload && payload.choices && payload.choices[0]
    && payload.choices[0].message && payload.choices[0].message.content
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('服务没有返回有效回复')
  }

  return {
    text: text.trim(),
    model: typeof payload.model === 'string' ? payload.model : model,
    usage: payload.usage || null,
  }
}

module.exports = { chat }
```

宿主会要求模型在回复开头生成情绪标签，并在收到结果后剥离受支持的标签。适配器不需要自行处理角色档案、历史、情绪或正文截断，只需把 `messages` 原样转换为服务商协议并返回文本。

当前文字请求超时为 45 秒。同一个插件 ID 发起新请求时，宿主会取消该插件的前一个请求，因此必须把 `signal` 传给 `fetch` 或底层 SDK，并让取消异常正常向上抛出。

### 3.6 TTS 适配器接口

声明 `"capabilities": ["tts"]` 的插件必须导出异步 `synthesize` 函数：

```js
async function synthesize({ apiKey, model, input, voice, speed, volume, signal }) {
  // 调用服务商 API
}

module.exports = { synthesize }
```

输入参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `apiKey` | `string` | 完整 API Key |
| `model` | `string` | 用户选择的 TTS 模型 |
| `input` | `string` | 要合成的纯文本，宿主最多传入 1024 个字符 |
| `voice` | `string` | 用户选择的音色 ID |
| `speed` | `number` | 语速，宿主限制在 0.5～2 |
| `volume` | `number` | 音量，宿主限制在 0.1～10 |
| `signal` | `AbortSignal` | 取消与超时信号 |

返回值：

```js
const speechResult = {
  audio: Buffer.from(arrayBuffer),
  format: 'wav',
  mimeType: 'audio/wav',
  model,
  voice
}
```

当前宿主只接受 `Buffer` 音频，归档格式只正式支持 `wav` 和 `pcm`；其他 `format` 会按 `wav` 处理。单次音频不得超过 32 MiB。为了让 `live2d-renderer` 能够解码并驱动口型，推荐返回标准 WAV，而不是提供远程 URL或流式响应。

完整骨架：

```js
const API_URL = 'https://api.example.com/v1/audio/speech'

async function synthesize({ apiKey, model, input, voice, speed, volume, signal }) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
      voice,
      speed,
      volume,
      response_format: 'wav',
      stream: false,
    }),
    signal,
  })

  if (!response.ok) {
    let detail = ''
    try {
      const payload = await response.json()
      detail = payload && (payload.message || (payload.error && payload.error.message))
    } catch (error) {
      detail = ''
    }
    throw new Error(detail || `语音请求失败（HTTP ${response.status}）`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    throw new Error('语音服务返回了非音频数据')
  }

  const audio = Buffer.from(await response.arrayBuffer())
  if (!audio.length) throw new Error('语音服务没有返回音频')

  return {
    audio,
    format: 'wav',
    mimeType: 'audio/wav',
    model,
    voice,
  }
}

module.exports = { synthesize }
```

当前 TTS 请求超时为 60 秒。设置页执行连接测试时会合成固定测试句，并像正常回复一样把生成结果写入 TTS 归档目录。

### 3.7 同时支持 Chat 与 TTS

一个入口可以同时导出两种能力：

```json
{
  "id": "my-provider",
  "name": "My Provider",
  "capabilities": ["chat", "tts"],
  "models": ["my-model"],
  "voices": ["voice-a"]
}
```

```js
async function chat(args) {
  // ...
}

async function synthesize(args) {
  // ...
}

module.exports = { chat, synthesize }
```

只要清单声明了某种 capability，入口就必须导出对应函数，否则整个插件在首次加载时会报错。

需要注意：取消控制器按插件 ID 管理。如果同一个插件 ID 同时处理 Chat 和 TTS，新请求会取消该插件尚未结束的前一个请求。当前聊天流程会等待 Chat 完成后才开始 TTS，因此内置交互不会冲突；如果未来需要并行调用，建议使用两个插件 ID，或先调整宿主的请求隔离键。

### 3.8 凭据规范

当前插件管理器假定插件调用需要 API Key。凭据来源有两种：

1. 清单 `apiKeyEnv` 指定的环境变量。
2. 设置页输入并由 Electron `safeStorage` 加密保存的本地 Key。

默认情况下，有环境变量时优先使用环境变量；用户保存新的本地 Key 后会明确切换到本地凭据。如果环境变量仍可用，设置页允许切回环境变量，切回时会清除对应 credential ID 的本地 Key。

开发规范：

- 环境变量名使用服务商前缀，例如 `MY_PROVIDER_API_KEY`。
- 入口只通过函数参数接收 Key，不要自行读取 `config.json`。
- 不要把 Key 拼进 URL、错误消息、日志或返回对象。
- 不要缓存 Key 到模块级变量或写入其他文件。
- 共享凭据时谨慎选择 `credentialId`，避免与无关插件冲突。
- 如果服务完全不需要鉴权，当前宿主还没有正式的“无凭据插件”声明；应先扩展插件管理器，而不是要求用户填写伪造 Key。

### 3.9 错误处理与请求规范

适配器抛出的 `Error.message` 会直接成为设置页或聊天界面的用户提示，因此错误应简短、可操作、不要包含敏感响应内容。

建议至少区分：

- `401`：Key 无效或过期。
- `402`：余额或配额不足。
- `429`：请求频率受限。
- `5xx`：服务暂时不可用。
- 响应无法解析。
- 成功响应缺少文本或音频。
- 网络中断和取消。

请求规范：

- 必须传递宿主的 `AbortSignal`。
- 必须检查 HTTP 状态码，不能把错误 JSON 当成正常结果。
- 不要在插件内无限重试；宿主已经有超时和新请求取消机制。
- 当前宿主不支持流式 Chat 或流式 TTS，插件应等待完整结果后一次返回。
- 不要修改传入的 `messages`。
- 不要把服务商的原始大型响应整体返回给宿主。

### 3.10 依赖管理

宿主没有“安装插件依赖”的流程，设置页中的“安装”只改变插件状态。

推荐策略：

- 优先使用 Electron/Node 已提供的 `fetch`、`Buffer` 和标准库，保持插件零依赖。
- 内置插件需要第三方包时，把依赖加入项目根 `package.json`，并确认 electron-builder 会打包它。
- 用户插件如果携带自己的 `node_modules`，Node 可能可以从插件目录解析依赖，但体积、原生模块 ABI、打包方式和供应链安全都由插件作者负责。
- 避免依赖需要浏览器 DOM 或 renderer 环境的 SDK。
- 原生 Node 模块必须与当前 Electron ABI 匹配，否则会在 `require()` 时失败。

### 3.11 将插件作为内置默认能力发布

仅把目录放进仓库 `plugins/`，会让插件被发现并展示在设置页，但不一定让它对所有用户自动安装或启用。

如果希望全新用户默认安装插件，请修改 `config/defaults.json`：

```json
{
  "ai": {
    "installedPluginIds": ["deepseek", "zhipu-tts", "my-provider-chat"],
    "activePluginIds": {
      "chat": "my-provider-chat",
      "tts": "zhipu-tts"
    },
    "pluginDefaults": {
      "my-provider-chat": {
        "model": "my-chat-model"
      }
    }
  }
}
```

注意事项：

- `activePluginIds.chat` 和 `activePluginIds.tts` 必须分别指向支持对应 capability 的插件。
- `pluginDefaults.<id>.model` 必须存在于该插件清单的 `models` 中。
- TTS 插件还可以在 `pluginDefaults.<id>.voice` 中指定默认音色。
- 若要让已有用户也自动获得新内置插件，需要提升 `schemaVersion`，并在 `main.js` 的 `migrateStore()` 中增加非破坏性迁移。
- 迁移必须保留用户已有的插件设置、Key 和主动停用选择，不能简单覆盖整个 `aiPlugins`。
- 在 `package.json` 的 `npm run check` 中加入新入口文件的 `node --check`，否则当前硬编码的检查列表不会自动覆盖新插件。

### 3.12 插件测试清单

新增插件至少应完成以下验证：

- [ ] 插件目录名只包含字母、数字和连字符。
- [ ] `manifest.json` 是合法 JSON，`id` 与目录名完全一致。
- [ ] `capabilities` 和 `models` 非空，默认模型/音色在各自列表中。
- [ ] 入口文件位于插件目录内并使用 CommonJS `module.exports`。
- [ ] Chat 返回非空 `text`；TTS 返回非空且不超过 32 MiB 的 `Buffer`。
- [ ] `AbortSignal` 被传给网络请求。
- [ ] 本地 Key 和环境变量两种凭据来源都能工作。
- [ ] Key 不出现在控制台、错误信息、URL和返回值中。
- [ ] 401、402、429、5xx、无效 JSON、空结果和网络失败都有可理解提示。
- [ ] 设置页可以发现、安装、配置、测试、启用和停用插件。
- [ ] 连续快速请求时，前一个请求能够被取消，不产生未处理的 Promise rejection。
- [ ] Chat 历史、角色档案和回复限制能够被正常透传。
- [ ] TTS 的音色生效；声明支持调节时语速、音量也生效；生成文件可以归档、播放并驱动口型。
- [ ] 应用重启后插件配置、活动状态和凭据来源正确恢复。
- [ ] 运行 `npm run check` 与 `npm run lint`。

## 4. 推荐提交内容

增加模型时，建议一个提交至少包含：

- `models/<model-id>/` 下的完整模型资源。
- 模型版权与再分发许可说明。
- 如需专用交互映射，对 `renderer/app.js` 的小范围修改。
- 对默认角色、角色档案或迁移的必要配置修改。
- 加载、动作、表情、口型和切换验证结果。

增加插件时，建议一个提交至少包含：

- `plugins/<plugin-id>/manifest.json`。
- `plugins/<plugin-id>/index.js`。
- 根 `package.json` 中必要的依赖和语法检查命令更新。
- 如需默认安装，对 `config/defaults.json` 和迁移逻辑的修改。
- 不含真实 Key、账户信息或测试生成音频的验证记录。

## 5. 兼容性变更原则

模型 ID、插件 ID、credential ID、默认配置字段和用户数据结构都属于持久化兼容边界。发布扩展时遵循以下原则：

- ID 一旦发布尽量不要改名。
- 新增字段应提供安全默认值。
- 删除或更名字段时先写迁移，再提升 schema 版本。
- 不覆盖用户昵称、档案、模型顺序、缩放、插件选择或凭据来源。
- 用户目录同名覆盖是现有能力，内置扩展不能假设自己一定是最终被加载的版本。
- 插件清单和入口接口发生不兼容变化时，应提升插件版本，并同步更新宿主校验与本文档。
