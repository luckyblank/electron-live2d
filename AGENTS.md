# AGENTS.md

This file provides guidance to Codex (codex.ai/code) when working with code in this repository.

## Project Overview

Electron + Live2D desktop Q-version (chibi) pet app. A frameless, transparent, always-on-top window renders an animated Live2D character on the user desktop. Supports click interaction, drag-to-reposition, random idle animations, system tray controls, and model switching.

The project is **pure JavaScript** (no TypeScript, no Vite, no bundler). Electron loads source files directly.

## Repository Skills

This repository ships two repo-scoped Codex skills under `.agents/skills/`. Codex discovers them when launched from the repository or one of its subdirectories.

- Use [`pet-model-development`](.agents/skills/pet-model-development/SKILL.md) for Cubism 3 or `video-pet-v1` model additions, repairs, motions, expressions, interactions, renderer compatibility, and model QA.
- Use [`ai-model-development`](.agents/skills/ai-model-development/SKILL.md) for Chat/TTS provider manifests, adapters, model lists, credentials, emotion tags, persistence, audio behavior, settings integration, and AI QA.

Both skills allow implicit invocation and can also be selected explicitly as `$pet-model-development` or `$ai-model-development`. Keep their instructions and references synchronized whenever the corresponding model or AI contracts change. Keep every skill path repository-relative so the skills continue to work after clone.

## Design-First UI Development

The files under [`设计稿/`](设计稿/README.md) are the visual source of truth for app UI work. Existing code and product documentation remain the source of truth for behavior, data, security, and platform constraints.

Before an AI agent edits UI code, it must open and inspect the relevant design images, then publish a short **style lock** covering the task scope, selected theme, exact reference files, visual invariants, retained behavior, known gaps, and acceptance screenshots. Implementation may begin only after that lock is recorded. If the target theme is unclear, references conflict, or a material state is unspecified, stop and ask the user to resolve it instead of inventing a hybrid direction.

- Use the most specific same-theme reference: detail image > full-page image > `主设计稿.png` overview.
- Do not mix glass and healing visual language in one theme. Shared structure and behavior may be reused, but visual tokens and decorative assets must stay theme-scoped.
- Do not use `design-demos/` or the current UI to override a conflicting image in `设计稿/`; they may only fill gaps that the selected design does not define.
- Preserve functional behavior and real product copy unless the task explicitly changes them. A mockup omission is not permission to remove functionality.
- Finish UI work with a same-theme, same-state screenshot comparison at the target window size, plus relevant syntax, lint, and targeted QA checks. Record any intentional deviation.

The complete source-priority, style-lock template, implementation checklist, and visual acceptance gate are defined in [`设计稿/README.md`](设计稿/README.md).

## Commands

```bash
npm start            # Start Electron via nodemon (auto-restart on file change)
npm run dev          # Same as start but passes --dev flag (opens DevTools)
npm run check        # Syntax-check main.js, preload.js, and renderer/app.js
npm run lint         # Run ESLint on all JS files
npm run package:win  # check + electron-builder -> NSIS installer in dist/
```

## Architecture

```
Main Process
  main.js        App lifecycle, BrowserWindow, system tray, IPC handlers,
                 cursor tracking (mouse-follow), model discovery, electron-store

Preload
  preload.js     Bridges main<->renderer via contextBridge: window.petAPI
                 (model list/switch, settings, cursor events, quit)

Renderer
  renderer/index.html   HTML structure + control panel markup
  renderer/styles.css   All CSS (animations, control panel, FX styles)
  renderer/app.js       Live2DCubismModel init, click/drag logic, FX particle
                        system, idle state machine, cursor-follow tracking
```

## Key Dependencies

- `live2d-renderer` (v0.6.x) - Live2D Cubism SDK wrapper. Renders to canvas, provides hit-test, motion/expression/touch controllers, auto-animation loop. Does NOT include Cubism Core.
- `electron-store` (v8.x) - Persistent key-value store for window position and settings.
- `nodemon` (devDependency) - File watcher for dev auto-restart. NOT shipped in production builds.

## Prerequisites

### Live2D Cubism Core

Place `live2dcubismcore.min.js` in `static/` before the app can render models. It is NOT on npm (proprietary license).

1. Download Cubism SDK for Web from https://www.live2d.com/download/cubism-sdk/ (free account required)
2. Extract and copy `Core/live2dcubismcore.min.js` -> `static/live2dcubismcore.min.js`

### Models

Models live in subdirectories as `.model3.json` descriptors or `.zip` bundles in two locations:

- `models/` (project root) - bundled models stored directly in the repository and shipped with the installer. In dev this is the project directory; when packaged it is read from `app.asar`.
- `%APPDATA%/Live2DCompanion/models/` - user-added models, survives uninstall/update. Same-name models here override bundled ones.

Each subdirectory becomes one tray-selectable model. The `hiyori` model is prioritized as default.

## Build Pipeline

- No build step for source code - Electron loads `main.js`, `preload.js`, and `renderer/index.html` directly.
- `npm run package:win` runs `electron-builder` which reads the `build` config from `package.json` and produces an NSIS installer in `dist/`.
- Reusable QA scripts live in `qa/`. The `build.files` glob excludes `qa/`, `design-demos/`, `设计稿/`, and other dev-only files (*.bak, *.md, generate-icon.js, build outputs) so they are not shipped.

## Interaction Design

- **Window**: 400x600, frameless, transparent, always-on-top.
- **Drag**: Native via `-webkit-app-region: drag` on the canvas (OS moves the window).
- **Click vs Drag**: <5px movement within 400ms = click; >=5px = drag.
- **Multi-click**: 1 = tap + particles; 2 = happy; 3 = excited burst + window shake.
- **Cursor follow**: Main process polls cursor (50ms, skips IPC when stationary) -> renderer lerps head/eye/body params.
- **Idle system**: 30s/60s/120s escalate: idle bubbles -> sleepy -> deep sleep (Zzz).
- **Random idle**: `randomMotion: true` in live2d-renderer handles idle animation scheduling.
- **Hit testing**: `model.hitTest(head|body, x, y)` checks canvas-local coordinates.

## Security Notes

The renderer runs with `nodeIntegration: true` and `sandbox: false` (required because `live2d-renderer` is require()-d directly in the renderer). `contextIsolation` is `false` and the preload attaches `window.petAPI` directly. `webSecurity` is disabled to allow loading Cubism Core and model textures via file:// URLs. Note: Electron 20+ defaults `sandbox: true` which silently disables `nodeIntegration` — `sandbox: false` must be set explicitly. Removing `nodeIntegration` would require moving the entire Live2D loading path to preload/main.
