const { ipcRenderer } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')

// Absolute file URL to Cubism Core for the renderer
const cubismCorePath = pathToFileURL(path.join(__dirname, 'static', 'live2dcubismcore.min.js')).href

// Expose the pet API to the renderer. contextIsolation is false because
// live2d-renderer is require()-d directly in the renderer (needs Node.js).
window.petAPI = {
  cubismCorePath,

  listModels: () => ipcRenderer.invoke('model:list'),
  getCurrentModel: () => ipcRenderer.invoke('model:get-current'),
  setCurrentModel: (p) => ipcRenderer.invoke('model:set-current', p),
  selectModel: (p) => ipcRenderer.send('model:user-select', p),
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  getScreenBounds: () => ipcRenderer.invoke('screen:bounds'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setScale: (scale) => ipcRenderer.invoke('settings:set-scale', scale),
  setClickThrough: (enabled) => ipcRenderer.invoke('settings:set-click-through', enabled),

  quitApp: () => ipcRenderer.send('app:quit'),

  // Click-through: toggle whether transparent areas pass mouse events through
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('window:set-ignore-mouse-events', ignore),

  // Manual window dragging (replaces native -webkit-app-region:drag)
  dragStart: () => ipcRenderer.send('window:drag-start'),
  dragTo: (dx, dy) => ipcRenderer.send('window:drag-to', { dx, dy }),
  dragEnd: () => ipcRenderer.send('window:drag-end'),

  // Model change from tray
  onModelChanged: (cb) => {
    const handler = (_e, p) => cb(p)
    ipcRenderer.on('model:changed', handler)
    return () => ipcRenderer.removeListener('model:changed', handler)
  },

  // Cursor position relative to window center (for mouse-follow)
  onCursorMove: (cb) => {
    const handler = (_e, pos) => cb(pos)
    ipcRenderer.on('cursor:move', handler)
    return () => ipcRenderer.removeListener('cursor:move', handler)
  },
}
