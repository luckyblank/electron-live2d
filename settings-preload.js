const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('settingsAPI', {
  getSnapshot: () => ipcRenderer.invoke('state:get-snapshot'),
  updatePreferences: patch => ipcRenderer.invoke('settings:update', patch),
  resetPreferences: () => ipcRenderer.invoke('settings:reset'),
  selectModel: modelId => ipcRenderer.invoke('model:select', modelId),
  resetPetPosition: () => ipcRenderer.invoke('window:reset-pet-position'),
  movePetPreset: preset => ipcRenderer.invoke('window:move-pet', preset),
  openModelsFolder: () => ipcRenderer.invoke('window:open-models-folder'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openUpdateDownload: () => ipcRenderer.send('update:open-download'),
  closeWindow: () => ipcRenderer.send('window:settings-close'),
  minimizeWindow: () => ipcRenderer.send('window:settings-minimize'),
  quitApp: () => ipcRenderer.send('app:quit'),
  onStateChanged: callback => subscribe('state:changed', callback),
  onNavigate: callback => subscribe('settings:navigate', callback),
})
