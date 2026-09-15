const { app, BrowserWindow, ipcMain, nativeImage } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const projectRoot = path.resolve(__dirname, '..')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
const requestedModelId = process.env.QA_BACKGROUND_MODEL === 'deepseek-pet' ? 'deepseek-pet' : 'hiyori'
const requestedTheme = process.env.QA_BACKGROUND_THEME === 'healing' ? 'healing' : 'glass'
const qaVariant = `${requestedModelId}-${requestedTheme}`
app.setPath('userData', path.join(os.tmpdir(), `live2d-settings-background-qa-userdata-${qaVariant}`))

const outputDirectory = path.join(os.tmpdir(), `live2d-settings-background-qa-${qaVariant}`)
fs.mkdirSync(outputDirectory, { recursive: true })

const hiyoriPath = pathToFileURL(path.join(projectRoot, 'models', 'hiyori', 'Hiyori.zip')).href
const deepseekPetPath = pathToFileURL(path.join(projectRoot, 'models', 'deepseek-pet', 'pet.json')).href
const brokenPath = pathToFileURL(path.join(projectRoot, 'models', '__missing__', 'missing.model3.json')).href
const hiyoriModel = { id: 'hiyori', name: 'hiyori', displayName: 'hiyori', path: hiyoriPath, format: 'zip', cubismVersion: 4, status: 'ready', statusMessage: '' }
const deepseekPetModel = { id: 'deepseek-pet', name: 'DeepSeek 小蓝鲸', displayName: 'DeepSeek 小蓝鲸', path: deepseekPetPath, format: 'video-pet', cubismVersion: null, status: 'ready', statusMessage: '' }
const targetModel = requestedModelId === 'deepseek-pet' ? deepseekPetModel : hiyoriModel

let snapshot = {
  appVersion: '1.0.1',
  currentModelId: targetModel.id,
  models: [
    hiyoriModel,
    deepseekPetModel,
    { id: 'broken', name: 'broken', displayName: 'broken', path: brokenPath, format: 'folder', cubismVersion: 3, status: 'ready', statusMessage: '' },
  ],
  covers: {},
  staticPetBackgrounds: {},
  modelsFolder: path.join(outputDirectory, 'models'),
  pluginsFolder: path.join(outputDirectory, 'plugins'),
  preferences: {
    scale: 0.85,
    cursorFollow: 'near',
    effects: 'subtle',
    interactionMode: 'smart',
    idleEnabled: false,
    qualityMode: 'auto',
    alwaysOnTop: true,
    launchAtLogin: false,
    reducedMotion: 'off',
    onboardingSeen: true,
    backgroundDetection: false,
    settingsPetBackground: true,
    settingsTheme: requestedTheme,
    chatGreeting: '你好呀～今天想聊点什么？',
  },
  ai: {
    ready: false,
    readyByCapability: { chat: false, tts: false },
    activePluginIds: { chat: '', tts: '' },
    plugins: [],
    ttsDirectory: path.join(outputDirectory, 'tts'),
  },
  runtime: { phase: 'ready', modelId: targetModel.id, message: '', paused: false, petVisible: true },
}

let petWindow
let settingsWindow
let lastHitBounds = null
let lastModelStatus = null
let lastPetBackgroundPayload = null
let frameCount = 0
let nullFrameCount = 0
let ackCount = 0
let holdBackgroundAcks = false
let heldBackgroundAck = 0
let savedCoverPayload = null

function cloneSnapshot() {
  return structuredClone(snapshot)
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function broadcast(reason) {
  const payload = { reason, snapshot: cloneSnapshot() }
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('state:changed', payload)
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('state:changed', payload)
}

function registerIPC() {
  let longMessageLayoutRevision = 0
  const resolveLongMessageLayout = (payload = {}) => {
    const expanded = Boolean(payload && payload.open)
    return {
      expanded,
      side: expanded ? 'right' : 'none',
      mode: expanded ? 'right' : 'collapsed',
      readerWidth: expanded ? 356 : 0,
      gap: 14,
      stageOffsetX: 0,
      readerOffsetX: expanded ? 414 : 0,
      outerWidth: expanded ? 770 : 400,
      outerHeight: 600,
      stageWidth: 400,
      stageHeight: 600,
      revision: ++longMessageLayoutRevision,
    }
  }

  ipcMain.handle('state:get-snapshot', () => cloneSnapshot())
  ipcMain.handle('settings:update', (_event, patch) => {
    snapshot.preferences = { ...snapshot.preferences, ...(patch || {}) }
    broadcast('settings-updated')
    return cloneSnapshot()
  })
  ipcMain.handle('settings:reset', () => cloneSnapshot())
  ipcMain.handle('model:select', (_event, modelId) => {
    snapshot.currentModelId = modelId
    snapshot.runtime.modelId = modelId
    snapshot.runtime.phase = 'loading'
    broadcast('model-selected')
    return cloneSnapshot()
  })
  ipcMain.handle('model:scale-update', () => ({ ok: true, snapshot: cloneSnapshot() }))
  ipcMain.handle('model:import-zip', () => ({ canceled: true }))
  ipcMain.handle('model:nickname-update', () => ({ ok: true, snapshot: cloneSnapshot() }))
  for (const channel of ['window:reset-pet-position', 'window:move-pet', 'window:open-models-folder', 'window:open-plugins-folder', 'window:open-external']) {
    ipcMain.handle(channel, () => true)
  }
  ipcMain.handle('update:check', () => ({ ok: true, hasUpdate: false, current: '1.0.1', latest: '1.0.1' }))
  ipcMain.handle('update:download', () => ({ ok: false }))
  ipcMain.handle('ai:plugin-install', () => ({ ok: false, ai: cloneSnapshot().ai }))
  ipcMain.handle('ai:plugin-activate', () => ({ ok: false, ai: cloneSnapshot().ai }))
  ipcMain.handle('ai:plugin-deactivate', () => ({ ok: false, ai: cloneSnapshot().ai }))
  ipcMain.handle('ai:plugin-configure', () => ({ ok: false, ai: cloneSnapshot().ai }))
  ipcMain.handle('ai:plugin-test', () => ({ ok: false }))
  ipcMain.handle('ai:chat', () => ({ ok: false }))
  ipcMain.handle('ai:speech-synthesize', () => ({ ok: false, skipped: true }))
  ipcMain.handle('ai:conversation-get', () => [])
  ipcMain.handle('ai:conversation-clear', () => true)
  ipcMain.handle('pet:long-message-layout', (_event, payload) => resolveLongMessageLayout(payload))
  ipcMain.on('pet:long-message-layout-preview', (event, payload) => {
    event.returnValue = resolveLongMessageLayout(payload)
  })
  ipcMain.on('pet:long-message-layout-commit', (event, payload) => {
    event.returnValue = resolveLongMessageLayout(payload)
  })
  ipcMain.handle('pet:long-message-transition-frame', () => '')
  ipcMain.on('pet:long-message-transition-state', (event, active) => {
    event.returnValue = Boolean(active)
  })

  ipcMain.on('pet:hit-bounds', (_event, bounds) => { lastHitBounds = bounds })
  ipcMain.on('model:report-status', (_event, status) => {
    lastModelStatus = status
    snapshot.runtime = { ...snapshot.runtime, ...status }
  })
  ipcMain.on('settings:pet-background-frame', (_event, payload) => {
    if (payload === null) {
      nullFrameCount++
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('settings:pet-background-frame', null)
      return
    }
    const frame = payload && payload.frame
    if (
      !payload || payload.modelId !== snapshot.currentModelId ||
      payload.format !== snapshot.models.find(model => model.id === payload.modelId)?.format ||
      !frame || !(Number(frame.byteLength) > 0)
    ) return
    frameCount++
    lastPetBackgroundPayload = { ...payload, frame: Buffer.from(frame) }
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('settings:pet-background-frame', payload)
  })
  ipcMain.on('settings:pet-background-frame-ack', (_event, sequence) => {
    const normalized = Number(sequence)
    if (!Number.isSafeInteger(normalized) || normalized <= 0) return
    ackCount++
    if (holdBackgroundAcks) {
      heldBackgroundAck = normalized
      return
    }
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('settings:pet-background-frame-ack', normalized)
    }
  })
  ipcMain.on('pet:save-cover', (_event, modelId, coverDataURL, staticBackgroundDataURL) => {
    savedCoverPayload = { modelId, coverDataURL, staticBackgroundDataURL }
  })
}

async function waitUntil(predicate, timeout = 12000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    if (await predicate()) return true
    await wait(150)
  }
  return false
}

async function backgroundState(label) {
  return settingsWindow.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('settings-pet-background')
    const canvas = document.getElementById('settings-pet-background-canvas')
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let opaquePixels = 0
    let alphaSum = 0
    let minX = canvas.width
    let minY = canvas.height
    let maxX = -1
    let maxY = -1
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 8) {
        opaquePixels++
        const pixel = (i - 3) / 4
        const x = pixel % canvas.width
        const y = Math.floor(pixel / canvas.width)
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      alphaSum += data[i]
    }
    const rect = canvas.getBoundingClientRect()
    return {
      label: ${JSON.stringify(label)},
      ready: root.classList.contains('is-ready'),
      enabled: root.classList.contains('is-enabled'),
      view: document.documentElement.dataset.settingsView,
      opaquePixels,
      alphaSum,
      visibleBounds: maxX >= minX && maxY >= minY
        ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
        : null,
      sourceSize: { width: canvas.width, height: canvas.height },
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      modelId: root.dataset.modelId || '',
      modelFormat: root.dataset.modelFormat || '',
      backgroundMode: root.dataset.backgroundMode || '',
      hasBackgroundSource: Boolean(root.dataset.backgroundSource),
      videoPet: root.classList.contains('is-video-pet'),
      canvasTransform: getComputedStyle(canvas).transform,
      canvasTransitionDuration: getComputedStyle(canvas).transitionDuration,
    }
  })()`)
}

async function hasVisibleBackground(modelId = '') {
  const state = await backgroundState('probe')
  return state.ready && state.enabled && state.opaquePixels > 100 && (!modelId || state.modelId === modelId)
}

async function capture(name) {
  settingsWindow.webContents.invalidate()
  await settingsWindow.capturePage()
  const png = await settingsWindow.capturePage().then(image => image.toPNG())
  const target = path.join(outputDirectory, name)
  fs.writeFileSync(target, png)
  return target
}

async function simulateDrag() {
  if (!lastHitBounds) return false
  const x = Math.round(lastHitBounds.x + lastHitBounds.width / 2)
  const y = Math.round(lastHitBounds.y + lastHitBounds.height / 2)
  return petWindow.webContents.executeJavaScript(`(() => {
    const target = document.elementFromPoint(${x}, ${y}) || document.body
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, button:0, buttons:1, clientX:${x}, clientY:${y}, screenX:1200, screenY:500 }))
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles:true, button:0, buttons:1, clientX:${x + 35}, clientY:${y + 8}, screenX:1235, screenY:508 }))
    return document.getElementById('pet-stage').classList.contains('is-dragging')
  })()`)
}

async function endDrag() {
  await petWindow.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, button:0, buttons:0, clientX:200, clientY:250, screenX:1235, screenY:508 }))`)
}

async function run() {
  registerIPC()
  await app.whenReady()

  petWindow = new BrowserWindow({
    width: 400,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(projectRoot, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })
  settingsWindow = new BrowserWindow({
    width: 470,
    height: 760,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(projectRoot, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  petWindow.webContents.on('console-message', details => process.stderr.write(`[pet] ${details.message}\n`))
  settingsWindow.webContents.on('console-message', details => process.stderr.write(`[settings] ${details.message}\n`))

  await petWindow.loadFile(path.join(projectRoot, 'renderer', 'index.html'))
  const modelReady = await waitUntil(() => lastModelStatus?.phase === 'ready' && lastHitBounds)
  petWindow.webContents.send('covers:request', [targetModel])
  const staticBackgroundCacheGenerated = await waitUntil(() => Boolean(
    savedCoverPayload && savedCoverPayload.modelId === targetModel.id &&
    savedCoverPayload.coverDataURL && savedCoverPayload.staticBackgroundDataURL
  ), 14000)
  if (staticBackgroundCacheGenerated) {
    snapshot.covers[targetModel.id] = savedCoverPayload.coverDataURL
    snapshot.staticPetBackgrounds[targetModel.id] = savedCoverPayload.staticBackgroundDataURL
  }
  const generatedCacheSizes = staticBackgroundCacheGenerated
    ? {
        cover: nativeImage.createFromDataURL(savedCoverPayload.coverDataURL).getSize(),
        staticBackground: nativeImage.createFromDataURL(savedCoverPayload.staticBackgroundDataURL).getSize(),
      }
    : null
  await settingsWindow.loadFile(path.join(projectRoot, 'renderer', 'settings.html'))
  await settingsWindow.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}')
  petWindow.webContents.send('settings:pet-background-capture', true)

  const firstFrameReady = await waitUntil(hasVisibleBackground)
  const states = [await backgroundState('first-open')]

  const cadenceStartFrames = frameCount
  await wait(1100)
  const foregroundFramesPerSecond = frameCount - cadenceStartFrames

  holdBackgroundAcks = true
  heldBackgroundAck = 0
  const backpressureStartFrames = frameCount
  await wait(700)
  const framesWhileAckHeld = frameCount - backpressureStartFrames
  holdBackgroundAcks = false
  if (heldBackgroundAck) {
    petWindow.webContents.send('settings:pet-background-frame-ack', heldBackgroundAck)
  }
  const resumeStartFrames = frameCount
  await wait(650)
  const framesAfterAckReleased = frameCount - resumeStartFrames

  petWindow.webContents.send('settings:pet-background-capture', false)
  const pausedBackground = await backgroundState('capture-paused')
  const pausedStartFrames = frameCount
  await wait(700)
  const framesWhileCapturePaused = frameCount - pausedStartFrames
  petWindow.webContents.send('settings:pet-background-capture', true)
  const resumedAfterPause = await waitUntil(() => frameCount > pausedStartFrames, 3000)

  let staticBackgroundSizeTransition = null
  if (requestedModelId === 'deepseek-pet') {
    await settingsWindow.webContents.executeJavaScript(`
      document.querySelector('.section-tab[data-section="system"]').click()
    `)
    await wait(350)
    const dynamicState = await backgroundState('video-pet-dynamic-reference')
    const dynamicScreenshot = await capture('settings-background-dynamic.png')
    snapshot.preferences.settingsPetBackground = false
    broadcast('video-pet-static-background')
    const staticReady = await waitUntil(async () => {
      const state = await backgroundState('video-pet-static-probe')
      return state.ready && state.backgroundMode === 'static' && state.modelId === targetModel.id
    })
    const staticState = await backgroundState('video-pet-static-reference')
    const staticScreenshot = await capture('settings-background-static.png')
    const widthRatio = dynamicState.visibleBounds && staticState.visibleBounds
      ? staticState.visibleBounds.width / dynamicState.visibleBounds.width
      : 0
    const heightRatio = dynamicState.visibleBounds && staticState.visibleBounds
      ? staticState.visibleBounds.height / dynamicState.visibleBounds.height
      : 0
    staticBackgroundSizeTransition = {
      staticReady,
      dynamicState,
      staticState,
      widthRatio,
      heightRatio,
      dynamicScreenshot,
      staticScreenshot,
    }
    snapshot.preferences.settingsPetBackground = true
    broadcast('video-pet-dynamic-background-restored')
    await waitUntil(async () => (await backgroundState('video-pet-dynamic-restore-probe')).backgroundMode === 'dynamic')
  }

  let videoPetSwitchTransition = null
  if (requestedModelId === 'deepseek-pet') {
    const staleVideoPayload = lastPetBackgroundPayload && {
      ...lastPetBackgroundPayload,
      frame: Buffer.from(lastPetBackgroundPayload.frame),
    }
    await petWindow.webContents.executeJavaScript(`(() => {
      window.__qaModelSnapshotMax = document.querySelectorAll('.model-snapshot').length
      if (window.__qaModelSnapshotObserver) window.__qaModelSnapshotObserver.disconnect()
      window.__qaModelSnapshotObserver = new MutationObserver(() => {
        window.__qaModelSnapshotMax = Math.max(
          window.__qaModelSnapshotMax,
          document.querySelectorAll('.model-snapshot').length
        )
      })
      window.__qaModelSnapshotObserver.observe(document.getElementById('pet-stage'), { childList: true })
    })()`)
    await settingsWindow.webContents.executeJavaScript(`(() => {
      const root = document.getElementById('settings-pet-background')
      window.__qaSettingsBackgroundCleared = false
      if (window.__qaSettingsBackgroundObserver) window.__qaSettingsBackgroundObserver.disconnect()
      window.__qaSettingsBackgroundObserver = new MutationObserver(() => {
        if (!root.classList.contains('is-ready') && !root.dataset.modelId) {
          window.__qaSettingsBackgroundCleared = true
        }
      })
      window.__qaSettingsBackgroundObserver.observe(root, { attributes: true, attributeFilter: ['class', 'data-model-id'] })
    })()`)
    snapshot.currentModelId = hiyoriModel.id
    snapshot.runtime.modelId = hiyoriModel.id
    snapshot.runtime.phase = 'loading'
    broadcast('video-pet-switch-regression')
    const alternateReady = await waitUntil(() => lastModelStatus?.modelId === hiyoriModel.id && lastModelStatus?.phase === 'ready', 14000)
    const alternateBackgroundReady = await waitUntil(() => hasVisibleBackground(hiyoriModel.id), 14000)
    const alternateBackground = await backgroundState('video-pet-switch-alternate')
    if (staleVideoPayload) {
      settingsWindow.webContents.send('settings:pet-background-frame', staleVideoPayload)
      await wait(160)
    }
    const afterStaleVideoFrame = await backgroundState('after-stale-video-frame')
    const settingsBackgroundCleared = await settingsWindow.webContents.executeJavaScript(`(() => {
      if (window.__qaSettingsBackgroundObserver) window.__qaSettingsBackgroundObserver.disconnect()
      return Boolean(window.__qaSettingsBackgroundCleared)
    })()`)
    videoPetSwitchTransition = await petWindow.webContents.executeJavaScript(`(() => {
      if (window.__qaModelSnapshotObserver) window.__qaModelSnapshotObserver.disconnect()
      return {
        alternateReady: ${JSON.stringify(alternateReady)},
        maxSnapshots: Number(window.__qaModelSnapshotMax) || 0,
        finalSnapshots: document.querySelectorAll('.model-snapshot').length,
      }
    })()`)
    Object.assign(videoPetSwitchTransition, {
      alternateBackgroundReady,
      settingsBackgroundCleared,
      alternateBackground,
      afterStaleVideoFrame,
      staleVideoFrameRejected: Boolean(
        staleVideoPayload && afterStaleVideoFrame.modelId === hiyoriModel.id &&
        !afterStaleVideoFrame.videoPet && afterStaleVideoFrame.ready
      ),
    })

    snapshot.currentModelId = targetModel.id
    snapshot.runtime.modelId = targetModel.id
    snapshot.runtime.phase = 'loading'
    broadcast('video-pet-switch-regression-restore')
    await waitUntil(async () => lastModelStatus?.modelId === targetModel.id && lastModelStatus?.phase === 'ready' && await hasVisibleBackground(targetModel.id), 14000)
    videoPetSwitchTransition.restoredBackground = await backgroundState('video-pet-switch-restored')
  }

  for (const section of ['behavior', 'ai', 'system', 'characters']) {
    await settingsWindow.webContents.executeJavaScript(`document.querySelector('.section-tab[data-section=${JSON.stringify(section)}]').click()`)
    await wait(350)
    states.push(await backgroundState(`after-tab-${section}`))
  }

  const beforeDragFrames = frameCount
  const dragRecognized = await simulateDrag()
  await wait(900)
  states.push(await backgroundState('during-drag'))
  await endDrag()
  await wait(500)
  states.push(await backgroundState('after-drag'))
  const framesDuringDrag = frameCount - beforeDragFrames

  snapshot.runtime.petVisible = false
  broadcast('pet-hidden')
  await wait(700)
  states.push(await backgroundState('pet-hidden-settings-open'))
  snapshot.runtime.petVisible = true
  broadcast('pet-restored')
  await wait(700)
  states.push(await backgroundState('pet-restored'))

  const recoveryStartFrames = frameCount
  snapshot.currentModelId = 'broken'
  snapshot.runtime.modelId = 'broken'
  broadcast('broken-model-selected')
  await waitUntil(() => lastModelStatus?.modelId === 'broken' && lastModelStatus?.phase === 'error', 6000)
  snapshot.currentModelId = targetModel.id
  snapshot.runtime.modelId = targetModel.id
  broadcast('model-recovery')
  const recovered = await waitUntil(async () => lastModelStatus?.modelId === targetModel.id && lastModelStatus?.phase === 'ready' && await hasVisibleBackground(), 14000)
  states.push(await backgroundState('after-failed-switch-recovery'))
  const recoveryFrames = frameCount - recoveryStartFrames

  const screenshot = await capture('settings-background-final.png')
  const allStatesVisible = states.every(state => state.ready && state.enabled && state.opaquePixels > 100)
  const firstState = states[0]
  const firstVisibleBounds = firstState && firstState.visibleBounds
  const firstRenderedVisibleBounds = firstVisibleBounds && firstState.sourceSize
    ? {
        width: firstVisibleBounds.width * firstState.rect.width / firstState.sourceSize.width,
        height: firstVisibleBounds.height * firstState.rect.height / firstState.sourceSize.height,
      }
    : null
  const assertions = {
    modelReady,
    firstFrameReady,
    staticBackgroundCacheGenerated,
    staticBackgroundCacheHasExpectedDimensions: Boolean(
      generatedCacheSizes && generatedCacheSizes.cover.width === 220 && generatedCacheSizes.cover.height === 280 &&
      generatedCacheSizes.staticBackground.width === 240 && generatedCacheSizes.staticBackground.height === 360
    ),
    foregroundCaptureIsThrottled: foregroundFramesPerSecond >= 2 && foregroundFramesPerSecond <= 5,
    backgroundDeliveryUsesBackpressure: framesWhileAckHeld <= 1 && framesAfterAckReleased >= 1,
    capturePauseStopsFramesAndKeepsLastImage: framesWhileCapturePaused === 0 && pausedBackground.ready && pausedBackground.opaquePixels > 100,
    captureResumesAfterPause: resumedAfterPause,
    videoPetBackgroundUsesVisibleFraming: requestedModelId !== 'deepseek-pet' || Boolean(
      firstRenderedVisibleBounds && firstRenderedVisibleBounds.width >= 150 && firstRenderedVisibleBounds.height >= 180
    ),
    videoPetStaticBackgroundKeepsDynamicSize: requestedModelId !== 'deepseek-pet' || Boolean(
      staticBackgroundSizeTransition && staticBackgroundSizeTransition.staticReady &&
      staticBackgroundSizeTransition.dynamicState.backgroundMode === 'dynamic' &&
      staticBackgroundSizeTransition.staticState.backgroundMode === 'static' &&
      staticBackgroundSizeTransition.widthRatio >= 0.9 && staticBackgroundSizeTransition.widthRatio <= 1.1 &&
      staticBackgroundSizeTransition.heightRatio >= 0.9 && staticBackgroundSizeTransition.heightRatio <= 1.1
    ),
    videoPetSwitchClearsPreviousFrame: requestedModelId !== 'deepseek-pet' || Boolean(
      videoPetSwitchTransition && videoPetSwitchTransition.alternateReady && videoPetSwitchTransition.maxSnapshots === 0
    ),
    videoPetSettingsBackgroundIsModelAtomic: requestedModelId !== 'deepseek-pet' || Boolean(
      videoPetSwitchTransition && videoPetSwitchTransition.settingsBackgroundCleared &&
      videoPetSwitchTransition.alternateBackgroundReady && videoPetSwitchTransition.staleVideoFrameRejected &&
      videoPetSwitchTransition.alternateBackground.canvasTransitionDuration === '0s' &&
      videoPetSwitchTransition.restoredBackground.modelId === targetModel.id &&
      videoPetSwitchTransition.restoredBackground.videoPet &&
      videoPetSwitchTransition.restoredBackground.canvasTransitionDuration === '0s'
    ),
    allViewsKeepBackground: states.filter(state => state.label.startsWith('after-tab')).every(state => state.ready && state.opaquePixels > 100),
    dragRecognized,
    backgroundVisibleDuringDrag: states.find(state => state.label === 'during-drag').opaquePixels > 100,
    backgroundSurvivesDrag: states.find(state => state.label === 'after-drag').opaquePixels > 100,
    backgroundSurvivesPetHidden: states.find(state => state.label === 'pet-hidden-settings-open').opaquePixels > 100,
    backgroundRestoresWithPet: states.find(state => state.label === 'pet-restored').opaquePixels > 100,
    failedModelSwitchRecovers: recovered && recoveryFrames > 0 && states.find(state => state.label === 'after-failed-switch-recovery').opaquePixels > 100,
    allStatesVisible,
  }
  const report = {
    generatedAt: new Date().toISOString(),
    outputDirectory,
    frameCount,
    nullFrameCount,
    ackCount,
    foregroundFramesPerSecond,
    framesWhileAckHeld,
    framesAfterAckReleased,
    framesWhileCapturePaused,
    framesDuringDrag,
    recoveryFrames,
    generatedCacheSizes,
    lastModelStatus,
    lastHitBounds,
    renderedVisibleBounds: firstRenderedVisibleBounds,
    staticBackgroundSizeTransition,
    videoPetSwitchTransition,
    states,
    screenshot,
    assertions,
    passed: Object.values(assertions).every(Boolean),
  }
  const reportPath = path.join(outputDirectory, 'results.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  process.stdout.write(JSON.stringify({ reportPath, screenshot, assertions, frameCount, nullFrameCount, passed: report.passed }, null, 2))
  petWindow.destroy()
  settingsWindow.destroy()
  app.quit()
}

run().catch(error => {
  console.error(error)
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy()
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy()
  app.exit(1)
})
