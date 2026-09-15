---
name: ai-model-development
description: Develop and verify chat or TTS model/provider integrations for this Electron Live2DCompanion repository, including manifests, adapters, credentials, emotion tags, history, audio, settings, and AI QA. Use for “AI 模型开发、新增供应商、对话或语音模型接入”; do not use for pet assets.
metadata:
  short-description: Develop and verify chat or TTS model integrations for this app
---

# AI Model Development

Use this skill for the application's AI provider and model integration layer. In this repository, “adding an AI model” normally means exposing a provider model through a manifest and a CommonJS adapter; the application does not train, fine-tune, or bundle model weights.

Work from the repository root. Treat [ai/plugin-manager.js](../../../ai/plugin-manager.js) and the current adapters as the runtime contract. The user's request defines the scope: do not silently enable a provider for existing users, change their saved credentials, replace their selected models, or send live paid requests unless the task requires it.

## Classify the request first

| Request | Primary change |
|---|---|
| Add another compatible model for an existing provider | Update the plugin's `models` and possibly `defaultModel`; confirm the existing request/response schema supports it |
| Add a new text provider | Create `plugins/<id>/manifest.json` and an adapter exporting `chat` |
| Add a new voice provider | Create the manifest and an adapter exporting `synthesize` |
| Add one provider that does both | Declare both capabilities and export both functions; review same-plugin cancellation behavior |
| Change persona, history, emotion parsing, response limits, or prompt order | Change `ai/plugin-manager.js` and affected UI/QA, not an individual provider adapter |
| Add streaming | Host protocol change; current chat and TTS contracts are complete-response only |
| Add a provider without an API key | Host credential-model change; the current manager formally assumes a credential |
| Add local inference or bundled weights | New architecture; do not disguise it as an ordinary remote-provider adapter |
| Add or repair Live2D/pet behavior driven by AI emotions | Use `pet-model-development` for the pet side and this skill only for the AI emotion contract |

Before coding against an external provider, verify the current official provider documentation for endpoint, authentication, model IDs, request fields, response schema, cancellation support, and audio format. Provider APIs change; do not rely only on an old example in this repository.

## Read only the relevant sources

- Always inspect [ai/plugin-manager.js](../../../ai/plugin-manager.js), the target plugin's `manifest.json` and `index.js`, and [config/defaults.json](../../../config/defaults.json).
- For a chat adapter, compare [plugins/deepseek/index.js](../../../plugins/deepseek/index.js) and the chat path in [renderer/app.js](../../../renderer/app.js).
- For direct-audio TTS, compare [plugins/zhipu-tts/index.js](../../../plugins/zhipu-tts/index.js).
- For TTS that returns a temporary remote URL, compare the allowlist, size, content-type, HTTPS, and WAV validation in [plugins/qwen-tts/index.js](../../../plugins/qwen-tts/index.js).
- For settings, installation, activation, voice previews, model selection, or credentials, inspect [renderer/settings.js](../../../renderer/settings.js), [renderer/settings.html](../../../renderer/settings.html), [settings-preload.js](../../../settings-preload.js), and the AI IPC handlers in [main.js](../../../main.js).
- For exact manifest, adapter, prompt, credential, and archive contracts, read [references/plugin-contracts.md](references/plugin-contracts.md).
- Before declaring completion, read [references/verification.md](references/verification.md).

If `.codegraph/` exists, use CodeGraph before text search as required by `AGENTS.md`. Otherwise use `rg` and focused file reads.

## Preserve these project invariants

### Plugin identity and discovery

- Plugin directories use case-insensitive `^[a-z0-9-]+$` names. `manifest.id` must exactly equal the directory name.
- Keep a published plugin ID stable. It keys installation state, selected capability, per-plugin settings, loaded modules, and active-request cancellation.
- `credentialId` is a separate compatibility boundary used to share one credential across related chat/TTS plugins.
- User-data plugins override same-ID portable and bundled plugins.
- “Install” in the settings page only changes application state. It does not install npm dependencies.
- The adapter entry is loaded with CommonJS `require()` in the Electron main process and is not sandboxed. Only trusted plugin code belongs here.

### Supported capabilities

- Only `chat` and `tts` are recognized.
- A declared capability must have the corresponding exported function: `chat` or `synthesize`.
- `models` must be a non-empty list. The active model always comes from that list.
- A provider-specific adapter translates the already assembled host request to the provider protocol and validates the provider response. It should not rebuild persona, history, emotion tags, truncation, credentials, or persistence.
- Current calls are non-streaming. Return one complete result.

### Credentials and secrets

- The host supplies the full key through the adapter argument. Adapters must not read `config.json` or decrypt storage themselves.
- An environment key is declared by `apiKeyEnv` and must match `^[A-Z][A-Z0-9_]*$`.
- Resolve credentials in this fixed order: a non-empty project-root `.env` value, the same process/system environment variable, then a legacy locally entered key encrypted with Electron `safeStorage` and keyed by `credentialId`.
- An empty or missing `.env` entry falls back to the process environment. A configured `.env` or process value cannot be overridden by a saved local key; local storage remains only as a compatibility fallback for existing users.
- Keep real keys out of Git and packages. `.env.example` contains names with empty values; electron-builder excludes only the project-root `.env`, not dependency-owned `.env` files.
- Never log, return, persist outside the manager, interpolate into a URL, or include a key in an error.
- Do not store a key in a module-level variable. Use it only for the current request.
- Do not add a fake-key workaround for unauthenticated providers; extend the host contract deliberately.

### Requests, cancellation, and errors

- Forward the supplied `AbortSignal` to `fetch` or the provider SDK.
- The manager allows one active request per plugin capability and message lane. A replacement in the same lane or capability deactivation aborts the previous request; APP and external lanes do not cancel each other.
- Chat timeout is 45 seconds; TTS timeout is 60 seconds.
- Do not retry indefinitely or continue after cancellation.
- Check HTTP status before accepting a payload. Validate successful response shape and reject empty text/audio.
- User-facing `Error.message` values should be concise and actionable. Distinguish invalid credentials, insufficient balance/quota, permission/model errors, rate limiting, provider outages, invalid payloads, empty results, and network/cancellation failures where the provider makes that possible.
- Do not return large raw provider payloads. Return normalized fields only.

### Chat behavior

- The manager limits user input to 2,000 characters.
- Conversation history is isolated by both pet `modelId` and message lane, not by AI plugin ID, and persists across plugin switches and restarts. `aiConversations` is APP-only; `aiExternalConversations` is external-relay-only.
- Persisted user/assistant messages carry the stable lane source label. External relay turns may also retain bounded `sender` and `requestId` metadata; strip all host-only fields before passing history to provider adapters. Never return external turns from the APP conversation API.
- The configured history length is clamped to 0–40 messages. Persisted individual messages are capped at 2,000 characters.
- The host normally builds system messages for the character profile, current nickname, seven allowed emotion labels, response character limit, history, and a final identity correction after history. External relay can set `useCurrentCharacterProfile: false` for a neutral relay prompt and `useExternalContext: false` for a stateless request.
- Pass `messages` in order and do not mutate it.
- The adapter receives `maxTokens` estimated from the configured 50–2,000 character response limit and clamped to 64–2,048 tokens.
- The manager strips a recognized leading emotion tag before display, TTS, and history persistence. The adapter returns the provider text unchanged except for basic whitespace normalization.
- External-system messages have higher display priority only on the pet bubble. They must not open, close, collapse, lock, clear, or write to the APP chat panel, and must not cancel or invalidate in-flight APP Chat or TTS requests. APP and external calls use independent request lanes; renderer bubble leasing prevents APP output from overwriting an active external bubble.
- Current stable emotion outputs are `happy`, `sad`, `angry`, `surprised`, `shy`, `confused`, and `calm`. Adding an emotion requires coordinated parser, prompt, renderer mapping, pet behavior, and regression changes.

### TTS behavior

- The manager limits input to 1,024 characters.
- The adapter receives model, voice, speed clamped to 0.5–2, volume clamped to 0.1–10, and an abort signal. `ttsTuning: false` tells the UI not to expose unsupported speed/volume controls.
- Return a non-empty Node `Buffer`. The host enforces a 32 MiB maximum.
- Use `format: "wav"` or `format: "pcm"`; other values are archived as WAV. Include a correct `mimeType`.
- Generated audio is archived under the user-data `tts/YYYY-MM/` directory and also returned as base64 for playback.
- External-message speech is persistently cached by normalized text, plugin ID/version, and the manifest-declared `ttsCacheKeyFields`. Qwen declares `model`/`voice`; Zhipu declares `model`/`voice`/`speed`/`volume`. APP speech bypasses this cache. A cache hit still receives its own history archive.
- New TTS plugins must declare every output-affecting host configuration field in `ttsCacheKeyFields`. Omission conservatively falls back to `model`, `voice`, `speed`, and `volume`.
- Bump the manifest `version` whenever an adapter change can alter generated audio; the plugin version namespaces cache entries and prevents stale audio reuse after an implementation change.
- Prefer a complete standard WAV. A remote result URL must be treated as untrusted input: restrict protocol and host, reject redirects as appropriate, cap size, check content type, and validate the audio container.
- Voice preview URLs in manifests are currently accepted only for hard-coded official-domain patterns. A new domain requires a reviewed allowlist change in `ai/plugin-manager.js`; otherwise omit `previewUrl`.
- Live2D models may use decoded audio for lip sync. Video pets can play audio but do not have parameter-driven mouth movement.

### Defaults and migrations

- Adding a plugin directory makes it discoverable; it does not necessarily install or activate it for every user.
- New-user defaults live in `config/defaults.json` under `ai.installedPluginIds`, `activePluginIds`, and `pluginDefaults`.
- `activePluginIds.chat` and `activePluginIds.tts` must reference plugins supporting the matching capability.
- A default model/voice must exist in the plugin manifest.
- Existing-user auto-install or activation requires a non-destructive migration in `main.js` and an intentional schema-version change. Preserve current installed plugins, active selections, settings, secrets, and credential preferences.
- The root `npm run check` script has an explicit list of plugin entry files. Add a new built-in adapter to that list.

## Implementation workflow

1. **Inspect scope and repository state.** Identify whether the task changes a model list, an adapter, a manifest, the host manager, settings, or several of these. Preserve unrelated worktree changes.
2. **Verify the provider contract.** Use current official documentation. Record model IDs, endpoint, authorization, limits, expected errors, response structure, audio container, and whether URLs expire.
3. **Choose the smallest compatible boundary.**
   - Compatible model: manifest-only or a small adapter conditional.
   - New provider: new plugin directory using the current contract.
   - New host capability: coordinated manager, IPC, settings, renderer, defaults, migration, and QA change.
4. **Create or update the manifest.** Keep IDs stable, declare only supported capabilities, list valid models/voices, and use HTTPS documentation links.
5. **Implement the adapter.** Keep it stateless and provider-specific. Forward cancellation, validate the whole response path, normalize return fields, and avoid secret exposure.
6. **Integrate defaults only if requested.** Decide separately whether the plugin is discoverable, installed for new users, active by default, or migrated for existing users.
7. **Update UI only for new contract fields.** Existing model, voice, credential, tuning, install, activate, and test UI is manifest-driven.
8. **Add focused tests.** Mock network behavior where possible. Cover success, cancellation, credential errors, rate limits, invalid payloads, and empty output. Never commit a real key or generated user audio.
9. **Run proportional verification.** Use [references/verification.md](references/verification.md).
10. **Report clearly.** State the provider, capabilities, available/default models or voices, credential source, defaults/migration behavior, tests run, and any unsupported provider feature.

## Definition of done

An AI integration change is complete only when:

- the plugin is discovered with the intended ID, capabilities, models, defaults, and voices;
- the entry loads in the main process and exports every declared capability;
- chat or TTS returns the normalized host contract and rejects malformed responses;
- cancellation and timeouts terminate the provider request;
- credentials work from the intended source without appearing in logs, URLs, snapshots, errors, or test fixtures;
- settings can install, configure, test, activate, deactivate, and restore the plugin state as applicable;
- chat preserves profile, identity correction, emotion extraction, history isolation, and response limits;
- TTS output is bounded, validated, archived, and playable as applicable;
- new-user defaults and existing-user migrations match the explicit product decision;
- syntax, lint, and targeted QA pass;
- all new repository files are unignored and contain no machine-specific absolute paths.
