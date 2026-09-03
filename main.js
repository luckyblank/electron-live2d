const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
const fs = require('fs')
const Store = require('electron-store')

const WINDOW_WIDTH = 400
const WINDOW_HEIGHT = 600
const POSITION_SAVE_DELAY = 150

// Prevent multiple pets from competing for the same tray icon and settings.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  return
}


// ── Store ──────────────────────────────────────────
const store = new Store({
  defaults: {
    windowX: undefined,
    windowY: undefined,
    currentModel: '',
    scale: 1,
    clickThrough: false,
  },
})

// ── Model discovery ────────────────────────────────
let _modelsCache = null

function listModels() {
  if (_modelsCache) return _modelsCache
  const dir = path.join(__dirname, 'static', 'models')
  if (!fs.existsSync(dir)) return []
  const models = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== '_repo')
    .map(e => {
      const sub = path.join(dir, e.name)
      try {
        const files = fs.readdirSync(sub)
        const model3 = files.find(f => f.toLowerCase().endsWith('.model3.json'))
        if (model3) return { name: e.name, path: pathToFileURL(path.join(sub, model3)).href }
        const zip = files.find(f => f.toLowerCase().endsWith('.zip'))
        if (zip) return { name: e.name, path: pathToFileURL(path.join(sub, zip)).href }
      } catch (error) {
        console.warn(`Skipping unreadable model directory ${e.name}:`, error.message)
      }
      return null
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  // Prioritize hiyori as default
  const hiyoriIndex = models.findIndex(m => m.name === 'hiyori')
  if (hiyoriIndex > 0) {
    const hiyori = models.splice(hiyoriIndex, 1)[0]
    models.unshift(hiyori)
  }
  _modelsCache = models
  return models
}

function refreshModels() {
  _modelsCache = null
  return listModels()
}

function isKnownModel(modelPath) {
  return typeof modelPath === 'string' && listModels().some(model => model.path === modelPath)
}

// ── Window ─────────────────────────────────────────
/** @type {BrowserWindow|null} */
let win = null
let positionSaveTimer = null

function getSafeWindowPosition(savedX, savedY) {
  const fallbackDisplay = screen.getPrimaryDisplay()
  const point = {
    x: Number.isFinite(savedX) ? savedX : fallbackDisplay.workArea.x + fallbackDisplay.workArea.width - 440,
    y: Number.isFinite(savedY) ? savedY : fallbackDisplay.workArea.y + fallbackDisplay.workArea.height - 640,
  }
  const display = screen.getDisplayNearestPoint(point)
  const { x, y, width, height } = display.workArea
  return {
    x: Math.min(Math.max(point.x, x), x + Math.max(0, width - WINDOW_WIDTH)),
    y: Math.min(Math.max(point.y, y), y + Math.max(0, height - WINDOW_HEIGHT)),
  }
}

function persistWindowPosition() {
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  store.set({ windowX: x, windowY: y })
}

function schedulePositionSave() {
  if (positionSaveTimer) clearTimeout(positionSaveTimer)
  positionSaveTimer = setTimeout(() => {
    positionSaveTimer = null
    persistWindowPosition()
  }, POSITION_SAVE_DELAY)
}

function createWindow() {
  const savedX = store.get('windowX')
  const savedY = store.get('windowY')
  const position = getSafeWindowPosition(savedX, savedY)

  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    useContentSize: true,
    x: position.x,
    y: position.y,
    transparent: true,
    frame: false,
    autoHideMenuBar: true,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: false,
    icon: path.join(__dirname, 'resources', 'icon.png'),
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false, // required for require() in renderer (Electron 20+ defaults sandbox=true)
      webSecurity: false, // allow file:// URLs in dynamic <script> tags
    },
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // Click-through is off by default; only enabled if user toggled it on.
  const clickThrough = store.get('clickThrough')
  win.setIgnoreMouseEvents(clickThrough, { forward: clickThrough })

  // DevTools in development mode
  if (process.argv.includes('--dev') || process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`Renderer [${level}] ${sourceId}:${line} -> ${message}`)
  })

  win.on('close', () => {
    stopCursorTracking()
    if (positionSaveTimer) clearTimeout(positionSaveTimer)
    persistWindowPosition()
  })

  // Window move: debounce writes because dragging can emit many events per second.
  win.on('moved', schedulePositionSave)
  win.on('hide', stopCursorTracking)
  win.on('show', startCursorTracking)
  win.on('closed', () => { win = null })
}

// ── Tray ───────────────────────────────────────────
/** @type {Tray|null} */
let tray = null

function createTray() {
  const iconPath = path.join(__dirname, 'resources', 'icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    tray = new Tray(nativeImage.createEmpty())
  } else {
    tray = new Tray(icon.resize({ width: 16, height: 16 }))
  }
  tray.setToolTip('Live2D Pet')
  tray.on('click', () => {
    if (!win || win.isDestroyed()) return
    win.isVisible() ? win.hide() : win.show()
  })
  updateTrayMenu()
}

function updateTrayMenu() {
  const models = listModels()
  const current = store.get('currentModel')

  const menu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏',
      click: () => {
        if (win) {
          win.isVisible() ? win.hide() : win.show()
        }
      },
    },  
    { type: 'separator' },
    {
      label: '切换模型',
      submenu: models.length > 0
        ? models.map(m => ({
            label: m.name + (m.path === current ? ' ✓' : ''),
            type: 'radio',
            checked: m.path === current,
            click: () => {
              store.set('currentModel', m.path)
              win && win.webContents.send('model:changed', m.path)
              updateTrayMenu()
            },
          }))
        : [{ label: '(无模型)', enabled: false }],
    },
    { type: 'separator' },
    {
      label: '刷新模型列表',
      click: () => {
        refreshModels()
        updateTrayMenu()
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ])
  tray && tray.setContextMenu(menu)
}

// ── Cursor tracking for mouse-follow ───────────────
let cursorInterval = null
let _lastCursorPos = null

function startCursorTracking() {
  if (cursorInterval) return
  cursorInterval = setInterval(() => {
    if (!win || win.isDestroyed()) return
    try {
      const pos = screen.getCursorScreenPoint()
      // Skip IPC when cursor barely moved - avoids redundant messages while idle
      if (_lastCursorPos && Math.abs(pos.x - _lastCursorPos.x) < 2 && Math.abs(pos.y - _lastCursorPos.y) < 2) return
      _lastCursorPos = pos
      const [wx, wy] = win.getPosition()
      const size = win.getSize()
      const cx = pos.x - (wx + size[0] / 2)
      const cy = pos.y - (wy + size[1] / 2)
      win.webContents.send('cursor:move', { x: cx, y: cy })
    } catch (_) { /* ignore */ }
  }, 50)
}

function stopCursorTracking() {
  if (cursorInterval) {
    clearInterval(cursorInterval)
    cursorInterval = null
  }
}

let dragStartBounds = null

// ── IPC ────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('model:list', () => listModels())
  ipcMain.handle('model:get-current', () => {
    const current = store.get('currentModel')
    if (current) return current
    // Default to hiyori if nothing saved
    const models = listModels()
    if (models.length > 0) return models[0].path
    return null
  })

  ipcMain.handle('model:set-current', (_event, path) => {
    if (!isKnownModel(path)) return false
    store.set('currentModel', path)
    updateTrayMenu()
    return true
  })
  ipcMain.handle('settings:get', () => ({ scale: store.get('scale'), clickThrough: store.get('clickThrough') }))
  ipcMain.handle('settings:set-scale', (_event, value) => {
    const scale = Math.min(2, Math.max(0.5, Number(value) || 1))
    store.set('scale', scale)
    return scale
  })

  ipcMain.handle('settings:set-click-through', (_event, enabled) => {
    store.set('clickThrough', !!enabled)
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(!!enabled, { forward: !!enabled })
    }
    return !!enabled
  })
  ipcMain.handle('window:get-state', () => ({
    x: store.get('windowX'),
    y: store.get('windowY'),
  }))

  ipcMain.handle('screen:bounds', () => {
    const display = screen.getPrimaryDisplay()
    const { x, y, width, height } = display.workArea
    return { x, y, width, height }
  })

  ipcMain.on('app:quit', () => app.quit())

  ipcMain.on('model:user-select', (_event, modelPath) => {
    if (!isKnownModel(modelPath)) return
    store.set('currentModel', modelPath)
    updateTrayMenu()
    win && win.webContents.send('model:changed', modelPath)
  })

  // Click-through toggle for transparent areas
  ipcMain.on('window:set-ignore-mouse-events', (_event, ignore) => {
    if (!win || win.isDestroyed()) return
    win.setIgnoreMouseEvents(ignore, { forward: true })
  })

  // Manual window dragging (replaces -webkit-app-region:drag so the
  // canvas can receive click events for interaction)
  ipcMain.on('window:drag-start', () => {
    if (!win || win.isDestroyed()) return
    dragStartBounds = win.getBounds()
  })

  ipcMain.on('window:drag-to', (_event, payload) => {
    if (!win || win.isDestroyed() || !dragStartBounds) return
    win.setBounds({
      x: dragStartBounds.x + payload.dx,
      y: dragStartBounds.y + payload.dy,
      width: dragStartBounds.width,
      height: dragStartBounds.height,
    })
  })

  ipcMain.on('window:drag-end', () => {
    dragStartBounds = null
    schedulePositionSave()
  })
}

// ── App lifecycle ──────────────────────────────────
app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  setupIPC()
  createWindow()
  createTray()
  startCursorTracking()
})

app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

app.on('before-quit', () => {
  if (positionSaveTimer) clearTimeout(positionSaveTimer)
  persistWindowPosition()
  stopCursorTracking()
})

app.on('window-all-closed', () => {})
