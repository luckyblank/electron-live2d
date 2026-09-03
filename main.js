const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } = require('electron')
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

// 旧版本（中文产品名）数据迁移到新英文名目录
const legacyUserData = path.join(app.getPath('appData'), 'Live2D 桌面伙伴')
const currentUserData = app.getPath('userData')
if (legacyUserData !== currentUserData && fs.existsSync(legacyUserData) && !fs.existsSync(path.join(currentUserData, 'config.json'))) {
  try {
    for (const entry of ['config.json', 'covers', 'models']) {
      const from = path.join(legacyUserData, entry)
      const to = path.join(currentUserData, entry)
      if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true })
    }
  } catch (error) {
    console.warn('Legacy user data migration failed:', error.message)
  }
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
let coversCache = null
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
let cursorInsideWindow = false
let petShownOnce = false
let petOffScreen = false
let petLastPosition = null
const HIDDEN_X = -10000
const HIDDEN_Y = -10000
const UPDATE_MANIFEST_URL = 'https://qny.luckyblank.cn/live2d-pet/latest.yml'
let lastUpdateCheck = null

function compareVersions(a, b) {
  const partsA = String(a).split('.').map(Number)
  const partsB = String(b).split('.').map(Number)
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index++) {
    const delta = (partsA[index] || 0) - (partsB[index] || 0)
    if (delta !== 0) return delta
  }
  return 0
}

function clamp(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

// 用户自行添加模型的主目录：应用数据目录（卸载/更新不会删除）。
// 另外兼容扫描安装目录下的 models 文件夹（便携式放法）。
function userModelsDir() {
  return path.join(app.getPath('userData'), 'models')
}

function modelDirectories() {
  const roots = [path.join(__dirname, 'static', 'models')]
  // 安装目录 models（可选），保持兼容
  const base = app.isPackaged ? path.dirname(process.execPath) : __dirname
  const installRoot = path.join(base, 'models')
  if (fs.existsSync(installRoot)) roots.push(installRoot)
  // 应用数据目录 models（主目录）
  const userRoot = userModelsDir()
  if (!fs.existsSync(userRoot)) {
    try { fs.mkdirSync(userRoot, { recursive: true }) } catch (error) { /* 目录不可写时忽略 */ }
  }
  if (fs.existsSync(userRoot)) roots.push(userRoot)
  return roots
}

function listModels() {
  if (modelsCache) return modelsCache

  // 用户目录优先，同名模型允许覆盖内置模型
  const byId = new Map()
  for (const root of modelDirectories().slice().reverse()) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '_repo' || byId.has(entry.name)) continue
      const directory = path.join(root, entry.name)
      try {
        const files = fs.readdirSync(directory)
        const descriptor = files.find(file => file.toLowerCase().endsWith('.model3.json'))
        const archive = files.find(file => file.toLowerCase().endsWith('.zip'))
        const source = descriptor || archive
        if (!source) continue
        byId.set(entry.name, {
          id: entry.name,
          name: entry.name,
          path: pathToFileURL(path.join(directory, source)).href,
          format: descriptor ? 'folder' : 'zip',
          status: 'ready',
        })
      } catch (error) {
        console.warn(`Skipping unreadable model directory ${entry.name}:`, error.message)
      }
    }
  }

  modelsCache = [...byId.values()].sort((a, b) => {
    if (a.id === 'hiyori') return -1
    if (b.id === 'hiyori') return 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  return modelsCache
}

function refreshModels() {
  modelsCache = null
  return listModels()
}

function coversDir() {
  return path.join(app.getPath('userData'), 'covers')
}

function cachedCovers() {
  if (coversCache) return coversCache
  const map = {}
  try {
    const dir = coversDir()
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (file.toLowerCase().endsWith('.png')) {
          map[file.slice(0, -4)] = pathToFileURL(path.join(dir, file)).href
        }
      }
    }
  } catch (error) {
    console.warn('Cover cache scan failed:', error.message)
  }
  coversCache = map
  return map
}

function requestMissingCovers() {
  if (!petWindow || petWindow.isDestroyed() || petWindow.webContents.isDestroyed()) return
  const covers = cachedCovers()
  const missing = listModels()
    .filter(model => !covers[model.id])
    .map(model => ({ id: model.id, path: model.path }))
  if (missing.length) sendToWindow(petWindow, 'covers:request', missing)
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
    covers: cachedCovers(),
    modelsFolder: userModelsDir(),
    currentModelId: current ? current.id : '',
    preferences: getPreferences(),
    runtime: {
      ...runtimeStatus,
      paused: animationPaused,
      petVisible: Boolean(petWindow && !petWindow.isDestroyed() && !petOffScreen),
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

// 常用位置预设：以宠物当前所在显示器为基准。
// 锚定的是"角色视觉中心"（窗口中心）贴近屏幕角，
// 而不是窗口矩形对齐角——窗口是透明的，角色才是用户看到的东西。
const POSITION_PRESETS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']
const CORNER_ANCHOR_MARGIN = 24
// 角色在窗口内的包围盒（局部 DIP），由渲染进程按渲染蒙版上报
let characterBounds = null

function movePetToPreset(preset) {
  if (!petWindow || petWindow.isDestroyed()) return false
  const current = petWindow.getPosition()
  const display = screen.getDisplayNearestPoint({ x: current[0], y: current[1] })
  const area = display.workArea
  const m = CORNER_ANCHOR_MARGIN
  // 角色包围盒（窗口局部 DIP）；尚未上报时用窗口中心近似
  const box = characterBounds || {
    x: Math.round(PET_WIDTH * 0.2),
    y: Math.round(PET_HEIGHT * 0.17),
    width: Math.round(PET_WIDTH * 0.6),
    height: Math.round(PET_HEIGHT * 0.8),
  }
  // 各预设中角色包围盒左上角的目标位置
  const anchors = {
    'top-left': { x: area.x + m, y: area.y + m },
    'top-right': { x: area.x + area.width - m - box.width, y: area.y + m },
    'bottom-left': { x: area.x + m, y: area.y + area.height - m - box.height },
    'bottom-right': { x: area.x + area.width - m - box.width, y: area.y + area.height - m - box.height },
    center: {
      x: area.x + Math.round((area.width - box.width) / 2),
      y: area.y + Math.round((area.height - box.height) / 2),
    },
  }
  const target = anchors[preset] || anchors['bottom-right']
  // 窗口左上角 = 目标 - 包围盒在窗口内的偏移，角色整体落在屏幕内
  petWindow.setPosition(Math.round(target.x - box.x), Math.round(target.y - box.y), false)
  persistPetPosition()
  return true
}

function safePetPosition(savedX, savedY) {
  const fallback = defaultPetPosition()
  const point = {
    x: Number.isFinite(savedX) ? savedX : fallback.x,
    y: Number.isFinite(savedY) ? savedY : fallback.y,
  }
  const display = screen.getDisplayNearestPoint(point)
  const area = display.workArea
  // 允许窗口伸出屏幕边缘（角色贴角摆放），但保证至少 80px 可见可抓
  return {
    x: Math.min(Math.max(point.x, area.x - PET_WIDTH + PET_VISIBLE_MARGIN), area.x + area.width + PET_WIDTH - PET_VISIBLE_MARGIN),
    y: Math.min(Math.max(point.y, area.y - PET_HEIGHT + PET_VISIBLE_MARGIN), area.y + area.height + PET_HEIGHT - PET_VISIBLE_MARGIN),
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
  // 注意：不使用 forward 选项 —— Electron 37 上 forward 钩子会泄漏，
  // 反复切换后 setIgnoreMouseEvents(false) 无法清除穿透样式
  petWindow.setIgnoreMouseEvents(true)

  petWindow.once('ready-to-show', () => {
    // 首次启动（引导未完成）时先隐藏宠物，完成引导后再显示
    if (petWindow && !petWindow.isDestroyed() && getPreferences().onboardingSeen) petWindow.showInactive()
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
    petShownOnce = true
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
    // Windows 失焦时可能给透明窗口重绘出一条残留标题栏
    // (electron/electron#47440)，重置背景色强制重绘将其清除。
    petWindow.setBackgroundColor('#00000000')
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
  requestMissingCovers()
}

function togglePetVisibility() {
  if (!petWindow || petWindow.isDestroyed()) return
  // 不用 hide()/show()：Windows 上隐藏后再显示会弄坏渲染进程的
  // 输入子窗口（窗口能收到鼠标但网页收不到），改为移到屏幕外。
  if (!petOffScreen) {
    petLastPosition = petWindow.getPosition()
    petWindow.setPosition(HIDDEN_X, HIDDEN_Y, false)
    petOffScreen = true
    stopCursorTracking()
    broadcastState('pet-visibility')
  } else if (!getPreferences().onboardingSeen) {
    // 引导未完成时不直接显示宠物，引导用户先完成引导
    openSettings('characters')
  } else {
    const [x, y] = petLastPosition || [undefined, undefined]
    const position = safePetPosition(x, y)
    petWindow.setPosition(position.x, position.y, false)
    petOffScreen = false
    startCursorTracking()
    broadcastState('pet-visibility')
  }
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
      petWindow.setIgnoreMouseEvents(true)
    }
  }
  syncWindowLevels()
  applyLoginPreference(preferences.launchAtLogin)
  if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
    // 光标轮询还承担窗口矩形命中检测（交互引导），光标跟随关闭时也要继续
    startCursorTracking()
    if (preferences.cursorFollow !== 'near') {
      sendToWindow(petWindow, 'cursor:move', { clientX: PET_WIDTH / 2, clientY: PET_HEIGHT / 2, near: false })
    }
  }
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

  // 完成首次引导后显示宠物
  if (patch.onboardingSeen && !petShownOnce && petWindow && !petWindow.isDestroyed()) {
    petWindow.showInactive()
  }

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
      label: petOffScreen ? '显示宠物' : '隐藏宠物',
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
        requestMissingCovers()
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
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return

  const preferences = getPreferences()
  try {
    const point = screen.getCursorScreenPoint()
    const bounds = petWindow.getBounds()
    const near = distanceToBounds(point, bounds) <= CURSOR_NEAR_DISTANCE
    const moved = !lastCursor || Math.abs(point.x - lastCursor.x) >= 3 || Math.abs(point.y - lastCursor.y) >= 3

    // 鼠标进入/离开窗口矩形时立即切换穿透状态，消除按下空档。
    // 窗口内的角色命中细分由渲染进程维护（迟滞 + 离开重置）。
    const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width &&
      point.y >= bounds.y && point.y < bounds.y + bounds.height
    if (inside !== cursorInsideWindow) {
      cursorInsideWindow = inside
      if (preferences.interactionMode !== 'locked') {
        petWindow.setIgnoreMouseEvents(!inside)
      }
    }

    // 光标位置经本轮询通道送渲染进程（OS 鼠标事件在穿透态下不可靠送达）
    const sendFollow = preferences.cursorFollow === 'near' && (moved || near !== lastCursorNear)
    if (sendFollow || inside) {
      lastCursor = point
      lastCursorNear = near
      sendToWindow(petWindow, 'cursor:move', {
        clientX: point.x - bounds.x,
        clientY: point.y - bounds.y,
        near,
        inside,
      })
    }
    // 近窗口时高频轮询，把"进入窗口→可交互"的延迟压到最低
    const interval = near ? 30 : 200
    cursorTimer = setTimeout(cursorTick, interval)
  } catch (error) {
    cursorTimer = setTimeout(cursorTick, 500)
  }
}

function startCursorTracking() {
  if (cursorTimer || !petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return
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
  return movePetToPreset('bottom-right')
}

function setupIPC() {
  ipcMain.handle('update:check', async () => {
    try {
      const response = await fetch(UPDATE_MANIFEST_URL, {
        headers: { Accept: 'text/plain, text/yaml, */*' },
      })
      if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
      const text = await response.text()
      const versionMatch = text.match(/^version:\s*(\S+)/m)
      const pathMatch = text.match(/^path:\s*(\S+)/m)
      if (!versionMatch) return { ok: false, reason: '更新清单格式无效' }
      const latest = versionMatch[1].replace(/^v/, '')
      const current = app.getVersion()
      const hasUpdate = compareVersions(latest, current) > 0
      const file = pathMatch ? pathMatch[1] : ''
      const url = hasUpdate && file ? new URL(file, UPDATE_MANIFEST_URL).href : ''
      // 发布说明：与 latest.yml 同目录的 release-notes-<版本>.md
      let releaseNotes = ''
      if (hasUpdate) {
        try {
          const notesUrl = new URL(`release-notes-${latest}.md`, UPDATE_MANIFEST_URL).href
          const notesResponse = await fetch(notesUrl, { headers: { Accept: 'text/markdown, text/plain, */*' } })
          if (notesResponse.ok) releaseNotes = (await notesResponse.text()).slice(0, 4000)
        } catch (error) {
          releaseNotes = ''
        }
      }
      lastUpdateCheck = { ok: true, hasUpdate, current, latest, url, releaseNotes }
      return lastUpdateCheck
    } catch (error) {
      return { ok: false, reason: error.message }
    }
  })

  ipcMain.on('update:open-download', () => {
    if (lastUpdateCheck && lastUpdateCheck.ok && lastUpdateCheck.url) {
      shell.openExternal(lastUpdateCheck.url)
    }
  })

  ipcMain.handle('state:get-snapshot', () => getSnapshot())
  ipcMain.handle('settings:update', (_event, patch) => updatePreferences(patch))
  ipcMain.handle('settings:reset', () => resetPreferences())
  ipcMain.handle('model:select', (_event, modelId) => ({ ok: selectModel(modelId), snapshot: getSnapshot() }))
  ipcMain.handle('window:reset-pet-position', () => resetPetPosition())
  ipcMain.handle('window:move-pet', (_event, preset) => movePetToPreset(POSITION_PRESETS.includes(preset) ? preset : 'bottom-right'))
  ipcMain.handle('window:open-models-folder', () => shell.openPath(userModelsDir()).then(() => true).catch(() => false))

  ipcMain.on('window:open-settings', (_event, section) => openSettings(section))
  ipcMain.on('window:settings-close', () => settingsWindow && settingsWindow.close())
  ipcMain.on('window:settings-minimize', () => settingsWindow && settingsWindow.minimize())
  ipcMain.on('app:quit', () => app.quit())
  ipcMain.on('pet:show-context-menu', showPetContextMenu)

  ipcMain.on('pet:set-mouse-capture', (_event, capture) => {
    if (!petWindow || petWindow.isDestroyed()) return
    if (getPreferences().interactionMode === 'locked') {
      petWindow.setIgnoreMouseEvents(true)
      return
    }
    petWindow.setIgnoreMouseEvents(!capture)
  })

  ipcMain.on('pet:drag-prime', primePetDrag)
  ipcMain.on('pet:drag-start', startPetDrag)
  ipcMain.on('pet:drag-end', endPetDrag)

  ipcMain.on('pet:hit-bounds', (_event, bounds) => {
    if (
      bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) &&
      Number.isFinite(bounds.width) && Number.isFinite(bounds.height) &&
      bounds.width > 0 && bounds.height > 0
    ) {
      characterBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    } else {
      characterBounds = null
    }
  })

  ipcMain.on('pet:save-cover', (_event, modelId, dataURL) => {
    if (typeof modelId !== 'string' || !/^[\w.-]+$/.test(modelId) || typeof dataURL !== 'string') return
    const match = dataURL.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
    if (!match) return
    try {
      const dir = coversDir()
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${modelId}.png`), Buffer.from(match[1], 'base64'))
      coversCache = null
      broadcastState('cover-ready')
    } catch (error) {
      console.warn('Cover save failed:', error.message)
    }
  })

  ipcMain.on('model:report-status', (_event, status) => {
    if (!status || typeof status !== 'object') return
    runtimeStatus = {
      phase: ['starting', 'loading', 'ready', 'error', 'empty'].includes(status.phase) ? status.phase : 'error',
      modelId: typeof status.modelId === 'string' ? status.modelId : '',
      message: typeof status.message === 'string' ? status.message.slice(0, 160) : '',
    }
    broadcastState('runtime-status')
    if (runtimeStatus.phase === 'ready') requestMissingCovers()
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

// 宠物窗口本身不可聚焦，残留标题栏通常在设置窗口失焦时出现。
// 任一应用窗口失焦时重绘宠物窗口背景，清除 Windows 画出的白条。
app.on('browser-window-blur', () => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setBackgroundColor('#00000000')
  }
})

app.on('before-quit', () => {
  appIsQuitting = true
  endPetDrag()
  stopCursorTracking()
  if (positionSaveTimer) clearTimeout(positionSaveTimer)
  persistPetPosition()
})

app.on('window-all-closed', () => {})
