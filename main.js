const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell, safeStorage, dialog } = require('electron')
const fs = require('fs')
const { Readable } = require('stream')
const path = require('path')
const { pathToFileURL } = require('url')
const Store = require('electron-store')
const { createAIPluginManager } = require('./ai/plugin-manager')
const { inspectModelArchive, inspectModelDirectory } = require('./model-inspector')

const PET_WIDTH = 400
const PET_HEIGHT = 600
const SETTINGS_WIDTH = 430
const SETTINGS_HEIGHT = 670
const COVER_CACHE_SUFFIX = '.centered-v2.png'
const POSITION_SAVE_DELAY = 180
const CURSOR_NEAR_DISTANCE = 220
const PET_VISIBLE_MARGIN = 80
const CHAT_GREETING_MAX_LENGTH = 200
const PET_INTERACTIONS = [
  { label: '打个招呼', kind: 'greet' },
  { label: '摸摸头', kind: 'head' },
  { label: '夸夸她', kind: 'praise' },
  { label: '投喂点心', kind: 'snack' },
  { label: '随机互动', kind: 'random' },
]

const preferenceDefaults = {
  interactionMode: 'smart',
  cursorFollow: 'near',
  effects: 'subtle',
  idleEnabled: true,
  qualityMode: 'auto',
  alwaysOnTop: true,
  launchAtLogin: false,
  reducedMotion: 'system',
  onboardingSeen: false,
  backgroundDetection: false,
  settingsPetBackground: false,
  settingsTheme: 'glass',
  chatGreeting: '你好呀～今天想聊点什么？',
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
    for (const entry of ['config.json', 'covers', 'models', 'plugins', 'tts']) {
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
    modelScales: {},
    modelNicknames: {},
    ignoredUpdateVersion: '',
    aiPlugins: { installed: [], activeIds: { chat: '', tts: '' }, settings: {}, secrets: {}, credentialPreferences: {} },
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
let dragOutsideSince = null // 拖拽中光标离开窗口的起始时刻（失联看门狗）
const DRAG_OUTSIDE_TIMEOUT_MS = 150
let appIsQuitting = false
let animationPaused = false
let runtimeStatus = { phase: 'starting', modelId: '', message: '正在启动' }
let lastCursor = null
let lastCursorNear = false
let petShownOnce = false
let petOffScreen = false
let petLastPosition = null
let petChatOpen = false
let speechBubbleBounds = null
let aiPluginManager = null
const UPDATE_MANIFEST_URL = 'https://qny.luckyblank.cn/live2d-pet/latest.yml'
let lastUpdateCheck = null
let lastDownloadedPath = null
let updateDownloadController = null

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

// 模型目录两个来源：
// 1. 项目 models/（内置，随安装包发货，开发时是项目根目录，打包后在 app.asar 内）
// 2. 应用数据目录 models（用户自行添加，卸载/更新不会删除）
function userModelsDir() {
  return path.join(app.getPath('userData'), 'models')
}

// 语音文件与用户 models 同属应用数据目录，应用升级或覆盖安装不会清理。
function userTtsDir() {
  const directory = path.join(app.getPath('userData'), 'tts')
  if (!fs.existsSync(directory)) {
    try { fs.mkdirSync(directory, { recursive: true }) } catch (error) { /* 首次合成时会返回具体错误 */ }
  }
  return directory
}

function modelDirectories() {
  const roots = [path.join(__dirname, 'models')]
  // 安装目录 models（可选），便携式放法
  const base = app.isPackaged ? path.dirname(process.execPath) : __dirname
  const installRoot = path.join(base, 'models')
  if (fs.existsSync(installRoot)) roots.push(installRoot)
  // 应用数据目录 models（用户目录优先，同名模型可覆盖内置）
  const userRoot = userModelsDir()
  if (!fs.existsSync(userRoot)) {
    try { fs.mkdirSync(userRoot, { recursive: true }) } catch (error) { /* 目录不可写时忽略 */ }
  }
  if (fs.existsSync(userRoot)) roots.push(userRoot)
  return roots
}

// AI 插件目录与 models 相同的逻辑：主目录在应用数据目录（卸载/更新不会删除），
// 同时兼容扫描安装目录下的 plugins 文件夹（便携式放法）。
function userPluginsDir() {
  return path.join(app.getPath('userData'), 'plugins')
}

function pluginDirectories() {
  const roots = [path.join(__dirname, 'plugins')]
  // 安装目录 plugins（可选），保持兼容
  const base = app.isPackaged ? path.dirname(process.execPath) : __dirname
  const installRoot = path.join(base, 'plugins')
  if (fs.existsSync(installRoot)) roots.push(installRoot)
  // 应用数据目录 plugins（主目录）
  const userRoot = userPluginsDir()
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
        const inspection = inspectModelDirectory(directory)
        if (!inspection) continue
        byId.set(entry.name, {
          id: entry.name,
          name: entry.name,
          path: pathToFileURL(path.join(directory, inspection.source)).href,
          format: inspection.format,
          cubismVersion: inspection.cubismVersion,
          status: inspection.status,
          statusMessage: inspection.statusMessage,
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
        if (file.toLowerCase().endsWith(COVER_CACHE_SUFFIX)) {
          map[file.slice(0, -COVER_CACHE_SUFFIX.length)] = pathToFileURL(path.join(dir, file)).href
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
    .filter(model => model.status === 'ready' && !covers[model.id])
    .map(model => ({ id: model.id, path: model.path }))
  if (missing.length) sendToWindow(petWindow, 'covers:request', missing)
}

function selectedModel() {
  const models = listModels().filter(model => model.status === 'ready')
  const currentId = store.get('currentModelId')
  return models.find(model => model.id === currentId) || models[0] || null
}

function modelNickname(modelId) {
  const nicknames = store.get('modelNicknames')
  if (!nicknames || typeof nicknames !== 'object' || Array.isArray(nicknames)) return ''
  const value = nicknames[modelId]
  return typeof value === 'string' ? value.trim().slice(0, 24) : ''
}

function modelDisplayName(model) {
  return model ? (modelNickname(model.id) || model.name) : '伙伴'
}

function modelsWithNicknames() {
  return listModels().map(model => {
    const nickname = modelNickname(model.id)
    return { ...model, nickname, displayName: nickname || model.name }
  })
}

function updateModelNickname(modelId, value) {
  const model = listModels().find(item => item.id === modelId)
  if (!model) throw new Error('找不到这个角色')
  const nickname = typeof value === 'string'
    ? [...value].filter(character => {
        const code = character.charCodeAt(0)
        return code > 31 && code !== 127
      }).join('').trim().slice(0, 24)
    : ''
  const nicknames = store.get('modelNicknames')
  const next = nicknames && typeof nicknames === 'object' && !Array.isArray(nicknames)
    ? { ...nicknames }
    : {}
  if (nickname) next[modelId] = nickname
  else delete next[modelId]
  store.set('modelNicknames', next)
  updateTrayMenu()
  broadcastState('model-nickname-updated')
  return getSnapshot()
}

function migrateStore() {
  const previousVersion = Number(store.get('schemaVersion')) || 1
  const models = listModels()
  const readyModels = models.filter(model => model.status === 'ready')
  const oldModelPath = store.get('currentModel')
  if (!store.get('currentModelId') && oldModelPath) {
    const match = models.find(model => model.path === oldModelPath)
    if (match) store.set('currentModelId', match.id)
  }

  if (!selectedModel() && readyModels.length) store.set('currentModelId', readyModels[0].id)
  if (!store.has('launchAtLogin') && typeof store.get('autoLaunch') === 'boolean') {
    store.set('launchAtLogin', store.get('autoLaunch'))
  }

  if (previousVersion < 2) {
    // Version 1 could capture the entire transparent window. Version 2 always
    // starts in the safer mode where only the visible character is interactive.
    store.set('interactionMode', 'smart')
    if (oldModelPath) store.set('onboardingSeen', true)
  }
  if (previousVersion < 3) {
    // 尺寸从 v3 起按模型保存。旧版全局 scale 不迁移，确保每个模型
    // 第一次使用均从 100% 开始。
    store.set('modelScales', {})
  }
  store.set('schemaVersion', 3)
}

function modelScale(modelId) {
  const scales = store.get('modelScales')
  if (!modelId || !scales || typeof scales !== 'object' || Array.isArray(scales)) return 1
  return clamp(scales[modelId], 0.5, 2, 1)
}

function storeModelScale(modelId, value) {
  if (!modelId) return
  const stored = store.get('modelScales')
  const scales = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {}
  const scale = clamp(value, 0.5, 2, modelScale(modelId))
  if (Math.abs(scale - 1) < 0.001) delete scales[modelId]
  else scales[modelId] = scale
  store.set('modelScales', scales)
}

function updateModelScale(modelId, value) {
  const model = listModels().find(item => item.id === modelId && item.status === 'ready')
  if (!model) throw new Error('找不到这个角色')
  storeModelScale(model.id, value)
  if (selectedModel()?.id === model.id) applyPreferences()
  broadcastState('model-scale-updated')
  return getSnapshot()
}

function getPreferences() {
  const interactionMode = store.get('interactionMode')
  const cursorFollow = store.get('cursorFollow')
  const effects = store.get('effects')
  const qualityMode = store.get('qualityMode')
  const reducedMotion = store.get('reducedMotion')
  const storedChatGreeting = store.get('chatGreeting')

  return {
    scale: modelScale(selectedModel()?.id),
    interactionMode: ['smart', 'locked'].includes(interactionMode) ? interactionMode : 'smart',
    cursorFollow: ['near', 'off'].includes(cursorFollow) ? cursorFollow : 'near',
    effects: ['subtle', 'off'].includes(effects) ? effects : 'subtle',
    idleEnabled: store.get('idleEnabled') !== false,
    qualityMode: ['auto', 'eco', 'high'].includes(qualityMode) ? qualityMode : 'auto',
    alwaysOnTop: store.get('alwaysOnTop') !== false,
    launchAtLogin: store.get('launchAtLogin') === true,
    reducedMotion: ['system', 'on', 'off'].includes(reducedMotion) ? reducedMotion : 'system',
    onboardingSeen: store.get('onboardingSeen') === true,
    backgroundDetection: store.get('backgroundDetection') === true,
    settingsPetBackground: store.get('settingsPetBackground') === true,
    settingsTheme: ['glass', 'healing'].includes(store.get('settingsTheme'))
      ? store.get('settingsTheme')
      : preferenceDefaults.settingsTheme,
    chatGreeting: typeof storedChatGreeting === 'string'
      ? storedChatGreeting.trim().slice(0, CHAT_GREETING_MAX_LENGTH)
      : preferenceDefaults.chatGreeting,
  }
}

function getSnapshot() {
  const current = selectedModel()
  return {
    appVersion: app.getVersion(),
    models: modelsWithNicknames(),
    covers: cachedCovers(),
    modelsFolder: userModelsDir(),
    pluginsFolder: userPluginsDir(),
    ttsFolder: userTtsDir(),
    currentModelId: current ? current.id : '',
    preferences: getPreferences(),
    ai: aiPluginManager
      ? aiPluginManager.getSnapshot()
      : {
          plugins: [],
          activePluginIds: { chat: '', tts: '' },
          activePluginId: '',
          readyByCapability: { chat: false, tts: false },
          ready: false,
          ttsDirectory: userTtsDir(),
        },
    runtime: {
      ...runtimeStatus,
      paused: animationPaused,
      petVisible: Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible() && !petOffScreen),
    },
  }
}

function sendToWindow(target, channel, payload) {
  if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
    target.webContents.send(channel, payload)
  }
}

function shouldCaptureSettingsPetBackground() {
  return Boolean(
    getPreferences().settingsPetBackground &&
    settingsWindow && !settingsWindow.isDestroyed() &&
    settingsWindow.isVisible() && !settingsWindow.isMinimized()
  )
}

function syncSettingsPetBackgroundCapture() {
  const active = shouldCaptureSettingsPetBackground()
  sendToWindow(petWindow, 'settings:pet-background-capture', active)
  if (!active) sendToWindow(settingsWindow, 'settings:pet-background-frame', null)
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

function interactionRegionFromBounds(bounds = characterBounds) {
  const fallback = { x: 24, y: 0, width: PET_WIDTH - 48, height: PET_HEIGHT }
  if (
    !bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) ||
    bounds.width <= 0 || bounds.height <= 0
  ) return fallback

  const padding = 32
  const left = Math.max(0, Math.floor(bounds.x - padding))
  const top = Math.max(0, Math.floor(bounds.y - padding))
  const right = Math.min(PET_WIDTH, Math.ceil(bounds.x + bounds.width + padding))
  const bottom = Math.min(PET_HEIGHT, Math.ceil(bounds.y + bounds.height + padding))
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

function applyPetInteractionRegion() {
  if (!petWindow || petWindow.isDestroyed()) return
  if (petChatOpen) {
    petWindow.setIgnoreMouseEvents(false)
    if (['win32', 'linux'].includes(process.platform)) {
      try {
        petWindow.setShape([{ x: 0, y: 0, width: PET_WIDTH, height: PET_HEIGHT }])
      } catch (error) {
        console.warn('Failed to expand pet interaction region:', error.message)
      }
    }
    return
  }
  const preferences = getPreferences()
  const locked = preferences.interactionMode === 'locked'
  petWindow.setIgnoreMouseEvents(locked)
  if (locked || !['win32', 'linux'].includes(process.platform)) return

  try {
    // 背景检测开启时，整个透明窗口都是可抓取范围；关闭时恢复角色
    // 包围盒裁剪，让远离角色的透明背景继续穿透到桌面。
    const regions = [preferences.backgroundDetection
      ? { x: 0, y: 0, width: PET_WIDTH, height: PET_HEIGHT }
      : interactionRegionFromBounds()]
    if (speechBubbleBounds) regions.push(speechBubbleBounds)
    petWindow.setShape(regions)
  } catch (error) {
    console.warn('Failed to apply pet interaction region:', error.message)
  }
}

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
  placePetWindow(target.x - box.x, target.y - box.y)
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

function persistPetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return
  const [windowX, windowY] = petWindow.getPosition()
  store.set({ windowX, windowY })
}

function placePetWindow(x, y) {
  if (!petWindow || petWindow.isDestroyed()) return
  // Windows 分数 DPI 缩放（125%/150%）下，对透明无边框窗口反复调用
  // setPosition 会让系统读回的窗口尺寸每次 +1 DIP 不断累积（实测 125%
  // 缩放连调 30 次 setPosition，窗口宽从 401 涨到 429），拖动中视口持续
  // 变大，表现为"宠物越拖越偏"。setBounds 写入完整绝对几何，读回误差
  // 有界（≤1 DIP 常量），不再累积。
  petWindow.setBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: PET_WIDTH,
    height: PET_HEIGHT,
  }, false)
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
  petWindow.webContents.on('did-finish-load', syncSettingsPetBackgroundCapture)
  applyPetInteractionRegion()

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
  settingsWindow.webContents.on('did-finish-load', syncSettingsPetBackgroundCapture)
  settingsWindow.webContents.on('console-message', details => {
    const { level, message, lineNumber, sourceId } = details
    console.log(`Settings renderer [${level}] ${sourceId}:${lineNumber} -> ${message}`)
  })

  settingsWindow.on('show', () => {
    syncWindowLevels()
    broadcastState('settings-opened')
    syncSettingsPetBackgroundCapture()
  })
  settingsWindow.on('hide', () => {
    syncWindowLevels()
    syncSettingsPetBackgroundCapture()
  })
  settingsWindow.on('minimize', syncSettingsPetBackgroundCapture)
  settingsWindow.on('restore', syncSettingsPetBackgroundCapture)
  settingsWindow.on('closed', () => {
    settingsWindow = null
    syncWindowLevels()
    syncSettingsPetBackgroundCapture()
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
  // Windows 上 hide()/show() 可能破坏透明窗口的输入子窗口，而把窗口
  // 移到极远坐标又会触发 Chromium 遮挡优化，导致 WebGL 画布恢复后透明。
  // 窗口留在原位，仅切换透明度与鼠标命中，可同时保住输入和渲染上下文。
  if (!petOffScreen) {
    setPetChatOpen(false)
    petLastPosition = petWindow.getPosition()
    petOffScreen = true
    stopCursorTracking()
    petWindow.setIgnoreMouseEvents(true)
    broadcastState('pet-visibility')
    petWindow.setOpacity(0)
  } else if (!getPreferences().onboardingSeen) {
    // 引导未完成时不直接显示宠物，引导用户先完成引导
    openSettings('characters')
  } else {
    const [x, y] = petLastPosition || [undefined, undefined]
    const position = safePetPosition(x, y)
    placePetWindow(position.x, position.y)
    petWindow.setOpacity(1)
    petOffScreen = false
    applyPetInteractionRegion()
    syncWindowLevels()
    startCursorTracking()
    broadcastState('pet-visibility')
  }
  updateTrayMenu()
}

function setPetChatOpen(open) {
  const next = Boolean(open && aiPluginManager && aiPluginManager.getSnapshot().ready)
  petChatOpen = next
  applyPetInteractionRegion()
  sendToWindow(petWindow, 'ai:chat-visibility', next)
  updateTrayMenu()
}

function openAIChat() {
  const ai = aiPluginManager ? aiPluginManager.getSnapshot() : null
  if (!ai || !ai.ready) {
    openSettings('ai')
    return
  }
  if (!getPreferences().onboardingSeen) {
    openSettings('ai')
    return
  }
  if (petOffScreen) togglePetVisibility()
  if (!petWindow || petWindow.isDestroyed() || petOffScreen) return
  setPetChatOpen(true)
  syncWindowLevels()
  petWindow.show()
  petWindow.focus()
  petWindow.moveTop()
}

function selectModel(modelId) {
  const model = listModels().find(item => item.id === modelId)
  if (!model || model.status !== 'ready') return false
  store.set('currentModelId', model.id)
  runtimeStatus = { phase: 'loading', modelId: model.id, message: `正在加载 ${modelDisplayName(model)}` }
  updateTrayMenu()
  broadcastState('model-selected')
  syncWindowLevels()
  return true
}

function safeImportedModelId(filePath) {
  const stem = path.basename(filePath, path.extname(filePath)).trim()
  const sanitized = stem
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
  return sanitized || 'imported-model'
}

function uniqueImportedModelTarget(filePath) {
  const root = userModelsDir()
  const baseId = safeImportedModelId(filePath)
  const existingIds = new Set(listModels().map(model => model.id.toLowerCase()))
  let id = baseId
  let suffix = 2
  while (existingIds.has(id.toLowerCase()) || fs.existsSync(path.join(root, id))) {
    id = `${baseId}-${suffix++}`
  }
  return { id, directory: path.join(root, id) }
}

async function importModelZip() {
  const owner = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined
  const options = {
    title: '导入 Live2D 模型',
    properties: ['openFile'],
    filters: [{ name: 'Live2D ZIP 模型', extensions: ['zip'] }],
  }
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true }

  const sourcePath = result.filePaths[0]
  const inspection = inspectModelArchive(sourcePath)
  if (inspection.status !== 'ready') {
    return {
      ok: false,
      error: `无法导入：${inspection.statusMessage}`,
      modelStatus: inspection.status,
      cubismVersion: inspection.cubismVersion,
    }
  }

  const target = uniqueImportedModelTarget(sourcePath)
  const targetArchive = path.join(target.directory, path.basename(sourcePath))
  try {
    fs.mkdirSync(target.directory, { recursive: false })
    fs.copyFileSync(sourcePath, targetArchive, fs.constants.COPYFILE_EXCL)
  } catch (error) {
    try { fs.rmSync(target.directory, { recursive: true, force: true }) } catch (cleanupError) { /* 只清理本次新建的导入目录 */ }
    return { ok: false, error: `模型导入失败：${error.message}` }
  }

  refreshModels()
  updateTrayMenu()
  broadcastState('model-imported')
  requestMissingCovers()
  return { ok: true, modelId: target.id, snapshot: getSnapshot() }
}

function applyLoginPreference(enabled) {
  const options = { openAtLogin: enabled, path: process.execPath }
  if (!app.isPackaged && process.argv[1]) options.args = [path.resolve(process.argv[1])]
  app.setLoginItemSettings(options)
}

function applyPreferences() {
  const preferences = getPreferences()
  if (petWindow && !petWindow.isDestroyed()) {
    applyPetInteractionRegion()
  }
  syncWindowLevels()
  applyLoginPreference(preferences.launchAtLogin)
  syncSettingsPetBackgroundCapture()
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
    // 设置窗口出现时也不能把宠物降回普通窗口层级，否则切换模型期间
    // 任意普通应用都能盖住宠物。两者都置顶，再让设置窗口排在宠物之上。
    petWindow.setAlwaysOnTop(alwaysOnTop, 'floating')
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setAlwaysOnTop(alwaysOnTop && settingsVisible, 'floating')
  }
  if (alwaysOnTop && settingsVisible && petWindow && !petWindow.isDestroyed()) {
    petWindow.moveTop()
    settingsWindow.moveTop()
  }
}

function updatePreferences(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return getSnapshot()

  const currentPreferences = getPreferences()
  const allowed = {
    interactionMode: value => ['smart', 'locked'].includes(value) ? value : currentPreferences.interactionMode,
    cursorFollow: value => ['near', 'off'].includes(value) ? value : currentPreferences.cursorFollow,
    effects: value => ['subtle', 'off'].includes(value) ? value : currentPreferences.effects,
    idleEnabled: value => Boolean(value),
    qualityMode: value => ['auto', 'eco', 'high'].includes(value) ? value : currentPreferences.qualityMode,
    alwaysOnTop: value => Boolean(value),
    launchAtLogin: value => Boolean(value),
    reducedMotion: value => ['system', 'on', 'off'].includes(value) ? value : currentPreferences.reducedMotion,
    onboardingSeen: value => Boolean(value),
    backgroundDetection: value => Boolean(value),
    settingsPetBackground: value => Boolean(value),
    settingsTheme: value => ['glass', 'healing'].includes(value) ? value : currentPreferences.settingsTheme,
    chatGreeting: value => typeof value === 'string'
      ? value.trim().slice(0, CHAT_GREETING_MAX_LENGTH)
      : currentPreferences.chatGreeting,
  }

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'scale') {
      storeModelScale(selectedModel()?.id, value)
      continue
    }
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
  store.set('modelScales', {})
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

function requestPetInteraction(kind = 'random') {
  if (!petWindow || petWindow.isDestroyed()) return
  if (petOffScreen) togglePetVisibility()
  if (petOffScreen) return
  sendToWindow(petWindow, 'pet:interact', { kind })
}

function interactionMenuTemplate() {
  return PET_INTERACTIONS.map(item => ({
    label: item.label,
    click: () => requestPetInteraction(item.kind),
  }))
}

function aiMenuItem() {
  const ready = Boolean(aiPluginManager && aiPluginManager.getSnapshot().ready)
  if (!ready) {
    return {
      label: '安装 AI 对话插件…',
      click: () => openSettings('ai'),
    }
  }
  if (petChatOpen) {
    return {
      label: '关闭对话',
      click: () => setPetChatOpen(false),
    }
  }
  return {
    label: '开启对话',
    click: openAIChat,
  }
}

function buildQuickMenu() {
  const current = selectedModel()
  const preferences = getPreferences()
  return Menu.buildFromTemplate([
    aiMenuItem(),
    { label: '和我互动', submenu: interactionMenuTemplate() },
    { type: 'separator' },
    { label: animationPaused ? '继续动画' : '暂停动画', click: toggleAnimationPause },
    {
      label: '切换角色',
      submenu: listModels().filter(model => model.status === 'ready').map(model => ({
        label: modelDisplayName(model),
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
    aiMenuItem(),
    { label: '和宠物互动', submenu: interactionMenuTemplate() },
    { type: 'separator' },
    {
      label: '切换角色',
      submenu: listModels().filter(model => model.status === 'ready').map(model => ({
        label: modelDisplayName(model),
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
        if (aiPluginManager) aiPluginManager.refresh()
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

    const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width &&
      point.y >= bounds.y && point.y < bounds.y + bounds.height

    // 光标位置经本轮询通道送渲染进程，供视线跟随使用。
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

// 拖动以主进程轮询的真实光标为准（渲染进程鼠标事件经过 IPC 后有
// 延迟，快速拖动/跨显示器时坐标还会滞后甚至错乱，用它算位置会让
// 宠物追着过期目标来回跳、越拖越偏）。渲染进程只负责上报拖拽起止。
function movePetDrag() {
  if (!dragActive || !dragCandidate || !petWindow || petWindow.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  // 越窗松手/窗口失焦等场景下 mouseup 偶尔会丢失，dragActive 一直为真，
  // 宠物会追着真实光标漂移（用户常描述为"自己往一边飘"）。真正按住拖
  // 动时窗口跟随光标，光标应始终落在窗口内：光标离开窗口超过阈值即认
  // 为已经松手，主动结束拖拽，避免追光标。
  const bounds = petWindow.getBounds()
  const cursorInside = cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width &&
    cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height
  if (!cursorInside) {
    if (dragOutsideSince == null) dragOutsideSince = Date.now()
    else if (Date.now() - dragOutsideSince > DRAG_OUTSIDE_TIMEOUT_MS) {
      endPetDrag()
      return
    }
  } else {
    dragOutsideSince = null
  }

  const targetX = Math.round(dragCandidate.bounds.x + cursor.x - dragCandidate.cursor.x)
  const targetY = Math.round(dragCandidate.bounds.y + cursor.y - dragCandidate.cursor.y)
  const [currentX, currentY] = petWindow.getPosition()
  if (currentX !== targetX || currentY !== targetY) {
    // 必须走 placePetWindow（setBounds 钉住尺寸）：分数 DPI 下纯
    // setPosition 会让窗口尺寸每帧 +1 DIP 累积，越拖越偏。
    placePetWindow(targetX, targetY)
  }
}

function dragTick() {
  dragTimer = null
  if (!dragActive || !dragCandidate) return
  movePetDrag()
  dragTimer = setTimeout(dragTick, 16)
}

function primePetDrag() {
  if (!petWindow || petWindow.isDestroyed()) return
  // 上一次拖拽若因 mouseup 丢失仍处于激活（宠物在追光标），这次按下
  // 说明用户已重新抓取，先干净地结束上一次拖拽再记录新起点。
  if (dragActive) endPetDrag()
  dragCandidate = {
    bounds: petWindow.getBounds(),
    cursor: screen.getCursorScreenPoint(),
  }
}

function startPetDrag() {
  if (!petWindow || petWindow.isDestroyed()) return
  if (!dragCandidate) primePetDrag()
  dragActive = true
  dragOutsideSince = null
  lastCursor = null
  lastCursorNear = false
  sendToWindow(petWindow, 'cursor:move', {
    clientX: PET_WIDTH / 2,
    clientY: PET_HEIGHT / 2,
    near: false,
  })
  movePetDrag()
  if (!dragTimer) dragTimer = setTimeout(dragTick, 16)
}

function updatePetDrag() {
  // 渲染进程 mousemove 只作为即时触发点，位置仍由真实光标决定
  movePetDrag()
}

function endPetDrag() {
  const wasActive = dragActive
  dragActive = false
  dragCandidate = null
  dragOutsideSince = null
  if (dragTimer) clearTimeout(dragTimer)
  dragTimer = null
  if (!petWindow || petWindow.isDestroyed()) return

  if (wasActive) {
    const [windowX, windowY] = petWindow.getPosition()
    const position = safePetPosition(windowX, windowY)
    placePetWindow(position.x, position.y)
    persistPetPosition()
    // 看门狗等场景下鼠标弹起事件丢失，渲染进程可能还停留在"拖动中"
    // （模型冻结）。拖拽结束后通知它复位，复位函数全部幂等。
    sendToWindow(petWindow, 'pet:drag-aborted')
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
      lastUpdateCheck = {
        ok: true,
        hasUpdate,
        current,
        latest,
        url,
        releaseNotes,
        ignored: hasUpdate && store.get('ignoredUpdateVersion') === latest,
      }
      return lastUpdateCheck
    } catch (error) {
      return { ok: false, reason: error.message }
    }
  })

  ipcMain.on('update:ignore-version', (_event, version) => {
    if (typeof version === 'string' && version) store.set('ignoredUpdateVersion', version)
  })

  ipcMain.handle('update:download', async () => {
    const info = lastUpdateCheck
    if (!info || !info.ok || !info.hasUpdate || !info.url) return { ok: false, reason: '没有可下载的更新' }
    updateDownloadController = new AbortController()
    try {
      const response = await fetch(info.url, { signal: updateDownloadController.signal })
      if (!response.ok || !response.body) return { ok: false, reason: `HTTP ${response.status}` }
      const total = Number(response.headers.get('content-length')) || 0
      const target = path.join(app.getPath('downloads'), `Live2DCompanion-Setup-${info.latest}.exe`)
      const out = fs.createWriteStream(target)
      let received = 0
      await new Promise((resolve, reject) => {
        const stream = Readable.fromWeb(response.body)
        stream.on('data', chunk => {
          received += chunk.length
          sendToWindow(settingsWindow, 'update:progress', { received, total })
        })
        stream.pipe(out)
        out.on('finish', resolve)
        out.on('error', reject)
      })
      lastDownloadedPath = target
      return { ok: true, path: target }
    } catch (error) {
      return { ok: false, reason: error.message, cancelled: error.name === 'AbortError' }
    } finally {
      updateDownloadController = null
    }
  })

  ipcMain.on('update:cancel-download', () => {
    if (updateDownloadController) updateDownloadController.abort()
  })

  ipcMain.on('update:open-installer', () => {
    if (lastDownloadedPath && fs.existsSync(lastDownloadedPath)) {
      shell.openPath(lastDownloadedPath)
    }
  })

  ipcMain.handle('state:get-snapshot', () => getSnapshot())
  ipcMain.handle('ai:plugin-install', (_event, pluginId) => {
    try {
      const ai = aiPluginManager.install(pluginId)
      updateTrayMenu()
      broadcastState('ai-plugin-installed')
      return { ok: true, ai }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('ai:plugin-activate', (_event, pluginId, capability) => {
    try {
      const ai = aiPluginManager.activate(pluginId, capability)
      updateTrayMenu()
      broadcastState('ai-plugin-activated')
      return { ok: true, ai }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('ai:plugin-uninstall', (_event, pluginId) => {
    try {
      const ai = aiPluginManager.uninstall(pluginId)
      if (!ai.ready) setPetChatOpen(false)
      updateTrayMenu()
      broadcastState('ai-plugin-uninstalled')
      return { ok: true, ai }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('ai:plugin-configure', (_event, pluginId, config) => {
    try {
      const ai = aiPluginManager.configure(pluginId, config)
      updateTrayMenu()
      broadcastState('ai-plugin-configured')
      return { ok: true, ai }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('ai:plugin-test', async (_event, pluginId) => {
    try {
      return await aiPluginManager.test(pluginId)
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('ai:chat', async (_event, payload) => {
    try {
      const current = selectedModel()
      return await aiPluginManager.chat({
        ...(payload || {}),
        modelId: current ? current.id : '',
        companionName: current ? modelDisplayName(current) : '伙伴',
      })
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('ai:speech-synthesize', async (_event, payload) => {
    try {
      return await aiPluginManager.synthesize(payload || {})
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('ai:conversation-clear', (_event, pluginId) => {
    const current = selectedModel()
    return aiPluginManager.clearConversation(pluginId, current ? current.id : '')
  })
  ipcMain.handle('settings:update', (_event, patch) => updatePreferences(patch))
  ipcMain.handle('settings:reset', () => resetPreferences())
  ipcMain.handle('model:select', (_event, modelId) => ({ ok: selectModel(modelId), snapshot: getSnapshot() }))
  ipcMain.handle('model:import-zip', () => importModelZip())
  ipcMain.handle('model:nickname-update', (_event, modelId, nickname) => {
    try {
      return { ok: true, snapshot: updateModelNickname(modelId, nickname) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('model:scale-update', (_event, modelId, scale) => {
    try {
      return { ok: true, snapshot: updateModelScale(modelId, scale) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('window:reset-pet-position', () => resetPetPosition())
  ipcMain.handle('window:move-pet', (_event, preset) => movePetToPreset(POSITION_PRESETS.includes(preset) ? preset : 'bottom-right'))
  ipcMain.handle('window:open-models-folder', () => shell.openPath(userModelsDir()).then(() => true).catch(() => false))
  ipcMain.handle('window:open-plugins-folder', () => shell.openPath(userPluginsDir()).then(() => true).catch(() => false))
  ipcMain.handle('window:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url)
      return true
    }
    return false
  })

  ipcMain.on('window:open-settings', (_event, section) => openSettings(section))
  ipcMain.on('window:open-ai-chat', openAIChat)
  ipcMain.on('window:settings-close', () => settingsWindow && settingsWindow.close())
  ipcMain.on('window:settings-minimize', () => settingsWindow && settingsWindow.minimize())
  ipcMain.on('app:quit', () => app.quit())
  ipcMain.on('pet:show-context-menu', showPetContextMenu)
  ipcMain.on('ai:chat-panel-state', (_event, open) => setPetChatOpen(open))
  ipcMain.on('settings:pet-background-frame', (event, frame) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender.id !== petWindow.webContents.id) return
    if (!shouldCaptureSettingsPetBackground()) return
    if (frame === null) {
      sendToWindow(settingsWindow, 'settings:pet-background-frame', null)
      return
    }
    const byteLength = frame && Number(frame.byteLength)
    if (!Number.isFinite(byteLength) || byteLength <= 0 || byteLength > 512 * 1024) return
    sendToWindow(settingsWindow, 'settings:pet-background-frame', frame)
  })
  ipcMain.on('pet:bubble-bounds', (_event, bounds) => {
    if (
      bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) &&
      Number.isFinite(bounds.width) && Number.isFinite(bounds.height) &&
      bounds.width > 0 && bounds.height > 0
    ) {
      const left = Math.max(0, Math.floor(bounds.x - 8))
      const top = Math.max(0, Math.floor(bounds.y - 8))
      const right = Math.min(PET_WIDTH, Math.ceil(bounds.x + bounds.width + 8))
      const bottom = Math.min(PET_HEIGHT, Math.ceil(bounds.y + bounds.height + 8))
      speechBubbleBounds = { x: left, y: top, width: right - left, height: bottom - top }
    } else {
      speechBubbleBounds = null
    }
    applyPetInteractionRegion()
  })

  ipcMain.on('pet:drag-prime', primePetDrag)
  ipcMain.on('pet:drag-start', startPetDrag)
  ipcMain.on('pet:drag-move', updatePetDrag)
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
    applyPetInteractionRegion()
  })

  ipcMain.on('pet:save-cover', (_event, modelId, dataURL) => {
    if (typeof modelId !== 'string' || !/^[\w.-]+$/.test(modelId) || typeof dataURL !== 'string') return
    const match = dataURL.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
    if (!match) return
    try {
      const dir = coversDir()
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${modelId}${COVER_CACHE_SUFFIX}`), Buffer.from(match[1], 'base64'))
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
    if (runtimeStatus.phase === 'ready') {
      syncWindowLevels()
      requestMissingCovers()
    }
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  migrateStore()
  aiPluginManager = createAIPluginManager({
    pluginsDirectories: pluginDirectories(),
    store,
    safeStorage,
    ttsDirectory: userTtsDir(),
  })
  setupIPC()
  createPetWindow()
  createTray()
  applyPreferences()
  startCursorTracking()

  if (!getPreferences().onboardingSeen) openSettings('characters')
})

app.on('second-instance', () => openSettings())

// 任一应用窗口失焦时重绘宠物窗口背景，清除 Windows 透明窗口偶发的残影。
app.on('browser-window-blur', () => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setBackgroundColor('#00000000')
  }
})

app.on('before-quit', () => {
  appIsQuitting = true
  if (aiPluginManager) aiPluginManager.dispose()
  endPetDrag()
  stopCursorTracking()
  if (positionSaveTimer) clearTimeout(positionSaveTimer)
  persistPetPosition()
})

app.on('window-all-closed', () => {})
