# 宠物模型契约

仅在任务需要具体模型格式、运行时接口、动作/表情映射或持久化兼容性时读取本文件。代码仍是最终事实来源。

## 1. 模型发现与优先级

`main.js` 构造多个模型根目录，并按低到高来源扫描后用 ID 去重。最终效果是：

1. 用户目录 `%APPDATA%/Live2DCompanion/models/` 优先；
2. 安装目录或开发项目目录中的外置 `models/` 次之；
3. 打包在 `app.asar` 内的 `models/` 最低。

每个根目录的直接子目录就是模型 ID。不要在模型目录外保存其运行所需的相对资源，也不要依赖某个更低优先级副本一定会被加载。

扫描结果至少包含：

| 字段 | 含义 |
|---|---|
| `id` | 模型目录名和持久化身份 |
| `name` | 展示名；视频模型可从 `pet.json.name` 提供 |
| `path` | 可交给 renderer 的文件 URL |
| `format` | `zip`、`folder` 或 `video-pet` |
| `modelType` | 视频模型为 `video`；Live2D 通常不需要额外类型 |
| `cubismVersion` | Live2D 为 3；视频模型为 `null` |
| `status` | `ready`、`invalid` 或 `unsupported` |
| `statusMessage` | 可直接向用户解释的检查结果 |

## 2. Cubism 3 Live2D

### 2.1 目录型模型

结构：

```text
models/
└── my-character/
    ├── my-character.model3.json
    ├── my-character.moc3
    ├── my-character.physics3.json
    ├── textures/
    ├── motions/
    └── expressions/
```

`.model3.json` 必须位于模型 ID 目录根部。静态检查读取 `FileReferences.Moc` 并确认解析后的文件存在。纹理、物理、动作和表情的完整性主要在实际加载阶段暴露，因此仍需 renderer 冒烟测试。

### 2.2 ZIP 模型

推荐结构：

```text
my-character.zip
└── my-character/
    ├── my-character.model3.json
    ├── my-character.moc3
    ├── textures/
    ├── motions/
    └── expressions/
```

约束：

- ZIP 中至少有一个 `.model3.json` 和一个 `.moc3`。
- 描述文件不能平铺在 ZIP 根；`live2d-renderer 0.6.x` 会剥离第一层路径。
- ZIP64 会被静态检查拒绝。
- 普通导入只复制 ZIP，不解压。
- Cubism 2 `.model.json` / `.moc` 返回 `unsupported`。

### 2.3 建议的描述内容

`FileReferences` 通常应包含：

- `Moc`：必需；
- `Textures`：实际渲染必需；
- `Motions`：交互与待机推荐；
- `Expressions`：独立表情可选；
- `Physics`、`Pose`、`UserData`、`DisplayInfo`：按模型能力选择。

`Groups` 建议声明：

- `EyeBlink`，参数通常包含 `ParamEyeLOpen`、`ParamEyeROpen`；
- `LipSync`，参数通常包含 `ParamMouthOpenY`。

`HitAreas` 建议至少声明名称包含 `Head` 和 `Body` 的真实 drawable。没有头部命中区时，宿主使用窗口相对高度估计头部。

### 2.4 动作组自动分类

通用加载按不区分大小写的名称关键字归类：

| 语义 | 推荐组名 | 常见识别词 |
|---|---|---|
| 待机 | `Idle` | `idle`、`wait`、`stand`、`tick` |
| 身体点击 | `TapBody` | `tap`、`touch`、`body`、`shake` |
| 头部点击 | `TapHead` | `taphead`、`pethead` |
| 问候 | `PetGreet` | `greet`、`petgreet` |
| 开心 | `PetHappy` | `happy`、`smile`、`pethappy` |
| 投喂 | `PetSnack` | `snack`、`petsnack` |
| 害羞 | `PetShy` | `shy`、`petshy` |
| 好奇 | `PetCurious` | `curious`、`petcurious` |
| 困倦 | `PetSleepy` | `sleep`、`petsleepy` |

检查 `renderer/app.js` 中当前分类函数后再依赖非标准名字。空名称动作组会在通用路径中过滤。

## 3. 显式 Live2D 反应档案

`config/model-reactions.js` 的 `MODEL_REACTION_PROFILES` 用于内置模型的经审核映射。典型结构：

```js
{
  "my-character": {
    neutralExpression: "neutral",
    actions: {
      idle: [{ clip: "idle" }],
      tap: [{ clip: "tap" }],
      greet: [{ clip: "wave" }],
      head: [{ clip: "head-pat" }],
      happy: [{ clip: "happy-a" }, { clip: "happy-b" }],
      snack: [{ clip: "eat" }],
      shy: [{ clip: "shy" }],
      curious: [{ clip: "look-around" }],
      sleepy: [{ clip: "sleep" }],
      sad: [{ clip: "sad" }],
      angry: [{ clip: "angry" }],
      drag: [{ clip: "surprised" }]
    },
    expressions: {
      idle: "neutral",
      greet: "smile",
      head: "shy",
      praise: "smile",
      curious: "curious",
      excited: "happy",
      sad: "sad",
      angry: "angry"
    },
    previewClips: ["idle", "wave", "happy-a"]
  }
}
```

Rules:

- `clip` is the motion filename stem, without path or `.motion3.json`.
- A candidate may declare `followUp: { clip, delay }` for a reviewed sequence.
- `neutralExpression` must restore every parameter that temporary expressions can leave behind.
- Expression resolution priority is generated parameter expression, native `.exp3.json` with the same stem, then an explicitly mapped motion converted to expression parameters.
- Use `generatedExpressions` only when the model lacks usable native expressions and parameter IDs/ranges have been inspected. Include a complete neutral facial baseline so temporary decorations, blush, mouth shapes, or eye modes do not leak into later states.
- Do not overwrite gaze parameters in a generated facial expression if cursor following should remain active.
- `cursorFollow.parameters` can map non-standard model parameter IDs. Confirm the parameter IDs and sensible ranges from the model rather than copying another character's values.
- `previewClips` is a curated user-facing list. Do not expose internal reset clips, isolated ear/tail parameter fragments, or unplayable resources.

The bundled-model QA currently expects every bundled Cubism 3 model to have a reaction profile and validates all required action kinds.

## 4. Transparent WebM `video-pet-v1`

Minimal structure:

```text
models/
└── my-video-pet/
    ├── pet.json
    ├── idle.webm
    └── greet.webm
```

Minimal manifest:

```json
{
  "format": "video-pet-v1",
  "name": "My Video Pet",
  "description": "Optional description",
  "render": {
    "width": 0.96,
    "anchor": "bottom",
    "bottom": 8
  },
  "animations": {
    "idle": ["idle.webm"],
    "greet": ["greet.webm"]
  }
}
```

Render fields:

| Field | Runtime behavior |
|---|---|
| `render.width` | Relative to the 400 px canvas width; clamped to 0.35–1.4 |
| `render.anchor` | Only exact `center` selects center anchoring; otherwise bottom anchoring |
| `render.bottom` | Bottom margin for bottom anchoring; clamped to 0–120 |

Animation behavior:

- `idle` is mandatory and loops.
- Non-idle animations play once and then return to idle via the video `ended` event.
- Multiple files under one semantic key are selected randomly.
- Fallbacks are implemented in `INTERACTION_FALLBACKS`. Current primary keys are `idle`, `tap`, `greet`, `head`, `happy`, `snack`, `curious`, `sleepy`, `sad`, `angry`, and `drag`.
- A source switch retains the previous canvas frame until the next video has a decodable frame, preventing transparent flashes.
- Video bytes are read from disk and exposed through an object URL; destroy must pause playback, remove the source, revoke URLs, stop audio, and clear the canvas.
- Current video pets have no independent expression manager, head/eye parameters, physics, or lip-sync parameters.

For reliable assets, keep the clips compatible with the existing DeepSeek reference: VP9 WebM with alpha, consistent canvas size, timing, transparent margins, and subject alignment. Verify actual alpha pixels in Electron; filename and codec metadata alone are insufficient.

## 5. Asset catalog and preview

The renderer reports normalized catalogs to the main process. User interaction mappings may persist these IDs.

Common action IDs:

- `clip:<stem>` for a reviewed Live2D motion clip;
- `group:<group>:<index>` for a native motion group entry;
- `interaction:<kind>` for a semantic interaction;
- `video:<filename>` for an exact video clip.

Common expression IDs:

- `profile:<source>` for a profile expression;
- `native:<expression-id>` for a native Live2D expression.

Limits:

- Main-process normalization keeps at most 160 actions and 160 expressions.
- The normal Live2D preview catalog is curated to at most 24 actions and 24 expressions.
- Video `previewCatalog()` currently returns actions and an empty expressions array.

Changing an ID can leave saved `actionId` mappings unavailable. Preserve IDs or provide an explicit migration/reselection experience.

## 6. Persistent per-model state

The model ID keys or influences:

- `currentModelId`;
- `modelOrder`;
- `modelNicknames`;
- `modelProfiles`;
- `modelScales`;
- `modelInteractions`;
- `modelGestures`;
- cover-cache filenames;
- `aiConversations`.

Treat model ID changes as data migrations, not cosmetic renames. A user-visible nickname can change without changing the model ID.

## 7. Runtime compatibility surface

When extending or replacing a model implementation, preserve the renderer's expectations:

- properties such as `kind`, `loaded`, `scale`, `x`, `y`, `needsResize`, `enableMotion`, `settings`, and `buffers` where the shared code reads them;
- `load()`, `update()`, `centerModel()`, `destroy()`, pause behavior, coordinate transforms, and audio input/stop behavior;
- asset catalog reporting and exact-asset playback where the settings UI uses them;
- visibility recovery, model-switch cancellation, frozen-frame cleanup, hit-bound reporting, and canvas resize behavior.

Add type-specific branches at the narrow model boundary. Avoid filling unrelated shared paths with repeated model-ID checks.
