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
  openExternalUrl: url => ipcRenderer.invoke('window:open-external', url),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  cancelUpdateDownload: () => ipcRenderer.send('update:cancel-download'),
  openUpdateInstaller: () => ipcRenderer.send('update:open-installer'),
  ignoreUpdateVersion: version => ipcRenderer.send('update:ignore-version', version),
  onUpdateProgress: callback => subscribe('update:progress', callback),
  closeWindow: () => ipcRenderer.send('window:settings-close'),
  minimizeWindow: () => ipcRenderer.send('window:settings-minimize'),
  quitApp: () => ipcRenderer.send('app:quit'),
  onStateChanged: callback => subscribe('state:changed', callback),
  onNavigate: callback => subscribe('settings:navigate', callback),
})
