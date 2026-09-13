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
  updateModelScale: (modelId, scale) => ipcRenderer.invoke('model:scale-update', modelId, scale),
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
  reportBubbleBounds: bounds => ipcRenderer.send('pet:bubble-bounds', bounds),
  reportStatusBounds: bounds => ipcRenderer.send('pet:status-bounds', bounds),
  reportModelStatus: status => ipcRenderer.send('model:report-status', status),
  reportModelAssets: assets => ipcRenderer.send('model:assets-report', assets),
  reportModelPreviewResult: result => ipcRenderer.send('model:preview-result', result),
  reportModelPreviewRestored: result => ipcRenderer.send('model:preview-restored', result),
  onModelPreview: callback => subscribe('model:preview', callback),
  onStateChanged: callback => subscribe('state:changed', callback),
  onCursorMove: callback => subscribe('cursor:move', callback),
  onPauseChanged: callback => subscribe('pet:pause-changed', callback),
  onInteractionRequested: callback => subscribe('pet:interact', callback),
  sendAIMessage: text => ipcRenderer.invoke('ai:chat', { text }),
  synthesizeSpeech: text => ipcRenderer.invoke('ai:speech-synthesize', { text }),
  clearAIConversation: () => ipcRenderer.invoke('ai:conversation-clear'),
  getAIConversation: modelId => ipcRenderer.invoke('ai:conversation-get', modelId),
  setChatPanelOpen: open => ipcRenderer.send('ai:chat-panel-state', Boolean(open)),
  onChatVisibility: callback => subscribe('ai:chat-visibility', callback),
  sendSettingsPetBackgroundFrame: frame => ipcRenderer.send('settings:pet-background-frame', frame),
  onSettingsPetBackgroundCapture: callback => subscribe('settings:pet-background-capture', callback),
}
