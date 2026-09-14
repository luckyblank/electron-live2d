# AI 模型与插件验证

Use the smallest test set that proves the changed contract. Prefer mocked network responses for repeatability, speed, and secret safety.

## 1. Static checks

For a new plugin, verify:

- directory name matches `^[a-z0-9-]+$`;
- `manifest.json` parses;
- `manifest.id` exactly equals the directory name;
- capabilities and models normalize to non-empty lists;
- default model and voice exist;
- entry path remains inside the plugin directory;
- the CommonJS module loads and exports every declared capability;
- the new entry is included in the hard-coded root `npm run check` command.

Basic parse/load commands:

```powershell
node -e "const fs=require('fs'); const p='plugins/my-provider/manifest.json'; console.log(JSON.parse(fs.readFileSync(p,'utf8')))"
node -e "const p=require('./plugins/my-provider'); console.log(Object.keys(p))"
```

Loading must not make a network request or require a real API key.

## 2. Command matrix

| Change | Minimum verification |
|---|---|
| Existing provider model-list change | Parse manifest, `npm run check`, `npm run lint -- --quiet`, settings model-selection smoke |
| New or changed chat adapter | Above, mocked adapter success/error/cancel cases, `npm run qa:conversation`, relevant chat smoke |
| New or changed TTS adapter | Above, bounded audio/container tests; run `npm run qa:qwen` when changing Qwen behavior |
| Prompt, emotion, history, or identity logic | `npm run check`, `npm run qa:conversation`, `npm run qa:chat`, relevant pet reaction QA |
| External message source/priority integration | `npm run check`, `npm run qa:conversation`, `npm run qa:external-messages`, `npm run qa:external-message-ui`, `npm run qa:chat`, direct/relay and speech smoke |
| AI settings, credentials, install, or activation | `npm run check`, `npm run qa:settings`, targeted persistence/manual UI checks |
| TTS playback or lip-sync bridge | Relevant TTS test, `npm run qa:chat`, affected model runtime QA |
| Defaults or store migration | Fresh-user and existing-user fixtures plus targeted settings/conversation QA |
| Release | `npm run package:win` only when requested by the user or release workflow |

Do not call a paid live endpoint merely to satisfy a generic test checklist. If a live connection test is requested, use credentials already configured by the user, avoid displaying them, make the smallest request, and report possible cost.

## 3. Chat adapter cases

Cover:

1. successful response with non-empty text;
2. provider-reported model and optional usage normalization;
3. invalid JSON on both success and error status;
4. 401 invalid key;
5. 402 insufficient balance/quota where applicable;
6. 403 permission denial;
7. 404 unavailable model where applicable;
8. 429 rate limiting;
9. 5xx provider outage;
10. success payload with missing/empty text;
11. network rejection;
12. abort signal cancellation;
13. input messages remain unchanged;
14. key absent from URL, logs, errors, and result.

Host-level chat cases:

- profile and current nickname appear in context;
- history is isolated by pet model ID;
- history survives plugin switches and restart;
- changing a pet nickname produces the final post-history identity correction;
- history limit zero clears stored history;
- configured limits clamp correctly;
- canonical and alias emotion tags are stripped and mapped;
- an unknown tag does not create a false supported emotion;
- displayed text, TTS input, and saved assistant history exclude a valid emotion tag.
- APP and external turns persist in separate stores and never appear in one another's restored provider history; provider history receives only `role` and `content`;
- a direct external message never enters AI context;
- `useCurrentCharacterProfile: false` omits the pet nickname/profile and uses the neutral relay prompt;
- `useExternalContext: false` neither reads nor writes external relay context;
- APP and external request lanes can complete concurrently without cancelling each other;
- an external event owns the pet bubble but never opens, closes, collapses, locks, clears, or writes to the APP chat panel.
- APP and external `thinking` bubbles remain held until the Chat promise settles; `speech` bubbles remain held until the TTS promise settles;
- direct external speech skips `thinking`, and relay speech advances in order from `thinking` to `speech` to final text;
- transient progress labels never appear in APP history, external AI context, or the external history conversation.

## 4. TTS adapter cases

Cover:

1. successful non-empty Buffer;
2. correct model, voice, format, and MIME metadata;
3. empty audio rejection;
4. 32 MiB limit;
5. JSON error returned with an audio-like HTTP success path;
6. provider HTTP errors and invalid payloads;
7. abort signal cancellation;
8. speed/volume behavior only when `ttsTuning` is supported;
9. base64 validation if used;
10. exact host/protocol, redirects, content length, content type, and container magic if a result URL is used;
11. expiring remote audio is downloaded completely before returning;
12. key absent from URL, logs, errors, archive filename, and result.

Host-level TTS cases:

- text is limited to 1,024 characters;
- external speech hits only when normalized text, plugin identity/version, and all manifest-declared cache fields match;
- Qwen keys include model/voice but ignore unsupported speed/volume; Zhipu keys include model/voice/speed/volume;
- APP speech and connection tests bypass the external cache;
- cache survives manager restart, contains no plaintext input or credential, and each hit still creates a distinct history archive;
- missing active TTS plugin returns the expected skipped result;
- archive directory uses `YYYY-MM` and a safe filename;
- connection test audio is archived;
- output decodes and plays;
- a Live2D model with `LipSync` moves its mouth;
- a video pet plays sound without claiming parameter lip sync;
- mute, replay, interruption, and model switching stop or replace audio correctly.

## 5. Settings and persistence

Verify the UI can:

- discover the plugin after refresh;
- distinguish Chat and TTS capabilities;
- install without implying an npm package installation;
- select only manifest-declared models and voices;
- show/hide tuning controls from `ttsTuning`;
- save a local key through `safeStorage`;
- show only a masked credential preview;
- prefer a saved local key when selected;
- switch back to an available environment key and clear the local override;
- activate/deactivate the correct capability;
- restore installed state, active IDs, settings, and credential preference after restart;
- share credentials only between intended `credentialId` peers.

If adding a voice preview domain, test both an allowed official URL and malicious near-matches. Do not weaken the rule to arbitrary HTTPS.

## 6. Fresh-user and migration fixtures

Fresh-user validation uses an isolated empty Electron user-data directory and checks `config/defaults.json`.

Existing-user validation starts with representative saved values:

- unrelated installed plugins;
- separate active chat and TTS IDs;
- custom model, voice, persona, history, speed, and volume;
- encrypted secrets and environment/local preference;
- conversations for multiple pet IDs.

After migration, confirm all unrelated values remain. Only the intended new field or plugin state should be added.

## 7. Final delivery record

Report:

- plugin ID, provider, and capability;
- exposed and default model/voice values;
- environment variable and credential-sharing policy without revealing a key;
- whether the plugin is merely discoverable, installed for new users, active by default, or migrated for existing users;
- response/audio normalization and safety checks;
- tests run and their results;
- live tests not run because they require credentials or spend;
- unsupported features such as streaming, unauthenticated operation, or video-pet lip sync.
