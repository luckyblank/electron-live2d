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
  setMouseCapture: capture => ipcRenderer.send('pet:set-mouse-capture', Boolean(capture)),
  dragPrime: () => ipcRenderer.send('pet:drag-prime'),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  reportModelStatus: status => ipcRenderer.send('model:report-status', status),
  onStateChanged: callback => subscribe('state:changed', callback),
  onCursorMove: callback => subscribe('cursor:move', callback),
  onPauseChanged: callback => subscribe('pet:pause-changed', callback),
}
