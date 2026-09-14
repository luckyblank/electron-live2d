---
name: pet-model-development
description: Develop and verify pet models for this Electron Live2DCompanion repository, including Cubism 3 Live2D and video-pet-v1 WebM assets, motions, expressions, interactions, rendering, and model QA. Use for “宠物模型开发、导入、修复、动作或表情”; do not use for AI provider plugins.
metadata:
  short-description: Develop and verify Live2D or transparent WebM pet models
---

# Pet Model Development

Use the repository's existing model boundaries instead of inventing a parallel loader. Work from the repository root and treat the current implementation as the source of truth when code and older documentation differ.

The user's request defines the scope. Do not change the default character, migrate existing users, rewrite unrelated renderer behavior, or redistribute model assets unless the request requires it.

## Start by classifying the work

Choose the path from the supplied assets and desired behavior:

| Input or goal | Use |
|---|---|
| `.model3.json` plus `.moc3`, or a ZIP containing them | Cubism 3 Live2D |
| One or more transparent VP9 WebM clips | `video-pet-v1` |
| Cubism 2 `.model.json` / `.moc` | Ask for or perform a Cubism 3 export; the host does not support Cubism 2 |
| Independent facial expressions, eye/head tracking, or TTS lip sync | Live2D; a finished full-frame WebM cannot provide independent parameters |
| A short emotional reaction that replaces the whole character animation | A video-pet animation is appropriate |
| A new media type or layered video composition | A host protocol change, not a content-only model addition |

Do not describe a WebM reaction clip as an independent expression. In this repository, a video clip contains the body, face, timing, and effects together. Live2D `.exp3.json` or generated parameter expressions can be applied independently from a motion.

## Read only the sources needed

Before changing model behavior, inspect the relevant current code:

- Always inspect [model-inspector.js](../../../model-inspector.js) and the model discovery functions in [main.js](../../../main.js).
- For Live2D loading, actions, expressions, cursor following, hit testing, previews, or lip sync, inspect [renderer/app.js](../../../renderer/app.js) and [config/model-reactions.js](../../../config/model-reactions.js).
- For transparent video pets, inspect [renderer/video-pet-model.js](../../../renderer/video-pet-model.js), the target `pet.json`, and [docs/deepseek-pet-integration.md](../../../docs/deepseek-pet-integration.md).
- For settings, action mapping, model import, covers, or profile changes, inspect [renderer/settings.js](../../../renderer/settings.js), [renderer/settings.html](../../../renderer/settings.html), [docs/model-interactions.md](../../../docs/model-interactions.md), and the corresponding IPC in `main.js`.
- For exact file-format and runtime contracts, read [references/model-contracts.md](references/model-contracts.md).
- Before declaring the work complete, read [references/verification.md](references/verification.md).

If `.codegraph/` exists, use CodeGraph before text search as required by the repository's `AGENTS.md`. Otherwise use `rg` or direct file reads.

## Preserve these project invariants

### Model identity and discovery

- A model ID is the name of its directory under a model root. It is also the persistence key for nickname, scale, profile, interactions, gestures, cover, and conversation history.
- Keep a published model ID stable. A rename creates a logically new character and strands the old per-character state unless a migration is added.
- The user-data model directory overrides a same-ID portable or bundled model. Never assume the bundled copy is the version that will run.
- `_repo` is reserved and ignored by the scanner.
- Only models with `status: "ready"` are selectable.
- Adding a bundled model under `models/<model-id>/` is enough for packaging because the builder already includes `models/`.

### Supported formats

- Live2D support is Cubism 3 only.
- A folder model requires a root-level `.model3.json` whose `FileReferences.Moc` resolves to an existing `.moc3`.
- A ZIP model requires both `.model3.json` and `.moc3`, and the descriptor must be below at least one ZIP directory level. ZIP64 is rejected.
- A video pet requires `pet.json` with `format: "video-pet-v1"`, an object-valued `animations` map, and at least one `idle` WebM.
- Every video path must be relative, end in `.webm`, remain inside the model directory after resolution, and exist.
- Do not download or commit Live2D Cubism Core unless its license permits that distribution. The application expects `static/live2dcubismcore.min.js` to be supplied separately.

### Motions, expressions, and interactions

- Prefer standard Live2D motion groups so third-party models work without code: `Idle`, `TapBody`, `TapHead`, `PetGreet`, `PetHappy`, `PetSnack`, `PetShy`, `PetCurious`, and `PetSleepy`.
- Generic Live2D loading filters empty motion-group names. A model whose useful motions live in an empty group needs a reviewed entry in `MODEL_REACTION_PROFILES`.
- Product-specific mappings belong in [config/model-reactions.js](../../../config/model-reactions.js), not scattered conditionals keyed by model ID.
- The main semantic action keys are `idle`, `tap`, `greet`, `head`, `happy`, `snack`, `shy`, `curious`, `sleepy`, `sad`, `angry`, and `drag`.
- Higher-level interactions such as `praise`, `excited`, and `calm` map onto those model actions in the renderer. Inspect the current mapping before adding a new semantic key.
- A Live2D expression is a native `.exp3.json`, a generated parameter expression, or an explicitly reviewed motion-to-expression fallback.
- A video pet currently reports all clips as actions and reports no independent expressions. Adding an “expressions” list to `pet.json` alone will not work; the preview normalizer and video-specific playback path must also be extended.
- Keep asset IDs stable when they can be saved in user interaction mappings. Current examples include `clip:<stem>`, `group:<group>:<index>`, `interaction:<kind>`, and `video:<filename>`.

### Renderer and product behavior

- The project is plain CommonJS JavaScript loaded directly by Electron. Do not introduce TypeScript, Vite, or a bundler for a model-only change.
- The pet renderer intentionally runs with Node integration, no context isolation, no sandbox, and disabled web security because `live2d-renderer` loads local model resources directly. Do not “fix” those flags without redesigning the loading boundary.
- Preserve the shared 400×600 transparent canvas, scale range 0.5–2, hit-mask flow, drag behavior, pause/resume behavior, cover generation, settings-background capture, and model-switch cleanup.
- Video reactions are exclusive source changes. Non-idle clips return to looping idle when they end. Do not promise composable facial expressions or lip sync for video pets.
- TTS audio can play for both model types, but automatic mouth movement depends on a usable Live2D `LipSync` parameter group.

### Compatibility and rights

- Model IDs, persisted action IDs, reaction keys, default configuration, and store schema are compatibility boundaries.
- New optional fields need safe fallbacks. Renaming or removing persisted fields requires a non-destructive migration and an intentional schema-version change.
- Keep user nicknames, scales, profiles, model order, interactions, gestures, and conversations intact.
- Verify redistribution rights for every model, texture, motion, expression, audio file, and generated derivative. Preserve required notices. The bundled DeepSeek pet assets have a non-commercial attribution requirement documented in its model directory and integration document.

## Implementation workflow

1. **Inspect the target and worktree.** Identify the requested model ID, asset type, license/notice files, existing user-visible behavior, and unrelated changes that must be preserved.
2. **Run the static inspector early.** Use `inspectModelDirectory` or `inspectModelArchive` before editing runtime code. A content error should not be solved with a loader workaround.
3. **Choose content-only or host change.**
   - Content-only: add or repair model files, descriptor references, motion groups, expressions, hit areas, or `pet.json` mappings.
   - Product mapping: add a focused `MODEL_REACTION_PROFILES` entry when standard metadata is insufficient.
   - Host change: alter `model-inspector.js`, discovery metadata, renderer selection, asset catalog, settings, IPC, or QA only when the requested format or behavior cannot fit the existing contracts.
4. **Integrate the complete user experience.** Check discovery, loading, initial frame, scaling, positioning, clicks, long press, drag, idle behavior, actions, expressions, AI emotion reactions, audio/lip sync, preview catalog, cover, model switching, pause/resume, and settings background as applicable.
5. **Handle defaults deliberately.** A bundled model does not automatically need to become the default. If it should be available to new users with a custom profile, update `config/defaults.json`. Add a migration only when existing-user behavior is explicitly part of the task.
6. **Add focused QA.** Extend the nearest existing script instead of creating a duplicate test harness. Validate observable rendering or behavior, not only the presence of filenames.
7. **Report accurately.** State the model format, what is native versus synthesized or fallback behavior, tests run, remaining asset limitations, and any license constraint that affects distribution.

## Definition of done

A model change is complete only when:

- the scanner returns the intended format and `status: "ready"`;
- the model reaches the renderer's ready state and draws a visible initial frame;
- requested actions and expressions are discoverable and actually produce a playback or parameter change;
- interaction fallbacks do not select missing or internal-only clips;
- switching away, switching back, pausing, hiding, and resizing do not leave stale frames or timers;
- relevant targeted QA and syntax/lint checks pass;
- new repository files are not ignored and contain no machine-specific absolute paths;
- redistribution notes are included where required.

Do not run packaging or broad GUI suites unless the change or user request justifies them. Use the proportional command matrix in [references/verification.md](references/verification.md).
