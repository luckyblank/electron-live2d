const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const JSZip = require('jszip')

const projectRoot = path.resolve(__dirname, '..')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.setPath('userData', path.join(os.tmpdir(), 'live2d-directory-model-qa-userdata'))

const outputDirectory = path.join(os.tmpdir(), 'live2d-directory-model-qa')
fs.mkdirSync(outputDirectory, { recursive: true })

let fixtureDirectory = ''
let modelPath = ''
const snapshot = {
  appVersion: '1.0.0',
  currentModelId: 'hiyori-directory',
  models: [{
    id: 'hiyori-directory',
    name: 'hiyori-directory',
    displayName: 'Hiyori directory fixture',
    path: '',
    format: 'folder',
    cubismVersion: 4,
    status: 'ready',
    statusMessage: '',
  }],
  covers: {},
  preferences: {
    scale: 1,
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
    settingsPetBackground: false,
    settingsTheme: 'glass',
    chatGreeting: '你好呀～今天想聊点什么？',
  },
  ai: { ready: false, readyByCapability: { chat: false, tts: false }, activePluginIds: { chat: '', tts: '' }, plugins: [] },
  runtime: { phase: 'loading', modelId: 'hiyori-directory', message: '', paused: false, petVisible: true },
}

let win
let lastModelStatus = null
let lastHitBounds = null
const consoleMessages = []

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function cloneSnapshot() {
  return structuredClone(snapshot)
}

async function createDirectoryModelFixture() {
  const archivePath = path.join(projectRoot, 'models', 'hiyori', 'Hiyori.zip')
  if (!fs.existsSync(archivePath)) throw new Error(`Missing QA source model: ${archivePath}`)

  fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-directory-model-fixture-'))
  const fixtureRoot = path.resolve(fixtureDirectory)
  const archive = await JSZip.loadAsync(fs.readFileSync(archivePath))
  for (const entry of Object.values(archive.files)) {
    const relativePath = entry.name.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!relativePath) continue
    const targetPath = path.resolve(fixtureRoot, ...relativePath.split('/'))
    if (!targetPath.startsWith(`${fixtureRoot}${path.sep}`)) {
      throw new Error(`Unsafe path in QA model archive: ${entry.name}`)
    }
    if (entry.dir) {
      fs.mkdirSync(targetPath, { recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, await entry.async('nodebuffer'))
  }

  const descriptorPath = path.join(fixtureRoot, 'Hiyori', 'Hiyori.model3.json')
  if (!fs.existsSync(descriptorPath)) throw new Error('Extracted QA model is missing Hiyori.model3.json')
  return pathToFileURL(descriptorPath).href
}

function cleanupFixture() {
  if (!fixtureDirectory) return
  fs.rmSync(fixtureDirectory, { recursive: true, force: true })
  fixtureDirectory = ''
}

function registerIPC() {
  ipcMain.handle('state:get-snapshot', () => cloneSnapshot())
  ipcMain.handle('settings:update', () => cloneSnapshot())
  ipcMain.handle('model:select', () => ({ ok: true, snapshot: cloneSnapshot() }))
  ipcMain.handle('model:scale-update', () => ({ ok: true, snapshot: cloneSnapshot() }))
  ipcMain.handle('ai:chat', () => ({ ok: false }))
  ipcMain.handle('ai:speech-synthesize', () => ({ ok: false, skipped: true }))
  ipcMain.handle('ai:conversation-get', () => [])
  ipcMain.handle('ai:conversation-clear', () => true)
  ipcMain.on('model:report-status', (_event, status) => { lastModelStatus = status })
  ipcMain.on('pet:hit-bounds', (_event, bounds) => { lastHitBounds = bounds })
}

async function run() {
  modelPath = await createDirectoryModelFixture()
  snapshot.models[0].path = modelPath
  registerIPC()
  await app.whenReady()
  win = new BrowserWindow({
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
  win.webContents.on('console-message', details => {
    consoleMessages.push({ level: details.level, message: details.message, sourceId: details.sourceId, lineNumber: details.lineNumber })
  })
  await win.loadFile(path.join(projectRoot, 'renderer', 'index.html'))
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15000 && lastModelStatus?.phase !== 'ready' && lastModelStatus?.phase !== 'error') await wait(150)
  if (lastModelStatus?.phase === 'ready') {
    const boundsStartedAt = Date.now()
    while (Date.now() - boundsStartedAt < 5000 && !lastHitBounds) await wait(150)
  }
  const screenshot = path.join(outputDirectory, 'hiyori-directory-model.png')
  fs.writeFileSync(screenshot, (await win.capturePage()).toPNG())
  const report = {
    generatedAt: new Date().toISOString(),
    modelPath,
    lastModelStatus,
    lastHitBounds,
    relevantConsoleMessages: consoleMessages.filter(item => /model|failed|load|cubism/i.test(item.message)),
    screenshot,
    passed: lastModelStatus?.phase === 'ready' && Boolean(lastHitBounds && lastHitBounds.width > 0 && lastHitBounds.height > 0),
  }
  const reportPath = path.join(outputDirectory, 'results.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  process.stdout.write(JSON.stringify({ reportPath, ...report }, null, 2))
  win.destroy()
  cleanupFixture()
  app.quit()
}

run().catch(error => {
  console.error(error)
  if (win && !win.isDestroyed()) win.destroy()
  cleanupFixture()
  app.exit(1)
})
