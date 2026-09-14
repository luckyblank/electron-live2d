const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell, safeStorage, dialog, clipboard } = require('electron')
const fs = require('fs')
const { Readable } = require('stream')
const path = require('path')
const { pathToFileURL } = require('url')
const Store = require('electron-store')
const { createAIPluginManager } = require('./ai/plugin-manager')
const { createExternalMessageServer, ExternalMessageError } = require('./external-message-server')
const {
  CURRENT_SCHEMA_VERSION,
  INITIAL_USER_DEFAULTS,
  PREFERENCE_DEFAULTS: preferenceDefaults,
  createInitialStoreDefaults,
} = require('./config/defaults')
const { BUBBLE_THEME_DEFINITIONS, normalizeBubbleStyles } = require('./config/bubble-styles')
const { inspectModelArchive, inspectModelDirectory } = require('./model-inspector')
const { captureSettingsPanel, normalizedSection } = require('./settings-screenshot')
const { buildConditionalTrayItems } = require('./tray-menu')

const PET_WIDTH = 400
const PET_HEIGHT = 600
const LONG_MESSAGE_READER_WIDTH = 380
const LONG_MESSAGE_READER_MIN_WIDTH = 280
const LONG_MESSAGE_READER_MAX_WIDTH = 420
const LONG_MESSAGE_READER_GAP = 14
const LONG_MESSAGE_READER_EDGE_MARGIN = 18
const LONG_MESSAGE_OVERLAY_MARGIN = 12
const LONG_MESSAGE_READER_TOP = 40
const LONG_MESSAGE_READER_HEIGHT = 520
// On the platforms where Electron supports shaped windows, reserve the maximum
// reader width on both sides from the moment the (still transparent) pet host is
// created. Opening and closing the reader then changes only the visible shape;
// the native BrowserWindow surface and the 400x600 WebGL stage never resize or
// change their local origin. This avoids Windows briefly compositing the model
// against the full expanded surface before Chromium applies the stage offset.
const USE_STABLE_LONG_MESSAGE_HOST = ['win32', 'linux'].includes(process.platform)
const LONG_MESSAGE_HOST_GUTTER = LONG_MESSAGE_READER_GAP + LONG_MESSAGE_READER_MAX_WIDTH + LONG_MESSAGE_READER_EDGE_MARGIN
const PET_HOST_WIDTH = PET_WIDTH + LONG_MESSAGE_HOST_GUTTER * 2
const SETTINGS_WIDTH = 470
const SETTINGS_HEIGHT = 760
const COVER_CACHE_SUFFIX = '.centered-v4.png'
const POSITION_SAVE_DELAY = 180
const CURSOR_NEAR_DISTANCE = 220
const PET_VISIBLE_MARGIN = 80
const CHAT_GREETING_MAX_LENGTH = 200
const CLIPBOARD_TEXT_MAX_LENGTH = 200000
const EXTERNAL_MESSAGE_HISTORY_LIMIT = 200
const MODEL_PROFILE_LIMITS = Object.freeze({
  species: 40,
  age: 40,
  height: 40,
  personality: 160,
  likes: 200,
  bio: 600,
  worldview: 1200,
  relationship: 600,
  rules: 800,
})
const GENERIC_MODEL_PROFILE = Object.freeze({
  species: '未设定',
  age: '未设定',
  height: '未设定',
  personality: '温柔、自然、乐于陪伴',
  likes: '与你相处、分享日常',
  bio: '住在桌面上的伙伴，希望用自然、温暖的方式陪伴你。',
  worldview: '生活在与你相连的桌面世界，可以感受到你分享的日常。',
  relationship: '把用户视为重要的伙伴，尊重用户的感受与边界。',
  rules: '使用自然、温暖、简短的中文；不使用 Markdown；不假装执行无法完成的操作。',
})
const USER_DATA_DIRECTORY_NAME = 'Live2DCompanion'
const MODEL_INTERACTION_LIMIT = 12
const DEFAULT_PET_INTERACTIONS = Object.freeze([
  { id: 'greet', label: '打个招呼', kind: 'greet', text: '你好呀～', defaultMapping: '问候 / 挥手动作' },
  { id: 'head', label: '摸摸头', kind: 'head', text: '好舒服～', defaultMapping: '摸头动作' },
  { id: 'praise', label: '夸夸她', kind: 'praise', text: '被夸奖了 ✦', defaultMapping: '开心 / 夸奖动作' },
  { id: 'snack', label: '投喂点心', kind: 'snack', text: '好吃！', defaultMapping: '投喂动作' },
  { id: 'random', label: '随机互动', kind: 'random', text: '来和我玩吧～', defaultMapping: '随机选择可用互动' },
])
const DEFAULT_PET_GESTURES = Object.freeze([
  { id: 'tap-head', label: '单击头部', kind: 'head', text: '好舒服～', enabled: true, defaultMapping: '摸头动作' },
  { id: 'tap-body', label: '单击身体', kind: 'curious', text: '在忙什么呀？', enabled: true, defaultMapping: '点击 / 好奇动作' },
  { id: 'double-click', label: '连续双击', kind: 'praise', text: '被夸奖了 ✦', enabled: true, defaultMapping: '开心 / 夸奖动作' },
  { id: 'triple-click', label: '连续三击', kind: 'excited', text: '最喜欢你啦！', enabled: true, defaultMapping: '兴奋 / 开心动作' },
  { id: 'long-press-head', label: '长按头部', kind: 'head', text: '再摸一下嘛', enabled: true, defaultMapping: '摸头动作' },
  { id: 'long-press-body', label: '长按身体', kind: 'calm', text: '让我靠一会儿', enabled: true, defaultMapping: '休息 / 安静动作' },
  { id: 'drag-end', label: '拖拽结束', kind: 'drag', text: '新位置不错', enabled: true, defaultMapping: '拖拽动作' },
])
const appliedWindowLevels = new WeakMap()

if (!app.requestSingleInstanceLock()) {
  app.quit()
  return
}

// Keep development and packaged builds on one stable, ASCII-only user-data path.
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_DIRECTORY_NAME))
// electron-store 在第一次写入前没有 config.json。启动时先记录这个事实，
// 用来区分真正的新用户和升级后尚未拥有新标记的既有用户。
const storeConfigExistedAtStartup = fs.existsSync(path.join(app.getPath('userData'), 'config.json'))

const store = new Store({
  defaults: createInitialStoreDefaults(),
})

let petWindow = null
let settingsWindow = null
let settingsWindowReadyToShow = false
let settingsWindowActivationPending = false
let settingsCaptureWindow = null
let externalMessageTesterWindow = null
let tray = null
let modelsCache = null
let coversCache = null
const modelAssetCatalogs = new Map()
const pendingModelPreviews = new Map()
let modelPreviewSequence = 0
let positionSaveTimer = null
let cursorTimer = null
let dragCandidate = null
let dragActive = false
let dragTimer = null
let dragOutsideSince = null // 拖拽中光标离开窗口的起始时刻（失联看门狗）
const DRAG_OUTSIDE_TIMEOUT_MS = 150
let toolWindowDrag = null
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
let statusToastBounds = null
let longMessageReaderBounds = null
let longMessageLayoutOpen = false
let longMessageReaderWidth = LONG_MESSAGE_READER_WIDTH
let petLayoutTransitionActive = false
let petWindowLayout = {
  expanded: false,
  side: 'none',
  mode: 'collapsed',
  readerWidth: 0,
  gap: LONG_MESSAGE_READER_GAP,
  stageOffsetX: USE_STABLE_LONG_MESSAGE_HOST ? LONG_MESSAGE_HOST_GUTTER : 0,
  readerOffsetX: 0,
  outerWidth: USE_STABLE_LONG_MESSAGE_HOST ? PET_HOST_WIDTH : PET_WIDTH,
  outerHeight: PET_HEIGHT,
  windowBounds: {
    x: USE_STABLE_LONG_MESSAGE_HOST ? -LONG_MESSAGE_HOST_GUTTER : 0,
    y: 0,
    width: USE_STABLE_LONG_MESSAGE_HOST ? PET_HOST_WIDTH : PET_WIDTH,
    height: PET_HEIGHT,
  },
  readerSlotBounds: null,
  revision: 0,
}
let aiPluginManager = null
let externalMessageServer = null
const UPDATE_MANIFEST_URL = 'https://qny.luckyblank.cn/live2d-pet/latest.yml'
let lastUpdateCheck = null
let lastDownloadedPath = null
let updateDownloadController = null
let settingsScreenshotBusy = false

const SETTINGS_SECTION_LABELS = Object.freeze({
  characters: '角色',
  behavior: '行为',
  ai: 'AI',
  system: '系统',
})

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
          name: inspection.name || entry.name,
          path: pathToFileURL(path.join(directory, inspection.source)).href,
          format: inspection.format,
          modelType: inspection.modelType || 'live2d',
          cubismVersion: inspection.cubismVersion,
          status: inspection.status,
          statusMessage: inspection.statusMessage,
        })
      } catch (error) {
        console.warn(`Skipping unreadable model directory ${entry.name}:`, error.message)
      }
    }
  }

  const storedOrder = store.get('modelOrder')
  const order = Array.isArray(storedOrder)
    ? new Map(storedOrder.filter(id => typeof id === 'string').map((id, index) => [id, index]))
    : new Map()
  modelsCache = [...byId.values()].sort((a, b) => {
    const aOrder = order.has(a.id) ? order.get(a.id) : Number.POSITIVE_INFINITY
    const bOrder = order.has(b.id) ? order.get(b.id) : Number.POSITIVE_INFINITY
    if (aOrder !== bOrder) return aOrder - bOrder
    const preferredModelId = INITIAL_USER_DEFAULTS.characters.preferredModelId.toLowerCase()
    if (a.id.toLowerCase() === preferredModelId) return -1
    if (b.id.toLowerCase() === preferredModelId) return 1
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
    .map(model => ({ id: model.id, name: model.name, path: model.path, format: model.format, modelType: model.modelType }))
  if (missing.length) sendToWindow(petWindow, 'covers:request', missing)
}

function selectedModel() {
  const models = listModels().filter(model => model.status === 'ready')
  const currentId = store.get('currentModelId')
  return models.find(model => model.id === currentId)
    || models.find(model => model.id.toLowerCase() === INITIAL_USER_DEFAULTS.characters.preferredModelId)
    || models[0]
    || null
}

function updateModelOrder(modelIds) {
  if (!Array.isArray(modelIds)) throw new Error('角色顺序格式无效')
  const models = listModels()
  const knownIds = new Set(models.map(model => model.id))
  const seen = new Set()
  const normalized = []
  for (const id of modelIds) {
    if (typeof id !== 'string' || !knownIds.has(id) || seen.has(id)) continue
    seen.add(id)
    normalized.push(id)
  }
  for (const model of models) {
    if (!seen.has(model.id)) normalized.push(model.id)
  }
  store.set('modelOrder', normalized)
  modelsCache = [...models].sort((left, right) => normalized.indexOf(left.id) - normalized.indexOf(right.id))
  updateTrayMenu()
  broadcastState('model-order-updated')
  return getSnapshot()
}

function modelNickname(modelId) {
  const nicknames = store.get('modelNicknames')
  if (!nicknames || typeof nicknames !== 'object' || Array.isArray(nicknames)) return ''
  const value = nicknames[modelId]
  return typeof value === 'string' ? value.trim().slice(0, 24) : ''
}

function sanitizeProfileValue(value, limit, fallback = '') {
  if (typeof value !== 'string') return fallback
  return Array.from(value)
    .filter(character => {
      const code = character.charCodeAt(0)
      return code === 10 || code === 13 || code === 9 || (code > 31 && code !== 127)
    })
    .join('')
    .trim()
    .slice(0, limit)
}

function normalizeModelInteractions(value) {
  const source = Array.isArray(value) ? value.slice(0, MODEL_INTERACTION_LIMIT) : []
  const defaultsById = new Map(DEFAULT_PET_INTERACTIONS.map(item => [item.id, item]))
  const normalizeDefault = (defaultItem, stored = {}) => ({
      id: defaultItem.id,
      label: sanitizeProfileValue(stored.label, 24, defaultItem.label) || defaultItem.label,
      kind: defaultItem.kind,
      text: sanitizeProfileValue(stored.text, 80, defaultItem.text) || defaultItem.text,
      actionId: sanitizeProfileValue(stored.actionId, 180),
      enabled: stored.enabled !== false,
      isDefault: true,
      defaultLabel: defaultItem.label,
      defaultText: defaultItem.text,
      defaultMapping: defaultItem.defaultMapping,
  })
  const normalized = []
  const usedIds = new Set()
  let customCount = 0
  for (const item of source) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const id = sanitizeProfileValue(item.id, 48).replace(/[^a-z0-9_-]/gi, '')
    if (!id || usedIds.has(id)) continue
    const defaultItem = defaultsById.get(id)
    if (defaultItem) {
      usedIds.add(id)
      normalized.push(normalizeDefault(defaultItem, item))
      continue
    }
    if (!id.startsWith('custom-') || customCount >= MODEL_INTERACTION_LIMIT - DEFAULT_PET_INTERACTIONS.length) continue
    usedIds.add(id)
    customCount++
    normalized.push({
      id,
      label: sanitizeProfileValue(item.label, 24, '新互动') || '新互动',
      kind: 'custom',
      text: sanitizeProfileValue(item.text, 80, sanitizeProfileValue(item.label, 80, '一起来玩吧～')) || '一起来玩吧～',
      actionId: sanitizeProfileValue(item.actionId, 180),
      enabled: item.enabled !== false,
      isDefault: false,
      defaultLabel: '',
      defaultText: '',
      defaultMapping: '',
    })
  }
  for (const defaultItem of DEFAULT_PET_INTERACTIONS) {
    if (!usedIds.has(defaultItem.id)) normalized.push(normalizeDefault(defaultItem))
  }
  return normalized.sort((left, right) => Number(right.enabled) - Number(left.enabled))
}

function modelInteractions(modelId) {
  const stored = store.get('modelInteractions')
  const value = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored[modelId] : null
  return normalizeModelInteractions(value)
}

function updateModelInteractions(modelId, value) {
  const model = listModels().find(item => item.id === modelId)
  if (!model) throw new Error('找不到这个角色')
  const stored = store.get('modelInteractions')
  const next = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {}
  if (value == null) {
    delete next[modelId]
  } else {
    if (!Array.isArray(value)) throw new Error('互动方式格式无效')
    next[modelId] = normalizeModelInteractions(value).map(item => ({
      id: item.id,
      label: item.label,
      text: item.text,
      actionId: item.actionId,
      enabled: item.enabled,
    }))
  }
  store.set('modelInteractions', next)
  updateTrayMenu()
  broadcastState('model-interactions-updated')
  return getSnapshot()
}

function normalizeModelGestures(value) {
  const source = Array.isArray(value) ? value : []
  const sourceById = new Map(source
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(item => [sanitizeProfileValue(item.id, 48), item]))
  return DEFAULT_PET_GESTURES.map(defaultItem => {
    const stored = sourceById.get(defaultItem.id) || {}
    return {
      ...defaultItem,
      actionId: sanitizeProfileValue(stored.actionId, 180),
      text: sanitizeProfileValue(stored.text, 80, defaultItem.text) || defaultItem.text,
      enabled: stored.enabled !== false,
    }
  })
}

function modelGestures(modelId) {
  const stored = store.get('modelGestures')
  const value = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored[modelId] : null
  return normalizeModelGestures(value)
}

function updateModelGestures(modelId, value) {
  const model = listModels().find(item => item.id === modelId)
  if (!model) throw new Error('找不到这个角色')
  const stored = store.get('modelGestures')
  const next = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {}
  if (value == null) {
    delete next[modelId]
  } else {
    if (!Array.isArray(value)) throw new Error('手势互动格式无效')
    next[modelId] = normalizeModelGestures(value).map(item => ({
      id: item.id,
      actionId: item.actionId,
      text: item.text,
      enabled: item.enabled,
    }))
  }
  store.set('modelGestures', next)
  broadcastState('model-gestures-updated')
  return getSnapshot()
}

function modelProfile(modelId) {
  const bundled = INITIAL_USER_DEFAULTS.characters.modelProfiles
    && INITIAL_USER_DEFAULTS.characters.modelProfiles[modelId]
  const storedProfiles = store.get('modelProfiles')
  const stored = storedProfiles && typeof storedProfiles === 'object' && !Array.isArray(storedProfiles)
    ? storedProfiles[modelId]
    : null
  const source = { ...GENERIC_MODEL_PROFILE, ...(bundled || {}), ...(stored || {}) }
  return Object.fromEntries(Object.entries(MODEL_PROFILE_LIMITS).map(([key, limit]) => [
    key,
    sanitizeProfileValue(source[key], limit, GENERIC_MODEL_PROFILE[key]),
  ]))
}

function updateModelProfile(modelId, patch) {
  const model = listModels().find(item => item.id === modelId)
  if (!model) throw new Error('找不到这个角色')
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('角色设定格式无效')
  const previous = modelProfile(modelId)
  const next = { ...previous }
  for (const [key, limit] of Object.entries(MODEL_PROFILE_LIMITS)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      next[key] = sanitizeProfileValue(patch[key], limit, '')
    }
  }
  const storedProfiles = store.get('modelProfiles')
  const profiles = storedProfiles && typeof storedProfiles === 'object' && !Array.isArray(storedProfiles)
    ? { ...storedProfiles }
    : {}
  profiles[modelId] = next
  store.set('modelProfiles', profiles)
  broadcastState('model-profile-updated')
  return getSnapshot()
}

function modelProfilePrompt(model) {
  if (!model) return INITIAL_USER_DEFAULTS.ai.persona
  const profile = modelProfile(model.id)
  return [
    `你是住在用户桌面上的伙伴${JSON.stringify(modelDisplayName(model))}。`,
    `基础设定：种族是${profile.species || '未设定'}；年龄是${profile.age || '未设定'}；身高是${profile.height || '未设定'}；性格是${profile.personality || '未设定'}；喜欢${profile.likes || '未设定'}。`,
    profile.bio ? `角色简介：${profile.bio}` : '',
    profile.worldview ? `世界观：${profile.worldview}` : '',
    profile.relationship ? `与用户的关系：${profile.relationship}` : '',
    profile.rules ? `行为与表达规则：${profile.rules}` : '',
  ].filter(Boolean).join('\n')
}

function normalizeModelAssetCatalog(value) {
  const normalizeList = (items, kind) => (Array.isArray(items) ? items : [])
    .slice(0, 160)
    .map(item => {
      if (!item || typeof item !== 'object') return null
      const id = sanitizeProfileValue(item.id, 180)
      const label = sanitizeProfileValue(item.label, 40)
      if (!id || !label) return null
      if (kind === 'action') {
        return {
          id,
          label,
          type: ['clip', 'group', 'interaction', 'video'].includes(item.type) ? item.type : 'group',
          clip: sanitizeProfileValue(item.clip, 160),
          video: sanitizeProfileValue(item.video, 180),
          group: sanitizeProfileValue(item.group, 120),
          index: Math.max(0, Math.min(999, Math.round(Number(item.index) || 0))),
          interaction: sanitizeProfileValue(item.interaction, 40),
        }
      }
      return {
        id,
        label,
        type: ['profile', 'native', 'interaction'].includes(item.type) ? item.type : 'native',
        source: sanitizeProfileValue(item.source, 160),
        expressionId: sanitizeProfileValue(item.expressionId, 240),
        interaction: sanitizeProfileValue(item.interaction, 40),
      }
    })
    .filter(Boolean)
  return {
    actions: normalizeList(value && value.actions, 'action'),
    expressions: normalizeList(value && value.expressions, 'expression'),
  }
}

function modelDisplayName(model) {
  return model ? (modelNickname(model.id) || model.name) : '伙伴'
}

function modelsWithNicknames() {
  return listModels().map(model => {
    const nickname = modelNickname(model.id)
    return {
      ...model,
      nickname,
      displayName: nickname || model.name,
      profile: modelProfile(model.id),
      assets: modelAssetCatalogs.get(model.id) || { actions: [], expressions: [] },
      interactions: modelInteractions(model.id),
      gestures: modelGestures(model.id),
    }
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
  if (!store.has('initialSettingsShown')) {
    // 既有配置升级时不要突然弹设置页；只有启动前连配置文件都不存在的
    // 全新用户，才保留 false 并在窗口创建完成后执行一次首次展示。
    store.set('initialSettingsShown', storeConfigExistedAtStartup)
  }
  const models = listModels()
  const readyModels = models.filter(model => model.status === 'ready')
  const oldModelPath = store.get('currentModel')
  if (!store.get('currentModelId') && oldModelPath) {
    const match = models.find(model => model.path === oldModelPath)
    if (match) store.set('currentModelId', match.id)
  }

  const currentId = store.get('currentModelId')
  if (!readyModels.some(model => model.id === currentId) && readyModels.length) {
    const initialModel = readyModels.find(model => model.id.toLowerCase() === INITIAL_USER_DEFAULTS.characters.preferredModelId) || readyModels[0]
    store.set('currentModelId', initialModel.id)
  }
  if (!store.has('launchAtLogin') && typeof store.get('autoLaunch') === 'boolean') {
    store.set('launchAtLogin', store.get('autoLaunch'))
  }

  store.set('schemaVersion', CURRENT_SCHEMA_VERSION)
}

function modelScale(modelId) {
  const scales = store.get('modelScales')
  const defaultScale = INITIAL_USER_DEFAULTS.characters.scale
  if (!modelId || !scales || typeof scales !== 'object' || Array.isArray(scales)) return defaultScale
  return clamp(scales[modelId], 0.5, 2, defaultScale)
}

function storeModelScale(modelId, value) {
  if (!modelId) return
  const stored = store.get('modelScales')
  const scales = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {}
  const scale = clamp(value, 0.5, 2, modelScale(modelId))
  if (Math.abs(scale - INITIAL_USER_DEFAULTS.characters.scale) < 0.001) delete scales[modelId]
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
    settingsPetBackground: store.get('settingsPetBackground') !== false,
    appLongScreenshotEnabled: store.get('appLongScreenshotEnabled') === true,
    externalMessagesEnabled: store.get('externalMessagesEnabled') === true,
    settingsTheme: ['glass', 'healing'].includes(store.get('settingsTheme'))
      ? store.get('settingsTheme')
      : preferenceDefaults.settingsTheme,
    bubbleStyles: normalizeBubbleStyles(store.get('bubbleStyles')),
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
    bubbleStyleCatalog: BUBBLE_THEME_DEFINITIONS,
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
    externalMessages: externalMessageServer
      ? externalMessageServer.getSnapshot()
      : {
          enabled: false,
          status: 'stopped',
          running: false,
          host: '127.0.0.1',
          port: 17373,
          httpBaseUrl: 'http://127.0.0.1:17373',
          messageUrl: 'http://127.0.0.1:17373/api/v1/messages',
          websocketUrl: 'ws://127.0.0.1:17373/api/v1/events',
          testerUrl: 'http://127.0.0.1:17373/external-message-tester.html',
          queueDepth: 0,
          websocketClients: 0,
          error: '',
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
  const area = display.workArea
  return {
    x: area.x + Math.round((area.width - PET_WIDTH) / 2),
    y: area.y + Math.round((area.height - PET_HEIGHT) / 2),
  }
}

// 常用位置预设：以宠物当前所在显示器为基准。
// 锚定的是"角色视觉中心"（窗口中心）贴近屏幕角，
// 而不是窗口矩形对齐角——窗口是透明的，角色才是用户看到的东西。
const POSITION_PRESETS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']
const CORNER_ANCHOR_MARGIN = 24
// 角色在窗口内的包围盒（局部 DIP），由渲染进程按渲染蒙版上报
let characterBounds = null
// Windows 的原生窗口 shape 会在设置时按当前显示器 DPI 转换成物理像素，
// 但窗口跨到另一缩放比例的显示器时不会自动重建。记录 shape 所属显示器，
// 在跨屏的那一帧重新应用，避免 100% -> 125% 后只剩 80% 区域可绘制。
let petShapeDisplaySignature = ''
let petShapeRefreshTimer = null
let petShapeRegionSignature = ''

function currentPetDisplaySignature() {
  if (!petWindow || petWindow.isDestroyed()) return ''
  // The stable long-message host extends far beyond the visible 400x600 stage.
  // Match the display from the character itself, not from the transparent host
  // rectangle, which may overlap a neighbouring monitor more than the stage.
  const stage = currentPetStageBounds()
  const display = screen.getDisplayNearestPoint({
    x: stage.x + Math.round(PET_WIDTH / 2),
    y: stage.y + Math.round(PET_HEIGHT / 2),
  })
  return display ? `${display.id}:${display.scaleFactor}` : ''
}

function refreshPetShapeForCurrentDisplay() {
  if (process.platform !== 'win32' || !petWindow || petWindow.isDestroyed()) return
  const displaySignature = currentPetDisplaySignature()
  if (displaySignature && displaySignature !== petShapeDisplaySignature) {
    applyPetInteractionRegion()
  }
}

// Pure geometry resolver for the long-message surface. `stageBounds` always
// describes the fixed 400x600 Live2D viewport in screen DIP coordinates. On
// Windows/Linux the transparent host permanently reserves both reader gutters,
// so expanded/collapsed layouts share identical native bounds and stage origin.
// Keeping this function independent from Electron makes the side/overlay matrix
// straightforward to exercise in QA.
function resolveLongMessageWindowLayout({
  stageBounds,
  workArea,
  expanded = true,
  readerWidth = LONG_MESSAGE_READER_WIDTH,
  gap = LONG_MESSAGE_READER_GAP,
} = {}) {
  const stageX = Math.round(Number(stageBounds && stageBounds.x) || 0)
  const stageY = Math.round(Number(stageBounds && stageBounds.y) || 0)
  const desiredReaderWidth = Math.round(Math.min(
    LONG_MESSAGE_READER_MAX_WIDTH,
    Math.max(LONG_MESSAGE_READER_MIN_WIDTH, Number(readerWidth) || LONG_MESSAGE_READER_WIDTH)
  ))
  const desiredGap = Math.max(0, Math.round(Number(gap) || 0))
  const area = workArea && [workArea.x, workArea.y, workArea.width, workArea.height].every(Number.isFinite)
    ? workArea
    : { x: stageX, y: stageY, width: PET_WIDTH, height: PET_HEIGHT }
  const stage = { x: stageX, y: stageY, width: PET_WIDTH, height: PET_HEIGHT }
  const stableWindowBounds = {
    x: stageX - LONG_MESSAGE_HOST_GUTTER,
    y: stageY,
    width: PET_HOST_WIDTH,
    height: PET_HEIGHT,
  }
  const collapsedStageOffsetX = USE_STABLE_LONG_MESSAGE_HOST ? LONG_MESSAGE_HOST_GUTTER : 0
  const collapsedOuterWidth = USE_STABLE_LONG_MESSAGE_HOST ? PET_HOST_WIDTH : PET_WIDTH
  const collapsedWindowBounds = USE_STABLE_LONG_MESSAGE_HOST ? stableWindowBounds : { ...stage }

  if (!expanded) {
    return {
      expanded: false,
      side: 'none',
      mode: 'collapsed',
      readerWidth: 0,
      gap: desiredGap,
      stageOffsetX: collapsedStageOffsetX,
      readerOffsetX: 0,
      outerWidth: collapsedOuterWidth,
      outerHeight: PET_HEIGHT,
      stageBounds: stage,
      windowBounds: collapsedWindowBounds,
      readerSlotBounds: null,
    }
  }

  // Leave transparent room beyond a side reader for its rounded edge, petal
  // and glass shadow. Without this margin the card ends exactly at the native
  // BrowserWindow boundary and its right/left glow is visibly guillotined.
  const requiredExtension = desiredGap + desiredReaderWidth + LONG_MESSAGE_READER_EDGE_MARGIN
  const workRight = area.x + area.width
  const stageRight = stageX + PET_WIDTH
  const rightRoom = workRight - stageRight
  const leftRoom = stageX - area.x

  if (rightRoom >= requiredExtension) {
    const stageOffsetX = USE_STABLE_LONG_MESSAGE_HOST ? LONG_MESSAGE_HOST_GUTTER : 0
    const readerOffsetX = stageOffsetX + PET_WIDTH + desiredGap
    return {
      expanded: true,
      side: 'right',
      mode: 'right',
      readerWidth: desiredReaderWidth,
      gap: desiredGap,
      stageOffsetX,
      readerOffsetX,
      outerWidth: USE_STABLE_LONG_MESSAGE_HOST ? PET_HOST_WIDTH : PET_WIDTH + requiredExtension,
      outerHeight: PET_HEIGHT,
      stageBounds: stage,
      windowBounds: USE_STABLE_LONG_MESSAGE_HOST ? stableWindowBounds : {
        x: stageX,
        y: stageY,
        width: PET_WIDTH + requiredExtension,
        height: PET_HEIGHT,
      },
      readerSlotBounds: {
        x: readerOffsetX,
        y: LONG_MESSAGE_READER_TOP,
        width: desiredReaderWidth,
        height: LONG_MESSAGE_READER_HEIGHT,
      },
    }
  }

  if (leftRoom >= requiredExtension) {
    const stageOffsetX = USE_STABLE_LONG_MESSAGE_HOST ? LONG_MESSAGE_HOST_GUTTER : requiredExtension
    const readerOffsetX = USE_STABLE_LONG_MESSAGE_HOST
      ? stageOffsetX - desiredGap - desiredReaderWidth
      : LONG_MESSAGE_READER_EDGE_MARGIN
    return {
      expanded: true,
      side: 'left',
      mode: 'left',
      readerWidth: desiredReaderWidth,
      gap: desiredGap,
      stageOffsetX,
      readerOffsetX,
      outerWidth: USE_STABLE_LONG_MESSAGE_HOST ? PET_HOST_WIDTH : PET_WIDTH + requiredExtension,
      outerHeight: PET_HEIGHT,
      stageBounds: stage,
      windowBounds: USE_STABLE_LONG_MESSAGE_HOST ? stableWindowBounds : {
        x: stageX - requiredExtension,
        y: stageY,
        width: PET_WIDTH + requiredExtension,
        height: PET_HEIGHT,
      },
      readerSlotBounds: {
        x: readerOffsetX,
        y: LONG_MESSAGE_READER_TOP,
        width: desiredReaderWidth,
        height: LONG_MESSAGE_READER_HEIGHT,
      },
    }
  }

  const overlayWidth = Math.min(desiredReaderWidth, PET_WIDTH - LONG_MESSAGE_OVERLAY_MARGIN * 2)
  const overlayStageOffsetX = USE_STABLE_LONG_MESSAGE_HOST ? LONG_MESSAGE_HOST_GUTTER : 0
  const readerOffsetX = overlayStageOffsetX + Math.round((PET_WIDTH - overlayWidth) / 2)
  return {
    expanded: true,
    side: 'overlay',
    mode: 'overlay',
    readerWidth: overlayWidth,
    gap: 0,
    stageOffsetX: overlayStageOffsetX,
    readerOffsetX,
    outerWidth: USE_STABLE_LONG_MESSAGE_HOST ? PET_HOST_WIDTH : PET_WIDTH,
    outerHeight: PET_HEIGHT,
    stageBounds: stage,
    windowBounds: USE_STABLE_LONG_MESSAGE_HOST ? stableWindowBounds : { ...stage },
    readerSlotBounds: {
      x: readerOffsetX,
      y: LONG_MESSAGE_READER_TOP,
      width: overlayWidth,
      height: LONG_MESSAGE_READER_HEIGHT,
    },
  }
}

function petWindowLayoutPayload(layout = petWindowLayout) {
  return {
    expanded: Boolean(layout.expanded),
    side: layout.side,
    mode: layout.mode,
    readerWidth: layout.readerWidth,
    gap: layout.gap,
    stageOffsetX: layout.stageOffsetX,
    readerOffsetX: layout.readerOffsetX,
    outerWidth: layout.outerWidth,
    outerHeight: layout.outerHeight,
    stageWidth: PET_WIDTH,
    stageHeight: PET_HEIGHT,
    revision: layout.revision,
  }
}

function samePetWindowLayoutGeometry(left, right) {
  return Boolean(left && right) && [
    'expanded', 'side', 'mode', 'readerWidth', 'gap', 'stageOffsetX',
    'readerOffsetX', 'outerWidth', 'outerHeight',
  ].every(key => left[key] === right[key])
}

function currentPetStageBounds() {
  if (!petWindow || petWindow.isDestroyed()) {
    return petWindowLayout.stageBounds || { x: 0, y: 0, width: PET_WIDTH, height: PET_HEIGHT }
  }
  const outer = petWindow.getBounds()
  return {
    x: outer.x + petWindowLayout.stageOffsetX,
    y: outer.y,
    width: PET_WIDTH,
    height: PET_HEIGHT,
  }
}

function workAreaForPetStage(stageBounds) {
  const display = screen.getDisplayNearestPoint({
    x: stageBounds.x + Math.round(PET_WIDTH / 2),
    y: stageBounds.y + Math.round(PET_HEIGHT / 2),
  })
  return display.workArea
}

function resolveCurrentPetWindowLayout(stageBounds) {
  return resolveLongMessageWindowLayout({
    stageBounds,
    workArea: workAreaForPetStage(stageBounds),
    expanded: longMessageLayoutOpen,
    readerWidth: longMessageReaderWidth,
    gap: LONG_MESSAGE_READER_GAP,
  })
}

function sendPetWindowLayout() {
  sendToWindow(petWindow, 'pet:window-layout-changed', petWindowLayoutPayload())
}

function schedulePetShapeRefresh() {
  if (appIsQuitting) return
  if (petShapeRefreshTimer) clearTimeout(petShapeRefreshTimer)
  // 显示器插拔/缩放变化会经过 Windows 与 Chromium 两层通知；下一轮
  // 事件循环再读取窗口所属显示器，避免拿到变更前的旧 scaleFactor。
  petShapeRefreshTimer = setTimeout(() => {
    petShapeRefreshTimer = null
    if (!petWindow || petWindow.isDestroyed()) return
    const stage = currentPetStageBounds()
    const position = dragActive ? stage : safePetPosition(stage.x, stage.y)
    // Re-evaluate the preferred side as work areas change or a monitor is
    // removed. placePetWindow also refreshes the Windows shape immediately if
    // the HWND crosses to a different DPI.
    placePetWindow(position.x, position.y)
  }, 0)
}

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

function translateStageRegion(region) {
  if (!region) return null
  return {
    x: region.x + petWindowLayout.stageOffsetX,
    y: region.y,
    width: region.width,
    height: region.height,
  }
}

function clampPetWindowRegion(region, padding = 0) {
  if (
    !region || !Number.isFinite(region.x) || !Number.isFinite(region.y) ||
    !Number.isFinite(region.width) || !Number.isFinite(region.height) ||
    region.width <= 0 || region.height <= 0
  ) return null

  const left = Math.max(0, Math.floor(region.x - padding))
  const top = Math.max(0, Math.floor(region.y - padding))
  const right = Math.min(petWindowLayout.outerWidth, Math.ceil(region.x + region.width + padding))
  const bottom = Math.min(PET_HEIGHT, Math.ceil(region.y + region.height + padding))
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function applyPetInteractionRegion() {
  if (!petWindow || petWindow.isDestroyed()) return
  const preferences = getPreferences()
  // Like the chat surface, an already-open long-message reader remains
  // operable so its Copy/Collapse controls cannot strand the user.
  const locked = !petChatOpen && !longMessageLayoutOpen && preferences.interactionMode === 'locked'
  petWindow.setIgnoreMouseEvents(locked)
  if (!['win32', 'linux'].includes(process.platform)) {
    petShapeDisplaySignature = ''
    petShapeRegionSignature = ''
    return
  }

  try {
    const fullStage = {
      x: petWindowLayout.stageOffsetX,
      y: 0,
      width: PET_WIDTH,
      height: PET_HEIGHT,
    }
    // 聊天框、背景检测或锁定模式需要完整绘制区域。锁定模式虽然全局
    // 穿透鼠标，但仍须重建完整 shape，否则旧 DPI 的原生裁剪区会继续
    // 截断角色。扩展后的透明外窗不能整个参与命中：只加入平移后的
    // 400x600 舞台与阅读卡视觉区域，空白仍然穿透到桌面。
    const useFullStage = petChatOpen || locked || preferences.backgroundDetection
    const regions = [useFullStage ? fullStage : translateStageRegion(interactionRegionFromBounds())]
    // Unsupported legacy hosts can still use the dynamic left-side hand-off.
    // During it expose only the pet stage. Stable shaped hosts never enter this
    // branch because their stage offset and native bounds are invariant.
    if (!petLayoutTransitionActive && !longMessageLayoutOpen && !useFullStage && speechBubbleBounds) {
      regions.push(translateStageRegion(speechBubbleBounds))
    }
    if (!petLayoutTransitionActive && !useFullStage && statusToastBounds) {
      regions.push(translateStageRegion(statusToastBounds))
    }
    if (!petLayoutTransitionActive && longMessageLayoutOpen) {
      // The reader uses fixed top/height geometry. Its provisional slot already
      // matches the measured card, including the 18px visual padding, so the
      // later bounds report does not force Windows to rebuild an identical
      // native shape on the next frame.
      const measuredReader = longMessageReaderBounds &&
        longMessageReaderBounds.revision === petWindowLayout.revision
        ? longMessageReaderBounds
        : petWindowLayout.readerSlotBounds
      const readerRegion = clampPetWindowRegion(measuredReader, 18)
      if (readerRegion) regions.push(readerRegion)
    }
    const displaySignature = currentPetDisplaySignature()
    const regionSignature = JSON.stringify(regions)
    if (
      displaySignature === petShapeDisplaySignature &&
      regionSignature === petShapeRegionSignature
    ) return
    petWindow.setShape(regions)
    petShapeDisplaySignature = displaySignature
    petShapeRegionSignature = regionSignature
  } catch (error) {
    console.warn('Failed to apply pet interaction region:', error.message)
  }
}

function movePetToPreset(preset) {
  if (!petWindow || petWindow.isDestroyed()) return false
  const current = currentPetStageBounds()
  const display = screen.getDisplayNearestPoint({
    x: current.x + Math.round(PET_WIDTH / 2),
    y: current.y + Math.round(PET_HEIGHT / 2),
  })
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
  const target = anchors[preset] || anchors.center
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
  const display = screen.getDisplayNearestPoint({
    x: point.x + Math.round(PET_WIDTH / 2),
    y: point.y + Math.round(PET_HEIGHT / 2),
  })
  const area = display.workArea
  // 允许窗口伸出屏幕边缘（角色贴角摆放），但保证至少 80px 可见可抓
  return {
    x: Math.min(Math.max(point.x, area.x - PET_WIDTH + PET_VISIBLE_MARGIN), area.x + area.width - PET_VISIBLE_MARGIN),
    y: Math.min(Math.max(point.y, area.y - PET_HEIGHT + PET_VISIBLE_MARGIN), area.y + area.height - PET_VISIBLE_MARGIN),
  }
}

function persistPetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return
  const stage = currentPetStageBounds()
  store.set({ windowX: stage.x, windowY: stage.y })
}

function placePetWindow(x, y) {
  if (!petWindow || petWindow.isDestroyed()) return
  const stageBounds = {
    x: Math.round(x),
    y: Math.round(y),
    width: PET_WIDTH,
    height: PET_HEIGHT,
  }
  const resolvedLayout = resolveCurrentPetWindowLayout(stageBounds)
  const layoutChanged = !samePetWindowLayoutGeometry(petWindowLayout, resolvedLayout)
  const previousRevision = Number.isInteger(petWindowLayout.revision) ? petWindowLayout.revision : 0
  petWindowLayout = {
    ...resolvedLayout,
    revision: layoutChanged ? previousRevision + 1 : previousRevision,
  }
  if (layoutChanged) longMessageReaderBounds = null

  // Windows 分数 DPI 缩放（125%/150%）下，对透明无边框窗口反复调用
  // setPosition 会让系统读回的窗口尺寸每次 +1 DIP 不断累积（实测 125%
  // 缩放连调 30 次 setPosition，窗口宽从 401 涨到 429），拖动中视口持续
  // 变大，表现为"宠物越拖越偏"。setBounds 写入完整绝对几何，读回误差
  // 有界（≤1 DIP 常量），不再累积。
  const currentBounds = petWindow.getBounds()
  const targetBounds = petWindowLayout.windowBounds
  const nativeBoundsChanged = ['x', 'y', 'width', 'height'].some(key => currentBounds[key] !== targetBounds[key])
  if (nativeBoundsChanged) petWindow.setBounds({ ...targetBounds }, false)
  // setShape 在 Windows 上保存的是按调用时 DPI 换算后的原生区域。
  // setBounds 让窗口跨屏后立刻重建一次 shape，不能等鼠标松开或下一次
  // 命中蒙版上报，否则拖动途中模型会按旧显示器比例被裁掉。
  if (layoutChanged) {
    // Reader visibility/side changes alter the shaped native region even when
    // the stable host bounds and DPI stay identical.
    applyPetInteractionRegion()
    sendPetWindowLayout()
  } else {
    refreshPetShapeForCurrentDisplay()
  }
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

function settingsWindowHeight() {
  const { workArea } = screen.getPrimaryDisplay()
  const availableHeight = Math.max(0, workArea.height - 32)
  const preferredHeight = Math.round(workArea.height * 0.9)
  return Math.min(SETTINGS_HEIGHT, availableHeight, Math.max(640, preferredHeight))
}

function activateToolWindow(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return false
  if (targetWindow.isMinimized()) targetWindow.restore()
  targetWindow.show()
  // 设置页和测试台都是普通窗口，Windows 会自然地把获得焦点的那个
  // 排到另一个上方。宠物只有在用户开启“始终置顶”时才进入 topmost
  // Z 带，因此无需在每次工具窗口激活时来回移动三个原生窗口。
  syncWindowLevels()
  targetWindow.focus()
  return true
}

function toolWindowForSender(event) {
  const senderId = event && event.sender && event.sender.id
  if (!Number.isInteger(senderId)) return null
  return [settingsWindow, externalMessageTesterWindow].find(targetWindow => (
    targetWindow && !targetWindow.isDestroyed() && targetWindow.webContents.id === senderId
  )) || null
}

function startToolWindowDrag(event, point) {
  const targetWindow = toolWindowForSender(event)
  const cursor = normalizedDragPoint(point)
  if (!targetWindow || !cursor || !targetWindow.isVisible() || targetWindow.isMinimized()) return
  syncWindowLevels()
  targetWindow.focus()
  toolWindowDrag = {
    targetWindow,
    senderId: event.sender.id,
    bounds: targetWindow.getBounds(),
    cursor,
  }
}

function moveToolWindowDrag(event, point) {
  const activeDrag = toolWindowDrag
  const targetWindow = toolWindowForSender(event)
  const cursor = normalizedDragPoint(point)
  if (
    !activeDrag || !targetWindow || !cursor ||
    activeDrag.targetWindow !== targetWindow || activeDrag.senderId !== event.sender.id
  ) return
  if (!targetWindow.isVisible() || targetWindow.isMinimized()) {
    toolWindowDrag = null
    return
  }

  // 直接写入绝对坐标，不套用 workArea/safe-position 限制。这样窗口可以
  // 越过屏幕上沿或跨显示器移动，也不会触发 Windows 原生标题栏的回弹。
  targetWindow.setBounds({
    x: Math.round(activeDrag.bounds.x + cursor.x - activeDrag.cursor.x),
    y: Math.round(activeDrag.bounds.y + cursor.y - activeDrag.cursor.y),
    width: activeDrag.bounds.width,
    height: activeDrag.bounds.height,
  }, false)
}

function endToolWindowDrag(event) {
  if (!toolWindowDrag) return
  if (event && event.sender && toolWindowDrag.senderId !== event.sender.id) return
  toolWindowDrag = null
}

function createExternalMessageTesterWindow() {
  const service = externalMessageServer && externalMessageServer.getSnapshot()
  if (!service || !service.running) return false
  if (externalMessageTesterWindow && !externalMessageTesterWindow.isDestroyed()) {
    return activateToolWindow(externalMessageTesterWindow)
  }

  const allowedOrigin = new URL(service.testerUrl).origin
  const testerHeight = settingsWindowHeight()
  const testerWindow = new BrowserWindow({
    width: 860,
    height: testerHeight,
    minWidth: 640,
    minHeight: testerHeight,
    maxHeight: testerHeight,
    center: true,
    show: false,
    frame: false,
    maximizable: false,
    movable: true,
    alwaysOnTop: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: '外部消息测试台',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'external-message-tester-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  externalMessageTesterWindow = testerWindow
  testerWindow.setMenu(null)
  testerWindow.setTitle('外部消息测试台')
  testerWindow.webContents.on('page-title-updated', event => {
    event.preventDefault()
    if (!testerWindow.isDestroyed()) testerWindow.setTitle('外部消息测试台')
  })
  testerWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== allowedOrigin) event.preventDefault()
    } catch (error) {
      event.preventDefault()
    }
  })
  testerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  testerWindow.once('ready-to-show', () => {
    if (testerWindow.isDestroyed()) return
    activateToolWindow(testerWindow)
  })
  testerWindow.on('show', syncWindowLevels)
  testerWindow.on('hide', syncWindowLevels)
  testerWindow.on('minimize', syncWindowLevels)
  testerWindow.on('restore', () => {
    syncWindowLevels()
  })
  testerWindow.on('closed', () => {
    if (toolWindowDrag && toolWindowDrag.targetWindow === testerWindow) toolWindowDrag = null
    if (externalMessageTesterWindow === testerWindow) externalMessageTesterWindow = null
    syncWindowLevels()
  })
  testerWindow.loadURL(service.testerUrl).catch(error => {
    if (!testerWindow.isDestroyed()) console.warn('External message tester failed to load:', error.message)
  })
  return true
}

async function openExternalMessageTester(target = 'app') {
  if (!getPreferences().externalMessagesEnabled) return false
  const service = externalMessageServer && externalMessageServer.getSnapshot()
  if (!service || !service.running) return false
  if (target !== 'browser') return createExternalMessageTesterWindow()
  try {
    await shell.openExternal(service.testerUrl)
    return true
  } catch (error) {
    console.warn('External message tester failed to open in browser:', error.message)
    return false
  }
}

function createPetWindow() {
  const position = safePetPosition(store.get('windowX'), store.get('windowY'))
  const preferences = getPreferences()
  longMessageLayoutOpen = false
  longMessageReaderBounds = null
  petLayoutTransitionActive = false
  const initialStageBounds = { ...position, width: PET_WIDTH, height: PET_HEIGHT }
  petWindowLayout = {
    ...resolveLongMessageWindowLayout({
      stageBounds: initialStageBounds,
      workArea: workAreaForPetStage(initialStageBounds),
      expanded: false,
      readerWidth: longMessageReaderWidth,
      gap: LONG_MESSAGE_READER_GAP,
    }),
    revision: (Number.isInteger(petWindowLayout.revision) ? petWindowLayout.revision : 0) + 1,
  }

  petWindow = new BrowserWindow({
    width: petWindowLayout.outerWidth,
    height: petWindowLayout.outerHeight,
    x: petWindowLayout.windowBounds.x,
    y: petWindowLayout.windowBounds.y,
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
  petWindow.webContents.on('did-finish-load', () => {
    if (petLayoutTransitionActive) setPetLayoutTransitionActive(false)
    syncSettingsPetBackgroundCapture()
    sendPetWindowLayout()
  })
  applyPetInteractionRegion()

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
  })
  petWindow.on('closed', () => {
    stopCursorTracking()
    petWindow = null
    longMessageLayoutOpen = false
    longMessageReaderBounds = null
    petLayoutTransitionActive = false
    petShapeDisplaySignature = ''
    petShapeRegionSignature = ''
    if (petShapeRefreshTimer) clearTimeout(petShapeRefreshTimer)
    petShapeRefreshTimer = null
  })
}

function createSettingsWindow() {
  // 在高 DPI 或较矮屏幕上为桌面和任务栏留出呼吸空间，避免设置页
  // 贴着屏幕上下边缘；内容区本身保持可滚动，不通过拉满窗口解决布局。
  const settingsHeight = settingsWindowHeight()
  settingsWindowReadyToShow = false
  settingsWindowActivationPending = false
  settingsWindow = new BrowserWindow({
    width: SETTINGS_WIDTH,
    height: settingsHeight,
    minWidth: SETTINGS_WIDTH,
    maxWidth: SETTINGS_WIDTH,
    minHeight: settingsHeight,
    maxHeight: settingsHeight,
    center: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    movable: true,
    hasShadow: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    title: '桌面伙伴',
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
  settingsWindow.setTitle('桌面伙伴')
  settingsWindow.webContents.on('page-title-updated', event => {
    event.preventDefault()
    if (!settingsWindow.isDestroyed()) settingsWindow.setTitle('桌面伙伴')
  })
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'))
  settingsWindow.webContents.on('did-finish-load', syncSettingsPetBackgroundCapture)
  settingsWindow.webContents.on('console-message', details => {
    const { level, message, lineNumber, sourceId } = details
    console.log(`Settings renderer [${level}] ${sourceId}:${lineNumber} -> ${message}`)
  })

  settingsWindow.on('show', () => {
    if (store.get('initialSettingsShown') !== true) store.set('initialSettingsShown', true)
    syncWindowLevels()
    updateTrayMenu()
    broadcastState('settings-opened')
    syncSettingsPetBackgroundCapture()
  })
  settingsWindow.on('hide', () => {
    syncWindowLevels()
    updateTrayMenu()
    syncSettingsPetBackgroundCapture()
  })

  const targetWindow = settingsWindow
  targetWindow.once('ready-to-show', () => {
    if (targetWindow.isDestroyed() || settingsWindow !== targetWindow) return
    settingsWindowReadyToShow = true
    if (!settingsWindowActivationPending) return
    settingsWindowActivationPending = false
    activateToolWindow(targetWindow)
  })
  settingsWindow.on('minimize', () => {
    syncWindowLevels()
    updateTrayMenu()
    syncSettingsPetBackgroundCapture()
  })
  settingsWindow.on('restore', () => {
    syncWindowLevels()
    updateTrayMenu()
    syncSettingsPetBackgroundCapture()
  })
  settingsWindow.on('closed', () => {
    if (toolWindowDrag && toolWindowDrag.targetWindow === settingsWindow) toolWindowDrag = null
    settingsWindow = null
    settingsWindowReadyToShow = false
    settingsWindowActivationPending = false
    syncWindowLevels()
    updateTrayMenu()
    syncSettingsPetBackgroundCapture()
  })
}

function openSettings(section, notice) {
  const requestedSection = ['characters', 'behavior', 'ai', 'system'].includes(section) ? section : null
  const created = !settingsWindow || settingsWindow.isDestroyed()
  if (created) createSettingsWindow()
  // 第一次创建时等 Chromium 完成首帧再显示。透明无边框窗口如果在
  // ready-to-show 之前调用 show()，Windows 会短暂合成一个未完成页面，
  // 表现为设置页先闪一下、随后才稳定。重复打开已就绪窗口仍立即响应。
  if (settingsWindowReadyToShow && !settingsWindow.webContents.isLoadingMainFrame()) {
    settingsWindowActivationPending = false
    activateToolWindow(settingsWindow)
  } else {
    settingsWindowActivationPending = true
  }
  // “打开设置”只负责恢复已有窗口，保留用户正在查看的页签。只有带有
  // 明确目标的入口（例如“安装 AI 插件”）才导航；新窗口未加载完成时
  // 延迟到 did-finish-load，避免首个导航消息丢失。
  const deliverNavigation = targetWindow => {
    if (requestedSection) sendToWindow(targetWindow, 'settings:navigate', requestedSection)
    if (typeof notice === 'string' && notice.trim()) sendToWindow(targetWindow, 'settings:notice', notice.trim())
  }
  if (created && settingsWindow.webContents.isLoadingMainFrame()) {
    const targetWindow = settingsWindow
    targetWindow.webContents.once('did-finish-load', () => {
      if (!targetWindow.isDestroyed()) deliverNavigation(targetWindow)
    })
  } else if (requestedSection || notice) {
    deliverNavigation(settingsWindow)
  }
  requestMissingCovers()
}

function waitForSettingsReady(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return Promise.reject(new Error('设置面板暂不可用'))
  if (!targetWindow.webContents.isLoadingMainFrame()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      targetWindow.webContents.removeListener('did-finish-load', handleReady)
      targetWindow.removeListener('closed', handleClosed)
    }
    const handleReady = () => {
      cleanup()
      resolve()
    }
    const handleClosed = () => {
      cleanup()
      reject(new Error('设置面板已关闭'))
    }
    targetWindow.webContents.once('did-finish-load', handleReady)
    targetWindow.once('closed', handleClosed)
  })
}

function screenshotTimestamp(date = new Date()) {
  const value = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${value(date.getMonth() + 1)}-${value(date.getDate())}_${value(date.getHours())}-${value(date.getMinutes())}-${value(date.getSeconds())}`
}

async function currentSettingsCaptureState(targetWindow, requestedSection) {
  const state = await targetWindow.webContents.executeJavaScript(`(() => {
    const activeProfileTab = document.querySelector('[data-profile-tab].is-active')
    const profile = document.getElementById('character-profile')
    return {
      section: document.documentElement.dataset.settingsView,
      profileTab: activeProfileTab ? activeProfileTab.dataset.profileTab : 'basic',
      profileCollapsed: Boolean(profile && profile.classList.contains('is-collapsed')),
    }
  })()`, true)
  return {
    section: Object.hasOwn(SETTINGS_SECTION_LABELS, requestedSection)
      ? requestedSection
      : normalizedSection(state && state.section),
    profileTab: ['basic', 'world', 'actions', 'expressions', 'interactions'].includes(state && state.profileTab)
      ? state.profileTab
      : 'basic',
    profileCollapsed: Boolean(state && state.profileCollapsed),
  }
}

async function settingsBackgroundFrame(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return null
  const result = await targetWindow.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('settings-pet-background')
    const canvas = document.getElementById('settings-pet-background-canvas')
    return root && root.classList.contains('is-ready') && canvas
      ? {
          dataUrl: canvas.toDataURL('image/webp', .9),
          modelId: root.dataset.modelId || '',
          format: root.dataset.modelFormat || '',
        }
      : null
  })()`, true).catch(() => null)
  const match = result && /^data:image\/webp;base64,(.+)$/.exec(result.dataUrl || '')
  return match && result.modelId
    ? { modelId: result.modelId, format: result.format, frame: Buffer.from(match[1], 'base64') }
    : null
}

async function waitForScreenshotRenderer(targetWindow) {
  const ready = await targetWindow.webContents.executeJavaScript(`new Promise(resolve => {
    const startedAt = Date.now()
    const check = () => {
      if (window.settingsLongScreenshot && document.documentElement.dataset.settingsReady === 'true') {
        resolve(true)
      } else if (Date.now() - startedAt >= 5000) {
        resolve(false)
      } else {
        setTimeout(check, 25)
      }
    }
    check()
  })`, true)
  if (!ready) throw new Error('截图面板渲染超时')
}

async function captureSettingsPanelInBackground(sourceWindow, captureState, outputPath) {
  const backgroundFrame = await settingsBackgroundFrame(sourceWindow)
  const captureWindow = new BrowserWindow({
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#f3f0ff',
    resizable: false,
    maximizable: false,
    minimizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  settingsCaptureWindow = captureWindow
  secureLocalWindow(captureWindow)
  captureWindow.setMenu(null)

  try {
    await captureWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'), {
      query: { capture: '1' },
    })
    await waitForScreenshotRenderer(captureWindow)
    if (backgroundFrame) {
      sendToWindow(captureWindow, 'settings:pet-background-frame', backgroundFrame)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return await captureSettingsPanel({
      browserWindow: captureWindow,
      section: captureState.section,
      state: captureState,
      outputPath,
    })
  } finally {
    if (!captureWindow.isDestroyed()) captureWindow.destroy()
    if (settingsCaptureWindow === captureWindow) settingsCaptureWindow = null
  }
}

async function saveSettingsLongScreenshot(targetWindow, requestedSection) {
  if (!targetWindow || targetWindow.isDestroyed()) return { ok: false, error: '设置面板暂不可用' }
  if (!getPreferences().appLongScreenshotEnabled) {
    return { ok: false, error: '请先在系统页开启 APP 长截图' }
  }
  if (settingsScreenshotBusy) return { ok: false, error: 'APP 长截图正在保存，请稍候' }
  settingsScreenshotBusy = true

  try {
    await waitForSettingsReady(targetWindow)
    const captureState = await currentSettingsCaptureState(targetWindow, requestedSection)
    const section = captureState.section
    const label = SETTINGS_SECTION_LABELS[section]
    const defaultPath = path.join(
      app.getPath('pictures'),
      `Live2DCompanion-${label}-${screenshotTimestamp()}.png`
    )
    const choice = await dialog.showSaveDialog(targetWindow, {
      title: '保存 APP 长截图',
      defaultPath,
      buttonLabel: '保存长截图',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      properties: ['showOverwriteConfirmation'],
    })
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true }

    const outputPath = path.extname(choice.filePath).toLowerCase() === '.png'
      ? choice.filePath
      : `${choice.filePath}.png`
    const capture = await captureSettingsPanelInBackground(
      targetWindow,
      captureState,
      outputPath
    )
    return {
      ok: true,
      filePath: outputPath,
      fileName: path.basename(outputPath),
      ...capture,
    }
  } catch (error) {
    console.error('APP long screenshot failed:', error)
    return { ok: false, error: 'APP 长截图保存失败，请重试' }
  } finally {
    settingsScreenshotBusy = false
  }
}

async function captureSettingsFromTray() {
  try {
    openSettings()
    const targetWindow = settingsWindow
    await waitForSettingsReady(targetWindow)
    const result = await saveSettingsLongScreenshot(targetWindow)
    if (result.ok) sendToWindow(targetWindow, 'settings:notice', `长截图已保存：${result.fileName}`)
    else if (!result.canceled) sendToWindow(targetWindow, 'settings:notice', result.error || 'APP 长截图保存失败')
  } catch (error) {
    console.error('Unable to start APP long screenshot:', error)
    sendToWindow(settingsWindow, 'settings:notice', 'APP 长截图暂不可用')
  }
}

function togglePetVisibility() {
  if (!petWindow || petWindow.isDestroyed()) return
  // Windows 上 hide()/show() 可能破坏透明窗口的输入子窗口，而把窗口
  // 移到极远坐标又会触发 Chromium 遮挡优化，导致 WebGL 画布恢复后透明。
  // 窗口留在原位，仅切换透明度与鼠标命中，可同时保住输入和渲染上下文。
  if (!petOffScreen) {
    const stage = currentPetStageBounds()
    setPetChatOpen(false)
    setPetLongMessageLayout(false)
    petLastPosition = [stage.x, stage.y]
    petOffScreen = true
    stopCursorTracking()
    petWindow.setIgnoreMouseEvents(true)
    broadcastState('pet-visibility')
    petWindow.setOpacity(0)
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

function normalizedLongMessageReaderWidth(value) {
  const parsedWidth = Number(value)
  if (!Number.isFinite(parsedWidth)) return longMessageReaderWidth
  return Math.round(Math.min(
    LONG_MESSAGE_READER_MAX_WIDTH,
    Math.max(LONG_MESSAGE_READER_MIN_WIDTH, parsedWidth)
  ))
}

function previewPetLongMessageLayout(open, preferredWidth = longMessageReaderWidth) {
  if (!petWindow || petWindow.isDestroyed()) return petWindowLayoutPayload()
  const stage = currentPetStageBounds()
  const resolvedLayout = resolveLongMessageWindowLayout({
    stageBounds: stage,
    workArea: workAreaForPetStage(stage),
    expanded: Boolean(open),
    readerWidth: normalizedLongMessageReaderWidth(preferredWidth),
    gap: LONG_MESSAGE_READER_GAP,
  })
  const layoutChanged = !samePetWindowLayoutGeometry(petWindowLayout, resolvedLayout)
  return petWindowLayoutPayload({
    ...resolvedLayout,
    revision: layoutChanged ? petWindowLayout.revision + 1 : petWindowLayout.revision,
  })
}

function setPetLongMessageLayout(open, preferredWidth = longMessageReaderWidth) {
  if (!petWindow || petWindow.isDestroyed()) return petWindowLayoutPayload()
  longMessageReaderWidth = normalizedLongMessageReaderWidth(preferredWidth)
  const stage = currentPetStageBounds()
  longMessageLayoutOpen = Boolean(open)
  if (!longMessageLayoutOpen) longMessageReaderBounds = null
  placePetWindow(stage.x, stage.y)
  // placePetWindow sends an asynchronous notification whenever native geometry
  // changed; invoke callers also receive the authoritative layout immediately.
  return petWindowLayoutPayload()
}

function setPetLayoutTransitionActive(active) {
  const next = Boolean(active)
  if (petLayoutTransitionActive === next) return next
  petLayoutTransitionActive = next
  // The region list deliberately differs while the hand-off is active. Clear
  // the signature so Windows always receives the matching stage-only shape.
  petShapeRegionSignature = ''
  applyPetInteractionRegion()
  return next
}

async function capturePetStageTransitionFrame() {
  if (!petWindow || petWindow.isDestroyed()) return ''
  const stageOffsetX = Math.max(0, Math.round(Number(petWindowLayout.stageOffsetX) || 0))
  try {
    const image = await petWindow.capturePage({
      x: stageOffsetX,
      y: 0,
      width: PET_WIDTH,
      height: PET_HEIGHT,
    })
    return image && !image.isEmpty() ? image.toDataURL() : ''
  } catch (error) {
    console.warn('Pet stage transition capture failed:', error.message)
    return ''
  }
}

function aiCapabilityAvailability(capability) {
  const ai = aiPluginManager ? aiPluginManager.getSnapshot() : null
  const plugins = ai && Array.isArray(ai.plugins) ? ai.plugins : []
  const installed = plugins.filter(plugin => plugin.installed && plugin.capabilities.includes(capability))
  const configured = installed.filter(plugin => plugin.configured)
  const activeIds = ai && ai.activePluginIds ? ai.activePluginIds : {}
  const active = installed.find(plugin => plugin.id === activeIds[capability])
  return {
    configured: configured.length > 0,
    ready: Boolean(active && active.configured),
  }
}

function aiCapabilitySetupMessage(capability) {
  const availability = aiCapabilityAvailability(capability)
  const modelKind = capability === 'tts' ? '语音模型' : '文本模型'
  return availability.configured
    ? `${modelKind}尚未启用，请先启用${modelKind}`
    : `请先配置${modelKind}`
}

function openAIChat() {
  const availability = aiCapabilityAvailability('chat')
  if (!availability.ready) {
    openSettings('ai', aiCapabilitySetupMessage('chat'))
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

function emitExternalMessageEvent(event, publicEvent = event) {
  sendToWindow(petWindow, 'external-message:event', event)
  if (externalMessageServer) externalMessageServer.broadcast(publicEvent)
}

function externalMessageHistory() {
  const stored = store.get('externalMessageHistory')
  if (!Array.isArray(stored)) return []
  return stored
    .filter(item => item && typeof item === 'object' && typeof item.messageId === 'string')
    .slice(-EXTERNAL_MESSAGE_HISTORY_LIMIT)
}

function externalMessageHistoryItems({ limit = 100 } = {}) {
  const safeLimit = Math.min(EXTERNAL_MESSAGE_HISTORY_LIMIT, Math.max(1, Number(limit) || 100))
  return externalMessageHistory().slice(-safeLimit).reverse().map(publicExternalMessageHistoryItem)
}

function storedExternalMessageHistoryAudio(item) {
  if (!item || typeof item.audioArchivePath !== 'string' || !item.audioArchivePath) return null
  try {
    const root = fs.realpathSync.native(userTtsDir())
    const filePath = fs.realpathSync.native(item.audioArchivePath)
    const relative = path.relative(root, filePath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
    const stats = fs.statSync(filePath)
    if (!stats.isFile()) return null
    return {
      filePath,
      mimeType: item.result && item.result.speech && item.result.speech.mimeType
        ? item.result.speech.mimeType
        : 'audio/wav',
    }
  } catch (error) {
    return null
  }
}

function externalMessageHistoryAudio(messageId) {
  if (typeof messageId !== 'string' || !messageId) return null
  return storedExternalMessageHistoryAudio(externalMessageHistory().find(item => item.messageId === messageId))
}

function publicHistorySpeech(speech, messageId, audioAvailable) {
  if (!speech || typeof speech !== 'object') return speech
  const clean = { ...speech }
  delete clean.audioBase64
  delete clean.archivePath
  if (audioAvailable) clean.audioUrl = `/api/v1/history/audio/${encodeURIComponent(messageId)}`
  else delete clean.audioUrl
  return clean
}

function publicExternalMessageHistoryItem(item) {
  const audioAvailable = Boolean(storedExternalMessageHistoryAudio(item))
  const publicItem = { ...item, audioAvailable }
  delete publicItem.audioArchivePath
  if (item.request && typeof item.request === 'object') publicItem.request = { ...item.request }
  if (item.result && typeof item.result === 'object') {
    publicItem.result = {
      ...item.result,
      speech: publicHistorySpeech(item.result.speech, item.messageId, audioAvailable),
    }
  }
  if (item.response && typeof item.response === 'object') {
    publicItem.response = { ...item.response }
    if (item.response.result && typeof item.response.result === 'object') {
      publicItem.response.result = {
        ...item.response.result,
        speech: publicHistorySpeech(item.response.result.speech, item.messageId, audioAvailable),
      }
    }
  }
  if (Array.isArray(item.conversation)) publicItem.conversation = item.conversation.map(message => ({ ...message }))
  return publicItem
}

function clearExternalMessageHistory() {
  store.set('externalMessageHistory', [])
  return []
}

function updateExternalMessageHistory(message, patch) {
  const history = externalMessageHistory()
  const index = history.findIndex(item => item.messageId === message.id)
  const record = {
    messageId: message.id,
    requestId: message.requestId,
    sender: message.sender,
    transport: message.transport,
    source: 'external',
    sourceLabel: '外部',
    type: message.type,
    content: message.content,
    speak: message.speak,
    useCurrentCharacterProfile: message.useCurrentCharacterProfile,
    useExternalContext: message.useExternalContext,
    receivedAt: message.receivedAt,
    ...(index >= 0 ? history[index] : {}),
    ...patch,
  }
  if (index >= 0) history[index] = record
  else history.push(record)
  store.set('externalMessageHistory', history.slice(-EXTERNAL_MESSAGE_HISTORY_LIMIT))
  return record
}

function publicExternalMessageRequest(message) {
  return {
    messageId: message.id,
    requestId: message.requestId,
    source: message.source,
    sourceLabel: message.sourceLabel,
    sender: message.sender,
    transport: message.transport,
    type: message.type,
    content: message.content,
    speak: message.speak,
    useCurrentCharacterProfile: message.useCurrentCharacterProfile,
    useExternalContext: message.useExternalContext,
    receivedAt: message.receivedAt,
  }
}

function externalMessageConversation(message, replyText, completedAt) {
  const conversation = [{
    role: 'external',
    label: '外部消息',
    content: message.content,
    at: message.receivedAt,
  }]
  if (message.type === 'relay' && replyText) {
    conversation.push({ role: 'assistant', label: 'AI 回复', content: replyText, at: completedAt })
  }
  return conversation
}

async function waitForPetMessageSurface() {
  if (!petWindow || petWindow.isDestroyed()) throw new ExternalMessageError('桌宠窗口暂不可用', 503, 'PET_UNAVAILABLE')
  if (!petWindow.webContents.isLoadingMainFrame()) return
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new ExternalMessageError('桌宠窗口加载超时', 503, 'PET_NOT_READY'))
    }, 10000)
    const cleanup = () => {
      clearTimeout(timeout)
      petWindow.webContents.removeListener('did-finish-load', handleReady)
      petWindow.removeListener('closed', handleClosed)
    }
    const handleReady = () => {
      cleanup()
      resolve()
    }
    const handleClosed = () => {
      cleanup()
      reject(new ExternalMessageError('桌宠窗口已关闭', 503, 'PET_UNAVAILABLE'))
    }
    petWindow.webContents.once('did-finish-load', handleReady)
    petWindow.once('closed', handleClosed)
  })
}

async function showExternalMessageSurface() {
  if (petOffScreen) togglePetVisibility()
  await waitForPetMessageSurface()
  // 外部消息只使用角色上方的气泡，不触碰底部聊天框的显隐、输入、
  // 折叠或忙碌状态，也不抢走用户当前正在输入时的键盘焦点。
  petWindow.showInactive()
  petWindow.moveTop()
}

function publicSpeechResult(speech, requested) {
  if (!requested) return { requested: false, status: 'disabled' }
  if (!speech || speech.skipped) {
    return { requested: true, status: 'skipped', error: speech && speech.error ? speech.error : '未启用语音模型' }
  }
  if (!speech.ok) return { requested: true, status: 'failed', error: speech.error || '语音合成失败' }
  return {
    requested: true,
    status: 'ready',
    pluginId: speech.pluginId,
    model: speech.model,
    voice: speech.voice,
    format: speech.format,
    mimeType: speech.mimeType,
    cached: speech.cached === true,
  }
}

async function processExternalMessage(message) {
  const request = publicExternalMessageRequest(message)
  updateExternalMessageHistory(message, { status: 'processing', request })
  let text = message.content
  let emotion = ''
  let aiGenerated = false
  try {
    await showExternalMessageSurface()
    const initialStage = message.type === 'relay'
      ? 'thinking'
      : message.speak ? 'speech' : 'display'
    emitExternalMessageEvent({
      phase: 'received',
      stage: initialStage,
      progressText: initialStage === 'thinking'
        ? '思考中…'
        : initialStage === 'speech' ? '语音合成中…' : '',
      transient: initialStage !== 'display',
      message,
    })
    const current = selectedModel()
    if (message.type === 'relay') {
      const chatResult = await aiPluginManager.chat({
        text: message.content,
        modelId: current ? current.id : '',
        companionName: current ? modelDisplayName(current) : '伙伴',
        companionBaseName: current ? current.name : '',
        companionProfile: modelProfilePrompt(current),
        source: 'external',
        sourceLabel: message.sourceLabel,
        sender: message.sender,
        requestId: message.requestId,
        useCurrentCharacterProfile: message.useCurrentCharacterProfile,
        useExternalContext: message.useExternalContext,
      })
      text = chatResult.text
      emotion = chatResult.emotion || ''
      aiGenerated = true
      if (message.speak) {
        // 该事件只用于当前气泡的过程提示，不新增或改写
        // externalMessageHistory 中的对话消息。
        emitExternalMessageEvent({
          phase: 'progress',
          stage: 'speech',
          progressText: '语音合成中…',
          transient: true,
          message,
        })
      }
    }

    let speech = null
    if (message.speak) {
      try {
        speech = await aiPluginManager.synthesize({ text, source: 'external' })
      } catch (error) {
        speech = { ok: false, error: error.message }
      }
    }
    const speechSummary = publicSpeechResult(speech, message.speak)
    if (speechSummary.status === 'ready' && speech && speech.archivePath) {
      speechSummary.audioUrl = `/api/v1/history/audio/${encodeURIComponent(message.id)}`
    }
    const completedAt = new Date().toISOString()
    const response = {
      ok: true,
      requestId: message.requestId,
      messageId: message.id,
      source: message.source,
      sourceLabel: message.sourceLabel,
      sender: message.sender,
      type: message.type,
      result: { text, emotion, aiGenerated, speech: speechSummary },
      receivedAt: message.receivedAt,
      completedAt,
    }
    updateExternalMessageHistory(message, {
      status: 'completed',
      request,
      response,
      result: response.result,
      conversation: externalMessageConversation(message, text, completedAt),
      audioArchivePath: speech && typeof speech.archivePath === 'string' ? speech.archivePath : '',
      completedAt,
    })
    const completedEvent = {
      phase: 'completed',
      message,
      result: {
        text,
        emotion,
        aiGenerated,
        speech: speech ? { ...speech, ...speechSummary } : speechSummary,
        completedAt,
      },
    }
    emitExternalMessageEvent(completedEvent, {
      ...completedEvent,
      result: { ...completedEvent.result, speech: speechSummary },
    })
    return response
  } catch (error) {
    const failedAt = new Date().toISOString()
    const errorMessage = String(error && error.message ? error.message : '外部消息处理失败').slice(0, 240)
    emitExternalMessageEvent({
      phase: 'failed',
      message,
      error: errorMessage,
      failedAt,
    })
    updateExternalMessageHistory(message, {
      status: 'failed',
      request,
      response: {
        ok: false,
        requestId: message.requestId,
        messageId: message.id,
        code: error && error.code ? error.code : 'MESSAGE_PROCESSING_FAILED',
        error: errorMessage,
        receivedAt: message.receivedAt,
        failedAt,
      },
      conversation: externalMessageConversation(message),
      error: errorMessage,
      failedAt,
    })
    if (error instanceof ExternalMessageError) throw error
    throw new ExternalMessageError(error.message || '外部消息处理失败', 503, 'MESSAGE_PROCESSING_FAILED')
  }
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
  if (!preferences.externalMessagesEnabled && externalMessageTesterWindow && !externalMessageTesterWindow.isDestroyed()) {
    externalMessageTesterWindow.close()
  }
  if (externalMessageServer) {
    externalMessageServer.setEnabled(preferences.externalMessagesEnabled).catch(error => {
      console.warn('External message service toggle failed:', error.message)
    })
  }
  syncSettingsPetBackgroundCapture()
  if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
    // 光标轮询还承担窗口矩形命中检测（交互引导），光标跟随关闭时也要继续
    startCursorTracking()
    if (preferences.cursorFollow !== 'near') {
      sendToWindow(petWindow, 'cursor:move', { clientX: PET_WIDTH / 2, clientY: PET_HEIGHT / 2, near: false })
    }
  }
}

function applyAlwaysOnTop(targetWindow, enabled, level) {
  if (!targetWindow || targetWindow.isDestroyed()) return false
  const desiredLevel = enabled ? level : 'normal'
  const appliedState = appliedWindowLevels.get(targetWindow)
  if (
    appliedState &&
    appliedState.enabled === enabled &&
    appliedState.level === desiredLevel &&
    targetWindow.isAlwaysOnTop() === enabled
  ) return false

  targetWindow.setAlwaysOnTop(enabled, desiredLevel)
  appliedWindowLevels.set(targetWindow, { enabled, level: desiredLevel })
  return true
}

function syncWindowLevels() {
  const alwaysOnTop = getPreferences().alwaysOnTop
  // setAlwaysOnTop 会改变原生窗口样式。状态未变化时跳过调用，避免透明
  // WebGL 表面被无意义地移出并重新加入 DWM 合成树。
  applyAlwaysOnTop(petWindow, alwaysOnTop, 'screen-saver')
  // 两个工具窗口保持 normal：它们之间由系统焦点自然排序；置顶宠物
  // 则位于独立的 topmost Z 带。这样点击标题栏不会先遮住宠物、再把
  // 宠物抬回来，也就不会触发透明 WebGL 窗口的闪烁和抖动。
  applyAlwaysOnTop(settingsWindow, false, 'normal')
  applyAlwaysOnTop(externalMessageTesterWindow, false, 'normal')
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
    appLongScreenshotEnabled: value => Boolean(value),
    externalMessagesEnabled: value => Boolean(value),
    settingsTheme: value => ['glass', 'healing'].includes(value) ? value : currentPreferences.settingsTheme,
    bubbleStyles: value => normalizeBubbleStyles(value),
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

function requestPetInteraction(request = 'random') {
  if (!petWindow || petWindow.isDestroyed()) return
  if (petOffScreen) togglePetVisibility()
  if (petOffScreen) return
  const payload = typeof request === 'string' ? { kind: request } : request
  const allowedKinds = new Set([
    ...DEFAULT_PET_INTERACTIONS.map(item => item.kind),
    ...DEFAULT_PET_GESTURES.map(item => item.kind),
    'custom',
  ])
  sendToWindow(petWindow, 'pet:interact', {
    kind: allowedKinds.has(payload && payload.kind) ? payload.kind : 'random',
    actionId: sanitizeProfileValue(payload && payload.actionId, 180),
    label: sanitizeProfileValue(payload && payload.label, 24),
    text: sanitizeProfileValue(payload && payload.text, 80),
  })
}

function interactionMenuTemplate() {
  const current = selectedModel()
  if (!current) return [{ label: '暂无可用互动', enabled: false }]
  const availableActionIds = new Set((modelAssetCatalogs.get(current.id)?.actions || []).map(item => item.id))
  const items = modelInteractions(current.id)
    .filter(item => item.enabled)
    .map(item => {
      const mappingAvailable = !item.actionId || availableActionIds.has(item.actionId)
      return {
        label: mappingAvailable ? item.label : `${item.label}（动作不可用）`,
        enabled: mappingAvailable,
        click: () => requestPetInteraction({ kind: item.kind, actionId: item.actionId, label: item.label, text: item.text }),
      }
    })
  return items.length ? items : [{ label: '暂无已启用的互动', enabled: false }]
}

function aiMenuItem() {
  const availability = aiCapabilityAvailability('chat')
  if (!availability.ready) {
    const message = aiCapabilitySetupMessage('chat')
    return {
      label: `${message}…`,
      click: () => openSettings('ai', message),
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
  const settingsPanelVisible = Boolean(
    settingsWindow && !settingsWindow.isDestroyed() &&
    settingsWindow.isVisible() && !settingsWindow.isMinimized()
  )
  const externalMessageService = externalMessageServer && externalMessageServer.getSnapshot()
  const externalMessageTesterReady = Boolean(
    preferences.externalMessagesEnabled &&
    externalMessageService && externalMessageService.running
  )
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
    ...buildConditionalTrayItems({
      appLongScreenshotEnabled: preferences.appLongScreenshotEnabled,
      settingsPanelVisible,
      externalMessagesEnabled: preferences.externalMessagesEnabled,
      externalMessageTesterReady,
      captureSettingsFromTray,
      openExternalMessageTester,
    }),
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
    // The transparent host is wider than the visible character surface so it
    // can reserve both reader sides. Cursor-follow and character interaction
    // remain relative to the invariant 400x600 stage.
    const stageBounds = currentPetStageBounds()
    const near = distanceToBounds(point, stageBounds) <= CURSOR_NEAR_DISTANCE
    const moved = !lastCursor || Math.abs(point.x - lastCursor.x) >= 3 || Math.abs(point.y - lastCursor.y) >= 3

    const inside = point.x >= stageBounds.x && point.x < stageBounds.x + stageBounds.width &&
      point.y >= stageBounds.y && point.y < stageBounds.y + stageBounds.height

    // 光标位置经本轮询通道送渲染进程，供视线跟随使用。
    const sendFollow = preferences.cursorFollow === 'near' && (moved || near !== lastCursorNear)
    if (sendFollow || inside) {
      lastCursor = point
      lastCursorNear = near
      sendToWindow(petWindow, 'cursor:move', {
        clientX: point.x - stageBounds.x,
        clientY: point.y - stageBounds.y,
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

function refreshCursorTracking() {
  if (cursorTimer) clearTimeout(cursorTimer)
  cursorTimer = null
  lastCursor = null
  lastCursorNear = false
  startCursorTracking()
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
  const nativeCursor = screen.getCursorScreenPoint()
  const reportedCursor = dragCandidate.reportedCursor
  if (dragCandidate.useReportedCursor && Date.now() - dragCandidate.reportedAt > 800) {
    endPetDrag()
    return
  }
  const cursor = dragCandidate.useReportedCursor && reportedCursor ? reportedCursor : nativeCursor
  // 越窗松手/窗口失焦等场景下 mouseup 偶尔会丢失，dragActive 一直为真，
  // 宠物会追着真实光标漂移（用户常描述为"自己往一边飘"）。真正按住拖
  // 动时窗口跟随光标，光标应始终落在窗口内：光标离开窗口超过阈值即认
  // 为已经松手，主动结束拖拽，避免追光标。
  const bounds = currentPetStageBounds()
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
  const current = currentPetStageBounds()
  if (current.x !== targetX || current.y !== targetY) {
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

function normalizedDragPoint(point) {
  if (!point || !Number.isFinite(point.screenX) || !Number.isFinite(point.screenY)) return null
  return { x: Math.round(point.screenX), y: Math.round(point.screenY) }
}

function primePetDrag(_event, point) {
  if (!petWindow || petWindow.isDestroyed()) return
  // 上一次拖拽若因 mouseup 丢失仍处于激活（宠物在追光标），这次按下
  // 说明用户已重新抓取，先干净地结束上一次拖拽再记录新起点。
  if (dragActive) endPetDrag()
  const nativeCursor = screen.getCursorScreenPoint()
  const reportedCursor = normalizedDragPoint(point)
  dragCandidate = {
    // Store the stage origin, never the transparent outer-window origin. This
    // keeps the cursor-to-character offset independent from reader placement.
    bounds: currentPetStageBounds(),
    cursor: reportedCursor || nativeCursor,
    reportedCursor,
    reportedAt: reportedCursor ? Date.now() : 0,
    useReportedCursor: Boolean(reportedCursor && Math.hypot(reportedCursor.x - nativeCursor.x, reportedCursor.y - nativeCursor.y) > 3),
  }
}

function startPetDrag(event, point) {
  if (!petWindow || petWindow.isDestroyed()) return
  if (!dragCandidate) primePetDrag(event, point)
  const reportedCursor = normalizedDragPoint(point)
  if (reportedCursor) {
    const nativeCursor = screen.getCursorScreenPoint()
    dragCandidate.reportedCursor = reportedCursor
    dragCandidate.reportedAt = Date.now()
    if (Math.hypot(reportedCursor.x - nativeCursor.x, reportedCursor.y - nativeCursor.y) > 3) {
      dragCandidate.useReportedCursor = true
    }
  }
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

function updatePetDrag(_event, point) {
  // 真实鼠标优先使用系统光标；Windows 自动化/辅助输入若只派发指针
  // 事件而不移动系统光标，则锁定到渲染进程上报的屏幕坐标。
  const reportedCursor = normalizedDragPoint(point)
  if (dragCandidate && reportedCursor) {
    const nativeCursor = screen.getCursorScreenPoint()
    dragCandidate.reportedCursor = reportedCursor
    dragCandidate.reportedAt = Date.now()
    if (Math.hypot(reportedCursor.x - nativeCursor.x, reportedCursor.y - nativeCursor.y) > 3) {
      dragCandidate.useReportedCursor = true
    }
  }
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
    const stage = currentPetStageBounds()
    const position = safePetPosition(stage.x, stage.y)
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
  return movePetToPreset(INITIAL_USER_DEFAULTS.characters.windowPosition)
}

function isPetWindowSender(event) {
  return Boolean(
    event && event.sender && petWindow && !petWindow.isDestroyed() &&
    !petWindow.webContents.isDestroyed() && event.sender.id === petWindow.webContents.id
  )
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
  ipcMain.handle('ai:plugin-deactivate', (_event, pluginId, capability) => {
    try {
      const ai = aiPluginManager.deactivate(pluginId, capability)
      if (!ai.ready) setPetChatOpen(false)
      updateTrayMenu()
      broadcastState('ai-plugin-deactivated')
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
          companionBaseName: current ? current.name : '',
          companionProfile: modelProfilePrompt(current),
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
  ipcMain.handle('ai:conversation-get', (_event, modelId) => {
    const current = selectedModel()
    const requestedModelId = typeof modelId === 'string' && listModels().some(model => model.id === modelId)
      ? modelId
      : (current ? current.id : '')
    return aiPluginManager.getConversation(requestedModelId)
  })
  ipcMain.handle('settings:update', (_event, patch) => updatePreferences(patch))
  ipcMain.handle('settings:capture-long-screenshot', (event, section) => {
    if (!settingsWindow || settingsWindow.isDestroyed() || event.sender.id !== settingsWindow.webContents.id) {
      return { ok: false, error: '设置面板暂不可用' }
    }
    return saveSettingsLongScreenshot(settingsWindow, section)
  })
  ipcMain.handle('settings:reset', () => resetPreferences())
  ipcMain.handle('model:select', (_event, modelId) => ({ ok: selectModel(modelId), snapshot: getSnapshot() }))
  ipcMain.handle('model:reorder', (_event, modelIds) => {
    try {
      return { ok: true, snapshot: updateModelOrder(modelIds) }
    } catch (error) {
      return { ok: false, error: error.message, snapshot: getSnapshot() }
    }
  })
  ipcMain.handle('model:import-zip', () => importModelZip())
  ipcMain.handle('model:nickname-update', (_event, modelId, nickname) => {
    try {
      return { ok: true, snapshot: updateModelNickname(modelId, nickname) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('model:profile-update', (_event, modelId, patch) => {
    try {
      return { ok: true, snapshot: updateModelProfile(modelId, patch) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('model:interactions-update', (_event, modelId, interactions) => {
    try {
      return { ok: true, snapshot: updateModelInteractions(modelId, interactions) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('model:gestures-update', (_event, modelId, gestures) => {
    try {
      return { ok: true, snapshot: updateModelGestures(modelId, gestures) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('model:interaction-preview', (_event, modelId, request) => {
    const current = selectedModel()
    if (!current || current.id !== modelId) return { ok: false, error: '请先选择这个角色' }
    const actionId = sanitizeProfileValue(request && request.actionId, 180)
    const catalog = modelAssetCatalogs.get(modelId) || { actions: [] }
    if (actionId && !catalog.actions.some(item => item.id === actionId)) {
      return { ok: false, error: '映射的动作当前不可用' }
    }
    requestPetInteraction({
      kind: sanitizeProfileValue(request && request.kind, 24),
      actionId,
      label: sanitizeProfileValue(request && request.label, 24),
      text: sanitizeProfileValue(request && request.text, 80),
    })
    return { ok: true }
  })
  ipcMain.handle('model:preview', async (_event, modelId, kind, assetId) => {
    const current = selectedModel()
    if (!current || current.id !== modelId) return { ok: false, error: '请先选择这个角色' }
    const catalog = modelAssetCatalogs.get(modelId) || { actions: [], expressions: [] }
    const list = kind === 'expression' ? catalog.expressions : catalog.actions
    const asset = list.find(item => item.id === assetId)
    if (!asset) return { ok: false, error: '这个预览项目暂不可用' }
    if (!petWindow || petWindow.isDestroyed()) return { ok: false, error: '角色窗口暂不可用' }
    const requestId = `${Date.now()}-${++modelPreviewSequence}`
    const senderId = petWindow.webContents.id
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        pendingModelPreviews.delete(requestId)
        resolve({ ok: false, error: '预览启动超时，请重试' })
      }, 2500)
      pendingModelPreviews.set(requestId, { resolve, timer, senderId })
      sendToWindow(petWindow, 'model:preview', { requestId, modelId, kind, asset })
    })
  })
  ipcMain.handle('model:scale-update', (_event, modelId, scale) => {
    try {
      return { ok: true, snapshot: updateModelScale(modelId, scale) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('window:reset-pet-position', () => resetPetPosition())
  ipcMain.handle('window:move-pet', (_event, preset) => movePetToPreset(
    POSITION_PRESETS.includes(preset) ? preset : INITIAL_USER_DEFAULTS.characters.windowPosition
  ))
  ipcMain.handle('window:open-models-folder', () => shell.openPath(userModelsDir()).then(() => true).catch(() => false))
  ipcMain.handle('window:open-plugins-folder', () => shell.openPath(userPluginsDir()).then(() => true).catch(() => false))
  ipcMain.handle('external-message:open-tester', (_event, target = 'app') => (
    openExternalMessageTester(target === 'browser' ? 'browser' : 'app')
  ))
  ipcMain.handle('window:open-external', (_event, url) => {
    if (typeof url !== 'string' || /[\r\n]/.test(url)) return false
    try {
      const protocol = new URL(url).protocol
      if (!['https:', 'mailto:'].includes(protocol)) return false
      shell.openExternal(url)
      return true
    } catch (error) {
      return false
    }
  })
  ipcMain.handle('clipboard:write-text', (_event, value) => {
    // Copy the complete assistant response, never the clamped bubble preview.
    // The generous guard only protects the main process from accidental
    // unbounded payloads; current chat and external-message contracts are 2k.
    if (typeof value !== 'string' || !value || value.length > CLIPBOARD_TEXT_MAX_LENGTH) return false
    clipboard.writeText(value)
    return true
  })
  ipcMain.handle('pet:long-message-layout', (event, payload = {}) => {
    if (!isPetWindowSender(event)) throw new Error('Unauthorized pet window sender')
    const request = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    return setPetLongMessageLayout(Boolean(request.open), request.preferredWidth)
  })
  // renderer 先同步取得目标布局。右侧展开可直接提交；左侧展开还会在
  // 提交前后使用舞台快照和 stage-only shape 完成跨进程画面交接，避免
  // 原生窗口原点变化时暴露 Chromium 的旧表面。异步 handler 保留作
  // 兼容后备。
  ipcMain.on('pet:long-message-layout-preview', (event, payload = {}) => {
    if (!isPetWindowSender(event)) {
      event.returnValue = null
      return
    }
    const request = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    event.returnValue = previewPetLongMessageLayout(Boolean(request.open), request.preferredWidth)
  })
  ipcMain.on('pet:long-message-layout-commit', (event, payload = {}) => {
    if (!isPetWindowSender(event)) {
      event.returnValue = null
      return
    }
    const request = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    event.returnValue = setPetLongMessageLayout(Boolean(request.open), request.preferredWidth)
  })
  ipcMain.handle('pet:long-message-transition-frame', event => {
    if (!isPetWindowSender(event)) throw new Error('Unauthorized pet window sender')
    return capturePetStageTransitionFrame()
  })
  ipcMain.on('pet:long-message-transition-state', (event, active) => {
    if (!isPetWindowSender(event)) {
      event.returnValue = false
      return
    }
    event.returnValue = setPetLayoutTransitionActive(active)
  })

  ipcMain.on('window:open-settings', (_event, section) => openSettings(section))
  ipcMain.on('cursor:refresh', event => {
    if (!settingsWindow || settingsWindow.isDestroyed() || event.sender.id !== settingsWindow.webContents.id) return
    refreshCursorTracking()
  })
  ipcMain.on('window:open-ai-chat', openAIChat)
  ipcMain.on('window:settings-close', () => settingsWindow && settingsWindow.close())
  ipcMain.on('window:settings-minimize', () => settingsWindow && settingsWindow.minimize())
  ipcMain.on('window:tool-drag-start', startToolWindowDrag)
  ipcMain.on('window:tool-drag-move', moveToolWindowDrag)
  ipcMain.on('window:tool-drag-end', endToolWindowDrag)
  ipcMain.on('external-message:tester-close', event => {
    if (
      externalMessageTesterWindow && !externalMessageTesterWindow.isDestroyed()
      && event.sender.id === externalMessageTesterWindow.webContents.id
    ) externalMessageTesterWindow.close()
  })
  ipcMain.on('external-message:tester-minimize', event => {
    if (
      externalMessageTesterWindow && !externalMessageTesterWindow.isDestroyed()
      && event.sender.id === externalMessageTesterWindow.webContents.id
    ) externalMessageTesterWindow.minimize()
  })
  ipcMain.on('app:quit', () => app.quit())
  ipcMain.on('pet:show-context-menu', event => {
    if (isPetWindowSender(event)) showPetContextMenu()
  })
  ipcMain.on('ai:chat-panel-state', (event, open) => {
    if (isPetWindowSender(event)) setPetChatOpen(open)
  })
  ipcMain.on('settings:pet-background-frame', (event, payload) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender.id !== petWindow.webContents.id) return
    if (!shouldCaptureSettingsPetBackground()) return
    if (payload === null) {
      sendToWindow(settingsWindow, 'settings:pet-background-frame', null)
      return
    }
    const current = selectedModel()
    if (
      !payload || typeof payload !== 'object' || !current ||
      payload.modelId !== current.id || payload.format !== current.format
    ) return
    const frame = payload.frame
    const byteLength = frame && Number(frame.byteLength)
    if (!Number.isFinite(byteLength) || byteLength <= 0 || byteLength > 512 * 1024) return
    sendToWindow(settingsWindow, 'settings:pet-background-frame', payload)
  })
  ipcMain.on('pet:bubble-bounds', (event, bounds) => {
    if (!isPetWindowSender(event)) return
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

  ipcMain.on('pet:status-bounds', (event, bounds) => {
    if (!isPetWindowSender(event)) return
    if (
      bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) &&
      Number.isFinite(bounds.width) && Number.isFinite(bounds.height) &&
      bounds.width > 0 && bounds.height > 0
    ) {
      const left = Math.max(0, Math.floor(bounds.x - 10))
      const top = Math.max(0, Math.floor(bounds.y - 10))
      const right = Math.min(PET_WIDTH, Math.ceil(bounds.x + bounds.width + 10))
      const bottom = Math.min(PET_HEIGHT, Math.ceil(bounds.y + bounds.height + 10))
      statusToastBounds = { x: left, y: top, width: right - left, height: bottom - top }
    } else {
      statusToastBounds = null
    }
    applyPetInteractionRegion()
  })

  ipcMain.on('pet:long-message-bounds', (event, bounds) => {
    if (!isPetWindowSender(event)) return
    if (bounds === null) {
      longMessageReaderBounds = null
      applyPetInteractionRegion()
      return
    }
    if (
      !longMessageLayoutOpen || !bounds || typeof bounds !== 'object' ||
      !Number.isInteger(bounds.revision) || bounds.revision !== petWindowLayout.revision
    ) return
    const normalized = clampPetWindowRegion(bounds)
    if (!normalized) return
    longMessageReaderBounds = { ...normalized, revision: bounds.revision }
    applyPetInteractionRegion()
  })

  ipcMain.on('pet:drag-prime', (event, point) => {
    if (isPetWindowSender(event)) primePetDrag(event, point)
  })
  ipcMain.on('pet:drag-start', (event, point) => {
    if (isPetWindowSender(event)) startPetDrag(event, point)
  })
  ipcMain.on('pet:drag-move', (event, point) => {
    if (isPetWindowSender(event)) updatePetDrag(event, point)
  })
  ipcMain.on('pet:drag-end', event => {
    if (isPetWindowSender(event)) endPetDrag()
  })

  ipcMain.on('pet:hit-bounds', (event, bounds) => {
    if (!isPetWindowSender(event)) return
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
  ipcMain.on('model:assets-report', (event, payload) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return
    const modelId = payload && typeof payload.modelId === 'string' ? payload.modelId : ''
    if (!modelId || !listModels().some(model => model.id === modelId)) return
    modelAssetCatalogs.set(modelId, normalizeModelAssetCatalog(payload))
    updateTrayMenu()
    broadcastState('model-assets-updated')
  })
  ipcMain.on('model:preview-result', (event, payload) => {
    const requestId = payload && typeof payload.requestId === 'string' ? payload.requestId : ''
    const pending = pendingModelPreviews.get(requestId)
    if (!pending || event.sender.id !== pending.senderId) return
    clearTimeout(pending.timer)
    pendingModelPreviews.delete(requestId)
    if (!payload.ok) {
      pending.resolve({ ok: false, error: String(payload.error || '预览启动失败').slice(0, 120) })
      return
    }
    const reported = payload.preview && typeof payload.preview === 'object' ? payload.preview : {}
    const frame = typeof reported.frame === 'string' && reported.frame.length <= 700000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(reported.frame)
      ? reported.frame
      : ''
    pending.resolve({
      ok: true,
      preview: {
        modelId: String(reported.modelId || '').slice(0, 120),
        kind: reported.kind === 'expression' ? 'expression' : 'action',
        assetId: String(reported.assetId || '').slice(0, 180),
        active: Boolean(reported.active),
        restoreAfterMs: Math.min(10000, Math.max(1000, Number(reported.restoreAfterMs) || 3600)),
        changedParameters: Math.max(0, Number(reported.changedParameters) || 0),
        parameterDelta: Math.max(0, Number(reported.parameterDelta) || 0),
        largestParameterDelta: Math.max(0, Number(reported.largestParameterDelta) || 0),
        frame,
      },
    })
  })
  ipcMain.on('model:preview-restored', (event, payload) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender.id !== petWindow.webContents.id) return
    const current = selectedModel()
    const modelId = payload && typeof payload.modelId === 'string' ? payload.modelId : ''
    const kind = payload && payload.kind === 'expression' ? 'expression' : 'action'
    const assetId = payload && typeof payload.assetId === 'string' ? payload.assetId : ''
    if (!current || current.id !== modelId || !assetId) return
    sendToWindow(settingsWindow, 'model:preview-restored', { modelId, kind, assetId })
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  migrateStore()
  const shouldOpenInitialSettings = store.get('initialSettingsShown') !== true
  aiPluginManager = createAIPluginManager({
    pluginsDirectories: pluginDirectories(),
    store,
    safeStorage,
    ttsDirectory: userTtsDir(),
  })
  externalMessageServer = createExternalMessageServer({
    testerPath: path.join(__dirname, 'renderer', 'external-message-tester.html'),
    handleMessage: processExternalMessage,
    getHistory: externalMessageHistoryItems,
    getHistoryAudio: externalMessageHistoryAudio,
    clearHistory: clearExternalMessageHistory,
    onStatusChanged: () => {
      updateTrayMenu()
      if (petWindow || settingsWindow) broadcastState('external-message-service')
    },
  })
  setupIPC()
  createPetWindow()
  // 分发后的机器可能有任意数量、排列和缩放比例的显示器，也可能在
  // 程序运行期间插拔屏幕或修改缩放。统一重新确认当前 shape 所属 DPI。
  screen.on('display-added', schedulePetShapeRefresh)
  screen.on('display-removed', schedulePetShapeRefresh)
  screen.on('display-metrics-changed', schedulePetShapeRefresh)
  createTray()
  applyPreferences()
  startCursorTracking()
  if (shouldOpenInitialSettings) openSettings('characters')
})

app.on('second-instance', () => openSettings())

app.on('before-quit', () => {
  appIsQuitting = true
  if (aiPluginManager) aiPluginManager.dispose()
  if (externalMessageServer) externalMessageServer.dispose().catch(() => {})
  endPetDrag()
  stopCursorTracking()
  if (petShapeRefreshTimer) clearTimeout(petShapeRefreshTimer)
  petShapeRefreshTimer = null
  if (positionSaveTimer) clearTimeout(positionSaveTimer)
  persistPetPosition()
})

app.on('window-all-closed', () => {})
