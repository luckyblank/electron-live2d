const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const projectRoot = path.resolve(__dirname, '..')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.setPath('userData', path.join(os.tmpdir(), 'live2d-settings-background-qa-userdata'))

const outputDirectory = path.join(os.tmpdir(), 'live2d-settings-background-qa')
fs.mkdirSync(outputDirectory, { recursive: true })

const hiyoriPath = pathToFileURL(path.join(projectRoot, 'models', 'hiyori', 'Hiyori.zip')).href
const brokenPath = pathToFileURL(path.join(projectRoot, 'models', '__missing__', 'missing.model3.json')).href

let snapshot = {
  appVersion: '1.0.1',
  currentModelId: 'hiyori',
  models: [
    { id: 'hiyori', name: 'hiyori', displayName: 'hiyori', path: hiyoriPath, format: 'zip', cubismVersion: 4, status: 'ready', statusMessage: '' },
    { id: 'broken', name: 'broken', displayName: 'broken', path: brokenPath, format: 'folder', cubismVersion: 3, status: 'ready', statusMessage: '' },
  ],
  covers: {},
  modelsFolder: path.join(outputDirectory, 'models'),
  pluginsFolder: path.join(outputDirectory, 'plugins'),
  preferences: {
    scale: 0.85,
    cursorFollow: 'off',
    effects: 'off',
    interactionMode: 'smart',
    idleEnabled: false,
    qualityMode: 'auto',
    alwaysOnTop: true,
    launchAtLogin: false,
    reducedMotion: 'off',
    onboardingSeen: true,
    backgroundDetection: false,
    settingsPetBackground: true,
    settingsTheme: 'glass',
    chatGreeting: '你好呀～今天想聊点什么？',
  },
  ai: {
    ready: false,
    readyByCapability: { chat: false, tts: false },
    activePluginIds: { chat: '', tts: '' },
    plugins: [],
    ttsDirectory: path.join(outputDirectory, 'tts'),
  },
  runtime: { phase: 'ready', modelId: 'hiyori', message: '', paused: false, petVisible: true },
}

let petWindow
let settingsWindow
let lastHitBounds = null
let lastModelStatus = null
let frameCount = 0
let nullFrameCount = 0

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

  ipcMain.on('pet:hit-bounds', (_event, bounds) => { lastHitBounds = bounds })
  ipcMain.on('model:report-status', (_event, status) => {
    lastModelStatus = status
    snapshot.runtime = { ...snapshot.runtime, ...status }
  })
  ipcMain.on('settings:pet-background-frame', (_event, frame) => {
    if (frame === null) nullFrameCount++
    else if (frame && Number(frame.byteLength) > 0) frameCount++
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('settings:pet-background-frame', frame)
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
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 8) opaquePixels++
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
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    }
  })()`)
}

async function hasVisibleBackground() {
  const state = await backgroundState('probe')
  return state.ready && state.enabled && state.opaquePixels > 100
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
  await settingsWindow.loadFile(path.join(projectRoot, 'renderer', 'settings.html'))
  await settingsWindow.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}')
  petWindow.webContents.send('settings:pet-background-capture', true)

  const firstFrameReady = await waitUntil(hasVisibleBackground)
  const states = [await backgroundState('first-open')]

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
  snapshot.currentModelId = 'hiyori'
  snapshot.runtime.modelId = 'hiyori'
  broadcast('model-recovery')
  const recovered = await waitUntil(async () => lastModelStatus?.modelId === 'hiyori' && lastModelStatus?.phase === 'ready' && await hasVisibleBackground(), 14000)
  states.push(await backgroundState('after-failed-switch-recovery'))
  const recoveryFrames = frameCount - recoveryStartFrames

  const screenshot = await capture('settings-background-final.png')
  const allStatesVisible = states.every(state => state.ready && state.enabled && state.opaquePixels > 100)
  const assertions = {
    modelReady,
    firstFrameReady,
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
    framesDuringDrag,
    recoveryFrames,
    lastModelStatus,
    lastHitBounds,
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
