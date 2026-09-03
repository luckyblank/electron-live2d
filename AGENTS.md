# AGENTS.md

This file provides guidance to Codex (codex.ai/code) when working with code in this repository.

## Project Overview

Electron + Live2D desktop Q-version (chibi) pet app. A frameless, transparent, always-on-top window renders an animated Live2D character on the user desktop. Supports click interaction, drag-to-reposition, random idle animations, system tray controls, and model switching.

The project is **pure JavaScript** (no TypeScript, no Vite, no bundler). Electron loads source files directly.

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

Models live in subdirectories under `static/models/` as `.model3.json` descriptors or `.zip` bundles. Each subdirectory becomes one tray-selectable model. The `hiyori` model is prioritized as default.

## Build Pipeline

- No build step for source code - Electron loads `main.js`, `preload.js`, and `renderer/index.html` directly.
- `npm run package:win` runs `electron-builder` which reads the `build` config from `package.json` and produces an NSIS installer in `dist/`.
- The `build.files` glob excludes dev-only files (*.bak, *.md, test scripts, download-models.cjs, generate-icon.js, build outputs) so they are not shipped.

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
