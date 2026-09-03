const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } = require('electron')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const Store = require('electron-store')

const PET_WIDTH = 400
const PET_HEIGHT = 600
const SETTINGS_WIDTH = 430
const SETTINGS_HEIGHT = 670
const POSITION_SAVE_DELAY = 180
const CURSOR_NEAR_DISTANCE = 220
const PET_VISIBLE_MARGIN = 80

const preferenceDefaults = {
  scale: 1,
  interactionMode: 'smart',
  cursorFollow: 'near',
  effects: 'subtle',
  idleEnabled: true,
  qualityMode: 'auto',
  alwaysOnTop: true,
  launchAtLogin: false,
  reducedMotion: 'system',
  onboardingSeen: false,
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
  return
}

const store = new Store({
  defaults: {
    schemaVersion: 1,
    windowX: undefined,
    windowY: undefined,
    currentModelId: '',
    ...preferenceDefaults,
  },
})

let petWindow = null
let settingsWindow = null
let tray = null
let modelsCache = null
let positionSaveTimer = null
let cursorTimer = null
let dragCandidate = null
let dragActive = false
let dragTimer = null
let appIsQuitting = false
let animationPaused = false
let runtimeStatus = { phase: 'starting', modelId: '', message: '正在启动' }
let lastCursor = null
let lastCursorNear = false

function clamp(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function listModels() {
  if (modelsCache) return modelsCache

  const root = path.join(__dirname, 'static', 'models')
  if (!fs.existsSync(root)) return []

  const models = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== '_repo')
    .map(entry => {
      const directory = path.join(root, entry.name)
      try {
        const files = fs.readdirSync(directory)
        const descriptor = files.find(file => file.toLowerCase().endsWith('.model3.json'))
        const archive = files.find(file => file.toLowerCase().endsWith('.zip'))
        const source = descriptor || archive
        if (!source) return null
        return {
          id: entry.name,
          name: entry.name,
          path: pathToFileURL(path.join(directory, source)).href,
          format: descriptor ? 'folder' : 'zip',
          status: 'ready',
        }
      } catch (error) {
        console.warn(`Skipping unreadable model directory ${entry.name}:`, error.message)
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.id === 'hiyori') return -1
      if (b.id === 'hiyori') return 1
      return a.name.localeCompare(b.name, 'zh-CN')
    })

  modelsCache = models
  return models
}

function refreshModels() {
  modelsCache = null
  return listModels()
}

function selectedModel() {
  const models = listModels()
  const currentId = store.get('currentModelId')
  return models.find(model => model.id === currentId) || models[0] || null
}

function migrateStore() {
  const previousVersion = Number(store.get('schemaVersion')) || 1
  const models = listModels()
  const oldModelPath = store.get('currentModel')
  if (!store.get('currentModelId') && oldModelPath) {
    const match = models.find(model => model.path === oldModelPath)
    if (match) store.set('currentModelId', match.id)
  }

  if (!selectedModel() && models.length) store.set('currentModelId', models[0].id)
  if (!store.has('launchAtLogin') && typeof store.get('autoLaunch') === 'boolean') {
    store.set('launchAtLogin', store.get('autoLaunch'))
  }

  if (previousVersion < 2) {
    // Version 1 could capture the entire transparent window. Version 2 always
    // starts in the safer mode where only the visible character is interactive.
    store.set('interactionMode', 'smart')
    if (oldModelPath) store.set('onboardingSeen', true)
  }
  store.set('schemaVersion', 2)
}

function getPreferences() {
  const interactionMode = store.get('interactionMode')
  const cursorFollow = store.get('cursorFollow')
  const effects = store.get('effects')
  const qualityMode = store.get('qualityMode')
  const reducedMotion = store.get('reducedMotion')

  return {
    scale: clamp(store.get('scale'), 0.5, 2, 1),
    interactionMode: ['smart', 'locked'].includes(interactionMode) ? interactionMode : 'smart',
    cursorFollow: ['near', 'off'].includes(cursorFollow) ? cursorFollow : 'near',
    effects: ['subtle', 'off'].includes(effects) ? effects : 'subtle',
    idleEnabled: store.get('idleEnabled') !== false,
    qualityMode: ['auto', 'eco', 'high'].includes(qualityMode) ? qualityMode : 'auto',
    alwaysOnTop: store.get('alwaysOnTop') !== false,
    launchAtLogin: store.get('launchAtLogin') === true,
    reducedMotion: ['system', 'on', 'off'].includes(reducedMotion) ? reducedMotion : 'system',
    onboardingSeen: store.get('onboardingSeen') === true,
  }
}

function getSnapshot() {
  const current = selectedModel()
  return {
    appVersion: app.getVersion(),
    models: listModels(),
    currentModelId: current ? current.id : '',
    preferences: getPreferences(),
    runtime: {
      ...runtimeStatus,
      paused: animationPaused,
      petVisible: Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()),
    },
  }
}

function sendToWindow(target, channel, payload) {
  if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
    target.webContents.send(channel, payload)
  }
}

function broadcastState(reason = 'updated') {
  const payload = { reason, snapshot: getSnapshot() }
  sendToWindow(petWindow, 'state:changed', payload)
  sendToWindow(settingsWindow, 'state:changed', payload)
}

function defaultPetPosition() {
  const display = screen.getPrimaryDisplay()
  return {
    x: display.workArea.x + display.workArea.width - PET_WIDTH - 32,
    y: display.workArea.y + display.workArea.height - PET_HEIGHT - 24,
  }
}

function safePetPosition(savedX, savedY) {
  const fallback = defaultPetPosition()
  const point = {
    x: Number.isFinite(savedX) ? savedX : fallback.x,
    y: Number.isFinite(savedY) ? savedY : fallback.y,
  }
  const display = screen.getDisplayNearestPoint(point)
  const area = display.workArea
  return {
    x: Math.min(Math.max(point.x, area.x - PET_WIDTH + PET_VISIBLE_MARGIN), area.x + area.width - PET_VISIBLE_MARGIN),
    y: Math.min(Math.max(point.y, area.y - PET_HEIGHT + PET_VISIBLE_MARGIN), area.y + area.height - PET_VISIBLE_MARGIN),
  }
}

function lockPetWindowSize() {
  if (!petWindow || petWindow.isDestroyed()) return
  const bounds = petWindow.getBounds()
  if (bounds.width === PET_WIDTH && bounds.height === PET_HEIGHT) return
  petWindow.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: PET_WIDTH,
    height: PET_HEIGHT,
  }, false)
}

function persistPetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return
  const [windowX, windowY] = petWindow.getPosition()
  store.set({ windowX, windowY })
}

function schedulePositionSave() {
  if (dragActive) return
  if (positionSaveTimer) clearTimeout(positionSaveTimer)
  positionSaveTimer = setTimeout(() => {
    positionSaveTimer = null
    persistPetPosition()
  }, POSITION_SAVE_DELAY)
}

function secureLocalWindow(target) {
  target.webContents.on('will-navigate', event => event.preventDefault())
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

function createPetWindow() {
  const position = safePetPosition(store.get('windowX'), store.get('windowY'))
  const preferences = getPreferences()

  petWindow = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: position.x,
    y: position.y,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    title: '',
    frame: false,
    thickFrame: false,
    roundedCorners: false,
    focusable: false,
    autoHideMenuBar: true,
    alwaysOnTop: preferences.alwaysOnTop,
    hasShadow: false,
    skipTaskbar: true,
    icon: path.join(__dirname, 'resources', 'icon.png'),
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  secureLocalWindow(petWindow)
  petWindow.setMenu(null)
  petWindow.setMenuBarVisibility(false)
  petWindow.setTitle('')
  petWindow.setBackgroundColor('#00000000')
  petWindow.webContents.on('page-title-updated', event => event.preventDefault())
  petWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  petWindow.setIgnoreMouseEvents(true, { forward: true })

  petWindow.once('ready-to-show', () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.showInactive()
  })

  if (process.argv.includes('--dev') || process.env.NODE_ENV === 'development') {
    petWindow.webContents.openDevTools({ mode: 'detach' })
  }

  petWindow.webContents.on('console-message', (details) => {
    const { level, message, lineNumber, sourceId } = details
    console.log(`Pet renderer [${level}] ${sourceId}:${lineNumber} -> ${message}`)
  })

  petWindow.on('moved', schedulePositionSave)
  petWindow.on('resize', lockPetWindowSize)
  petWindow.on('show', () => {
    startCursorTracking()
    broadcastState('pet-visibility')
  })
  petWindow.on('hide', () => {
    stopCursorTracking()
    broadcastState('pet-visibility')
  })
  petWindow.on('blur', () => {
    petWindow.setMenuBarVisibility(false)
    petWindow.setTitle('')
  })
  petWindow.on('closed', () => {
    stopCursorTracking()
    petWindow = null
  })
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
    minWidth: 380,
    minHeight: 560,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#F8F5F1',
    resizable: true,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  secureLocalWindow(settingsWindow)
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'))

  settingsWindow.on('show', () => {
    syncWindowLevels()
    broadcastState('settings-opened')
  })
  settingsWindow.on('hide', syncWindowLevels)
  settingsWindow.on('closed', () => {
    settingsWindow = null
    syncWindowLevels()
  })
}

function openSettings(section = 'characters') {
  if (!settingsWindow || settingsWindow.isDestroyed()) createSettingsWindow()
  if (settingsWindow.isMinimized()) settingsWindow.restore()
  settingsWindow.show()
  syncWindowLevels()
  settingsWindow.focus()
  settingsWindow.moveTop()
  sendToWindow(settingsWindow, 'settings:navigate', section)
}

function togglePetVisibility() {
  if (!petWindow || petWindow.isDestroyed()) return
  if (petWindow.isVisible()) petWindow.hide()
  else petWindow.showInactive()
  updateTrayMenu()
}

function selectModel(modelId) {
  const model = listModels().find(item => item.id === modelId)
  if (!model) return false
  store.set('currentModelId', model.id)
  runtimeStatus = { phase: 'loading', modelId: model.id, message: `正在加载 ${model.name}` }
  updateTrayMenu()
  broadcastState('model-selected')
  return true
}

function applyLoginPreference(enabled) {
  const options = { openAtLogin: enabled, path: process.execPath }
  if (!app.isPackaged && process.argv[1]) options.args = [path.resolve(process.argv[1])]
  app.setLoginItemSettings(options)
}

function applyPreferences() {
  const preferences = getPreferences()
  if (petWindow && !petWindow.isDestroyed()) {
    if (preferences.interactionMode === 'locked') {
      petWindow.setIgnoreMouseEvents(true, { forward: true })
    }
  }
  syncWindowLevels()
  applyLoginPreference(preferences.launchAtLogin)
  if (preferences.cursorFollow === 'near') startCursorTracking()
  else stopCursorTracking(true)
}

function syncWindowLevels() {
  const settingsVisible = Boolean(settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible())
  const alwaysOnTop = getPreferences().alwaysOnTop
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setAlwaysOnTop(alwaysOnTop && !settingsVisible)
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setAlwaysOnTop(alwaysOnTop && settingsVisible)
  }
}

function updatePreferences(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return getSnapshot()

  const currentPreferences = getPreferences()
  const allowed = {
    scale: value => clamp(value, 0.5, 2, currentPreferences.scale),
    interactionMode: value => ['smart', 'locked'].includes(value) ? value : currentPreferences.interactionMode,
    cursorFollow: value => ['near', 'off'].includes(value) ? value : currentPreferences.cursorFollow,
    effects: value => ['subtle', 'off'].includes(value) ? value : currentPreferences.effects,
    idleEnabled: value => Boolean(value),
    qualityMode: value => ['auto', 'eco', 'high'].includes(value) ? value : currentPreferences.qualityMode,
    alwaysOnTop: value => Boolean(value),
    launchAtLogin: value => Boolean(value),
    reducedMotion: value => ['system', 'on', 'off'].includes(value) ? value : currentPreferences.reducedMotion,
    onboardingSeen: value => Boolean(value),
  }

  for (const [key, value] of Object.entries(patch)) {
    if (allowed[key]) store.set(key, allowed[key](value))
  }

  applyPreferences()
  updateTrayMenu()
  broadcastState('preferences-updated')
  return getSnapshot()
}

function resetPreferences() {
  for (const [key, value] of Object.entries(preferenceDefaults)) {
    if (key !== 'onboardingSeen') store.set(key, value)
  }
  store.set('onboardingSeen', true)
  applyPreferences()
  broadcastState('preferences-reset')
  return getSnapshot()
}

function toggleAnimationPause() {
  animationPaused = !animationPaused
  sendToWindow(petWindow, 'pet:pause-changed', animationPaused)
  broadcastState('animation-paused')
  updateTrayMenu()
}

function buildQuickMenu() {
  const current = selectedModel()
  const preferences = getPreferences()
  return Menu.buildFromTemplate([
    { label: animationPaused ? '继续动画' : '暂停动画', click: toggleAnimationPause },
    {
      label: '切换角色',
      submenu: listModels().map(model => ({
        label: model.name,
        type: 'radio',
        checked: Boolean(current && current.id === model.id),
        click: () => selectModel(model.id),
      })),
    },
    {
      label: '锁定宠物（鼠标穿透）',
      type: 'checkbox',
      checked: preferences.interactionMode === 'locked',
      click: item => updatePreferences({ interactionMode: item.checked ? 'locked' : 'smart' }),
    },
    { type: 'separator' },
    { label: '打开设置', click: () => openSettings() },
    { label: '隐藏宠物', click: togglePetVisibility },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ])
}

function showPetContextMenu() {
  if (!petWindow || petWindow.isDestroyed()) return
  buildQuickMenu().popup({ window: petWindow })
}

function createTray() {
  const iconPath = path.join(__dirname, 'resources', 'icon-tray.png')
  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(__dirname, 'resources', 'icon.png')).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Live2D 桌面伙伴')
  tray.on('click', togglePetVisibility)
  updateTrayMenu()
}

function updateTrayMenu() {
  if (!tray) return
  const current = selectedModel()
  const preferences = getPreferences()
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: petWindow && petWindow.isVisible() ? '隐藏宠物' : '显示宠物',
      click: togglePetVisibility,
    },
    { label: '打开设置', click: () => openSettings() },
    { type: 'separator' },
    {
      label: '切换角色',
      submenu: listModels().map(model => ({
        label: model.name,
        type: 'radio',
        checked: Boolean(current && current.id === model.id),
        click: () => selectModel(model.id),
      })),
    },
    { label: animationPaused ? '继续动画' : '暂停动画', click: toggleAnimationPause },
    {
      label: '锁定宠物',
      type: 'checkbox',
      checked: preferences.interactionMode === 'locked',
      click: item => updatePreferences({ interactionMode: item.checked ? 'locked' : 'smart' }),
    },
    { type: 'separator' },
    {
      label: '刷新模型列表',
      click: () => {
        refreshModels()
        updateTrayMenu()
        broadcastState('models-refreshed')
      },
    },
    { label: '退出', click: () => app.quit() },
  ]))
}

function distanceToBounds(point, bounds) {
  const dx = Math.max(bounds.x - point.x, 0, point.x - (bounds.x + bounds.width))
  const dy = Math.max(bounds.y - point.y, 0, point.y - (bounds.y + bounds.height))
  return Math.hypot(dx, dy)
}

function cursorTick() {
  cursorTimer = null
  const preferences = getPreferences()
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || preferences.cursorFollow !== 'near') return

  try {
    const point = screen.getCursorScreenPoint()
    const bounds = petWindow.getBounds()
    const near = distanceToBounds(point, bounds) <= CURSOR_NEAR_DISTANCE
    const moved = !lastCursor || Math.abs(point.x - lastCursor.x) >= 3 || Math.abs(point.y - lastCursor.y) >= 3

    if (moved || near !== lastCursorNear) {
      lastCursor = point
      lastCursorNear = near
      sendToWindow(petWindow, 'cursor:move', {
        clientX: point.x - bounds.x,
        clientY: point.y - bounds.y,
        near,
      })
    }
    cursorTimer = setTimeout(cursorTick, near ? 66 : 500)
  } catch (error) {
    cursorTimer = setTimeout(cursorTick, 500)
  }
}

function startCursorTracking() {
  if (cursorTimer || !petWindow || !petWindow.isVisible() || getPreferences().cursorFollow !== 'near') return
  cursorTimer = setTimeout(cursorTick, 0)
}

function stopCursorTracking(reset = false) {
  if (cursorTimer) clearTimeout(cursorTimer)
  cursorTimer = null
  lastCursor = null
  lastCursorNear = false
  if (reset) sendToWindow(petWindow, 'cursor:move', { clientX: PET_WIDTH / 2, clientY: PET_HEIGHT / 2, near: false })
}

function dragTick() {
  dragTimer = null
  if (!dragActive || !dragCandidate || !petWindow || petWindow.isDestroyed()) return

  const cursor = screen.getCursorScreenPoint()
  const targetX = Math.round(dragCandidate.bounds.x + cursor.x - dragCandidate.cursor.x)
  const targetY = Math.round(dragCandidate.bounds.y + cursor.y - dragCandidate.cursor.y)
  const [currentX, currentY] = petWindow.getPosition()
  if (currentX !== targetX || currentY !== targetY) {
    petWindow.setBounds({
      x: targetX,
      y: targetY,
      width: PET_WIDTH,
      height: PET_HEIGHT,
    }, false)
  }
  dragTimer = setTimeout(dragTick, 16)
}

function primePetDrag() {
  if (!petWindow || petWindow.isDestroyed()) return
  dragCandidate = {
    bounds: petWindow.getBounds(),
    cursor: screen.getCursorScreenPoint(),
  }
}

function startPetDrag() {
  if (!petWindow || petWindow.isDestroyed()) return
  if (!dragCandidate) primePetDrag()
  dragActive = true
  lastCursor = null
  lastCursorNear = false
  sendToWindow(petWindow, 'cursor:move', {
    clientX: PET_WIDTH / 2,
    clientY: PET_HEIGHT / 2,
    near: false,
  })
  if (!dragTimer) dragTick()
}

function endPetDrag() {
  const wasActive = dragActive
  dragActive = false
  dragCandidate = null
  if (dragTimer) clearTimeout(dragTimer)
  dragTimer = null
  if (!petWindow || petWindow.isDestroyed()) return

  if (wasActive) {
    const bounds = petWindow.getBounds()
    const position = safePetPosition(bounds.x, bounds.y)
    petWindow.setBounds({
      x: position.x,
      y: position.y,
      width: PET_WIDTH,
      height: PET_HEIGHT,
    }, false)
    persistPetPosition()
  }
  lastCursor = null
  if (!appIsQuitting) startCursorTracking()
}

function resetPetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return false
  const position = defaultPetPosition()
  petWindow.setPosition(position.x, position.y, true)
  persistPetPosition()
  return true
}

function setupIPC() {
  ipcMain.handle('state:get-snapshot', () => getSnapshot())
  ipcMain.handle('settings:update', (_event, patch) => updatePreferences(patch))
  ipcMain.handle('settings:reset', () => resetPreferences())
  ipcMain.handle('model:select', (_event, modelId) => ({ ok: selectModel(modelId), snapshot: getSnapshot() }))
  ipcMain.handle('window:reset-pet-position', () => resetPetPosition())

  ipcMain.on('window:open-settings', (_event, section) => openSettings(section))
  ipcMain.on('window:settings-close', () => settingsWindow && settingsWindow.close())
  ipcMain.on('window:settings-minimize', () => settingsWindow && settingsWindow.minimize())
  ipcMain.on('app:quit', () => app.quit())
  ipcMain.on('pet:show-context-menu', showPetContextMenu)

  ipcMain.on('pet:set-mouse-capture', (_event, capture) => {
    if (!petWindow || petWindow.isDestroyed()) return
    if (getPreferences().interactionMode === 'locked') {
      petWindow.setIgnoreMouseEvents(true, { forward: true })
      return
    }
    petWindow.setIgnoreMouseEvents(!capture, { forward: true })
  })

  ipcMain.on('pet:drag-prime', primePetDrag)
  ipcMain.on('pet:drag-start', startPetDrag)
  ipcMain.on('pet:drag-end', endPetDrag)

  ipcMain.on('model:report-status', (_event, status) => {
    if (!status || typeof status !== 'object') return
    runtimeStatus = {
      phase: ['starting', 'loading', 'ready', 'error', 'empty'].includes(status.phase) ? status.phase : 'error',
      modelId: typeof status.modelId === 'string' ? status.modelId : '',
      message: typeof status.message === 'string' ? status.message.slice(0, 160) : '',
    }
    broadcastState('runtime-status')
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  migrateStore()
  setupIPC()
  createPetWindow()
  createTray()
  applyPreferences()
  startCursorTracking()

  if (!getPreferences().onboardingSeen) openSettings('characters')
})

app.on('second-instance', () => openSettings())

app.on('before-quit', () => {
  appIsQuitting = true
  endPetDrag()
  stopCursorTracking()
  if (positionSaveTimer) clearTimeout(positionSaveTimer)
  persistPetPosition()
})

app.on('window-all-closed', () => {})
