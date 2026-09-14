# AI 插件与模型契约

仅在任务需要具体清单字段、适配器签名、凭据行为、提示词或音频归档细节时读取。以当前 `ai/plugin-manager.js` 为最终事实来源。

## 1. 发现顺序与信任边界

插件根目录与模型目录采用相同的覆盖策略：

1. 用户目录 `%APPDATA%/Live2DCompanion/plugins/` 优先；
2. 安装目录或项目目录的外置 `plugins/` 次之；
3. `app.asar` 中的内置 `plugins/` 最低。

每个插件目录必须包含 `manifest.json` 和入口文件。目录名需匹配 `^[a-z0-9-]+$`，`manifest.id` 必须与目录名完全一致。入口路径经过解析后必须仍位于插件目录内。

入口通过 Electron 主进程的 CommonJS `require()` 直接加载，拥有 Node 文件系统和网络权限，没有沙箱或细粒度权限声明：

- 模块加载阶段不要请求网络、读取无关文件或做耗时工作；
- 不要修改全局对象、Electron 生命周期或宿主状态；
- 只接受可信插件代码；
- 插件刷新会清理宿主的适配器映射，但依赖或模块缓存相关改动仍应通过完整重启验证。

## 2. `manifest.json`

Chat 示例：

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

TTS 示例：

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
  "ttsCacheKeyFields": ["model", "voice", "speed", "volume"],
  "voices": [
    { "id": "voice-a", "name": "音色 A" },
    { "id": "voice-b", "name": "音色 B" }
  ],
  "defaultVoice": "voice-a"
}
```

Fields:

| Field | Required | Runtime constraint |
|---|---|---|
| `id` | yes | Must exactly equal the directory name |
| `name` | yes | String; UI keeps at most 60 characters |
| `capabilities` | yes | Recognized values are only `chat` and `tts`; filtered list must remain non-empty |
| `models` | yes | Non-empty strings, each at most 80 characters |
| `main` | no | Defaults to `index.js` and must resolve inside the plugin directory |
| `shortName` | no | UI keeps at most 4 characters |
| `version` | no | Defaults to `1.0.0`; at most 20 characters |
| `description` | no | UI keeps at most 240 characters |
| `homepage` | no | Only `https://` values survive normalization |
| `apiKeyEnv` | no | Must match `^[A-Z][A-Z0-9_]*$` |
| `credentialId` | no | Letters, digits, hyphens; defaults to `id` |
| `defaultModel` | no | Must be in `models`, otherwise first model is used |
| `ttsTuning` | no | Defaults to true; false hides unsupported tuning controls |
| `ttsCacheKeyFields` | TTS recommended | Output-affecting config field names used with text and plugin identity for external speech caching; defaults to `model`, `voice`, `speed`, `volume` |
| `voices` | TTS recommended | Strings or objects with `id`, `name`, optional allowed `previewUrl`; IDs at most 80 characters |
| `defaultVoice` | no | Must match a normalized voice, otherwise first voice is used |

The repository's `config/defaults.json` can override the manifest's model or voice default for new users through `ai.pluginDefaults[pluginId]`.

## 3. Chat adapter

Export:

```js
async function chat({ apiKey, model, messages, maxTokens, signal }) {
  // Translate the host contract to the provider request.
}

module.exports = { chat }
```

Inputs:

| Input | Contract |
|---|---|
| `apiKey` | Full credential from environment or decrypted local storage |
| `model` | Selected value from normalized manifest `models` |
| `messages` | Ordered array of `{ role, content }` already containing profile, identity, emotion instruction, limit, history, and user message |
| `maxTokens` | Host estimate from the character limit, 64–2,048 |
| `signal` | AbortSignal for timeout, replacement request, deactivation, or disposal |

Return:

```js
{
  text: "non-empty provider reply",
  model: "actual-provider-model", // recommended
  usage: {}                       // optional, small normalized provider data
}
```

Reference skeleton:

```js
const API_URL = "https://api.example.com/v1/chat/completions"

function responseError(status, detail) {
  if (status === 401) return new Error("API Key 无效，请检查后重新保存")
  if (status === 402) return new Error("账户余额或额度不足")
  if (status === 403) return new Error("当前账户没有所选模型的权限")
  if (status === 404) return new Error("找不到所选模型")
  if (status === 429) return new Error("请求过于频繁，请稍后再试")
  if (status >= 500) return new Error("服务暂时不可用")
  return new Error(detail || `请求失败（HTTP ${status}）`)
}

async function chat({ apiKey, model, messages, maxTokens, signal }) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
    if (!response.ok) throw responseError(response.status)
    throw new Error("服务返回了无法解析的数据")
  }
  if (!response.ok) {
    throw responseError(response.status, payload?.error?.message)
  }

  const text = payload?.choices?.[0]?.message?.content
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("服务没有返回有效回复")
  }
  return {
    text: text.trim(),
    model: typeof payload.model === "string" ? payload.model : model,
    usage: payload.usage || null,
  }
}

module.exports = { chat }
```

Adapt field names and response parsing to current official provider documentation. Do not copy provider-specific options such as thinking mode, temperature, or token fields to another provider without confirming support.

## 4. Host-built chat context

The public `chat()` manager path:

1. selects the requested or active `chat` plugin;
2. clamps user input to 2,000 characters;
3. loads per-pet history using `modelId`;
4. builds ordered system messages:
   - current character profile, up to 4,000 characters;
   - current nickname identity;
   - requirement to prefix one allowed Chinese emotion tag;
   - configured response-character limit;
5. appends up to the configured history limit;
6. appends a final identity correction after history to override stale nicknames;
7. appends the current user message;
8. calls the adapter;
9. strips a recognized leading emotion tag;
10. truncates displayed text, persists the clean user/assistant exchange, and returns the stable emotion key.

The host can pass `source`, `sourceLabel`, `sender`, and `requestId`. An external relay may also pass `useCurrentCharacterProfile` and `useExternalContext`, both defaulting to `true`. APP turns persist only in `aiConversations`; external relay turns persist only in `aiExternalConversations`. The provider-facing `messages` array contains only `role` and `content`. External direct messages do not enter AI history, and the APP conversation API never returns external turns.

Chat/TTS progress bubbles are transient renderer state, not conversation content. A held `thinking` bubble remains until the Chat promise settles. If speech is requested, the same lease then changes to a held `speech` bubble and remains until the TTS promise settles; only then may final text be shown. A direct external message skips `thinking`: it either displays immediately without speech or starts at `speech` and reveals its text only after TTS settles. Never persist the progress labels in `aiConversations`, `aiExternalConversations`, or an external history item's `conversation`.

Allowed requested tags are `开心`, `难过`, `生气`, `惊讶`, `害羞`, `疑惑`, and `平静`. Aliases are accepted by the parser, but the prompt asks for the canonical seven.

Do not parse or remove the tag in the adapter. The same provider result must remain compatible with the host's display, TTS, history, and renderer emotion mapping.

## 5. TTS adapter

Export:

```js
async function synthesize({ apiKey, model, input, voice, speed, volume, signal }) {
  // Return a complete bounded audio Buffer.
}

module.exports = { synthesize }
```

Inputs:

| Input | Contract |
|---|---|
| `apiKey` | Full credential |
| `model` | Selected manifest model |
| `input` | Clean text, at most 1,024 characters |
| `voice` | Selected normalized voice ID |
| `speed` | 0.5–2 |
| `volume` | 0.1–10 |
| `signal` | AbortSignal |

Return:

```js
{
  audio: Buffer.from(arrayBuffer),
  format: "wav",
  mimeType: "audio/wav",
  model,
  voice
}
```

Direct-audio skeleton:

```js
async function synthesize({ apiKey, model, input, voice, speed, volume, signal }) {
  const response = await fetch("https://api.example.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
      voice,
      speed,
      volume,
      response_format: "wav",
      stream: false,
    }),
    signal,
  })
  if (!response.ok) throw new Error(`语音请求失败（HTTP ${response.status}）`)

  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    throw new Error("语音服务返回了非音频数据")
  }
  const audio = Buffer.from(await response.arrayBuffer())
  if (!audio.length) throw new Error("语音服务没有返回音频")
  return { audio, format: "wav", mimeType: "audio/wav", model, voice }
}

module.exports = { synthesize }
```

If the provider returns base64, validate alphabet and expected decoded size before allocating a large buffer. If it returns a URL:

- parse with `new URL()`;
- require the intended protocol, normally HTTPS;
- match an exact official result-host pattern rather than accepting arbitrary hosts;
- decide an explicit redirect policy;
- inspect `content-length` before download and enforce a post-download 32 MiB cap;
- check the content type;
- validate container magic, such as RIFF/WAVE for WAV;
- reject a missing base64 value and URL rather than guessing.

The host archives audio with a sanitized model/voice label and random suffix under `tts/YYYY-MM/`. A connection test for a TTS-only plugin also creates an archive file.

For external messages only, the host first checks the persistent cache under `tts/cache-v1/`. The cache descriptor contains the normalized input, plugin ID/version, and each field declared by `ttsCacheKeyFields`; its SHA-256 digest becomes the filename, so metadata does not retain plaintext input or credentials. Qwen-TTS declares `model` and `voice`. Zhipu TTS declares `model`, `voice`, `speed`, and `volume`. A new provider must declare every host config value that can change its audio output. If the field list is omitted or normalizes empty, the host conservatively uses all four common fields.

A cache hit bypasses the adapter but still writes a unique monthly archive for that external history item. APP-originated TTS, connection tests, failed/empty/oversized results, and provider errors are never cached. Cache read/write failures degrade to a miss. The cache keeps at most 200 entries and 256 MiB, with a 32 MiB per-audio cap and least-recently-used pruning based on access time.

## 6. Credentials and shared services

State is stored below `aiPlugins`:

- `installed` plugin IDs;
- `activeIds.chat` and `activeIds.tts`;
- per-plugin `settings`;
- encrypted `secrets` keyed by credential ID;
- `credentialPreferences` keyed by credential ID.

Related plugins can share a key:

```json
{
  "id": "my-provider-chat",
  "credentialId": "my-provider"
}
```

```json
{
  "id": "my-provider-tts",
  "credentialId": "my-provider"
}
```

Changing or removing the local credential affects every plugin sharing that credential ID. Use a shared ID only for the same service/account credential semantics.

## 7. Cancellation model

`activeRequests` is keyed by plugin ID, capability, and request lane (`app` or `external`). Consequences:

- a replacement request aborts only the previous request in the same plugin/capability/lane slot;
- APP Chat and external relay can run concurrently through the same plugin without cancelling one another;
- Chat and TTS no longer share a cancellation slot;
- deactivating a capability or disposing the manager can still abort every matching lane;
- external-system priority is implemented by renderer bubble leasing, not by aborting APP work. It must not change APP chat-panel state or history.

Adapters must still honor the supplied AbortSignal. Do not add provider-global mutable request state that defeats host lane isolation.

## 8. Defaults and compatibility

New-user example:

```json
{
  "ai": {
    "installedPluginIds": ["my-provider-chat", "my-provider-tts"],
    "activePluginIds": {
      "chat": "my-provider-chat",
      "tts": "my-provider-tts"
    },
    "pluginDefaults": {
      "my-provider-chat": {
        "model": "my-chat-model"
      },
      "my-provider-tts": {
        "model": "my-tts-model",
        "voice": "voice-a"
      }
    }
  }
}
```

Keep discovery, new-user installation, activation, and existing-user migration as separate product decisions. Do not overwrite `aiPlugins` wholesale during migration.

## 9. Dependency policy

Prefer Node/Electron-provided `fetch`, `Buffer`, URL handling, and standard modules. The application has no per-plugin dependency installer.

For a new built-in dependency:

- add it to the root `package.json`;
- confirm Electron compatibility and packaging;
- avoid DOM-only SDKs because the adapter runs in the main process;
- rebuild native modules for the current Electron ABI if unavoidable;
- review license and supply-chain implications;
- keep secrets out of SDK debug logs.
