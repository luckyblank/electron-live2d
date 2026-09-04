const { ipcRenderer } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')

const cubismCorePath = pathToFileURL(path.join(__dirname, 'static', 'live2dcubismcore.min.js')).href

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

window.petAPI = {
  cubismCorePath,
  getSnapshot: () => ipcRenderer.invoke('state:get-snapshot'),
  updatePreferences: patch => ipcRenderer.invoke('settings:update', patch),
  selectModel: modelId => ipcRenderer.invoke('model:select', modelId),
  openSettings: section => ipcRenderer.send('window:open-settings', section),
  showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
  dragPrime: (screenX, screenY) => ipcRenderer.send('pet:drag-prime', { screenX, screenY }),
  dragStart: (screenX, screenY) => ipcRenderer.send('pet:drag-start', { screenX, screenY }),
  dragMove: (screenX, screenY) => ipcRenderer.send('pet:drag-move', { screenX, screenY }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  onDragAborted: callback => subscribe('pet:drag-aborted', callback),
  saveCover: (modelId, dataURL) => ipcRenderer.send('pet:save-cover', modelId, dataURL),
  onCoversRequest: callback => subscribe('covers:request', callback),
  reportHitBounds: bounds => ipcRenderer.send('pet:hit-bounds', bounds),
  reportModelStatus: status => ipcRenderer.send('model:report-status', status),
  onStateChanged: callback => subscribe('state:changed', callback),
  onCursorMove: callback => subscribe('cursor:move', callback),
  onPauseChanged: callback => subscribe('pet:pause-changed', callback),
  onInteractionRequested: callback => subscribe('pet:interact', callback),
}
