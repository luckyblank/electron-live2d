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
  importModelZip: () => ipcRenderer.invoke('model:import-zip'),
  updateModelNickname: (modelId, nickname) => ipcRenderer.invoke('model:nickname-update', modelId, nickname),
  updateModelScale: (modelId, scale) => ipcRenderer.invoke('model:scale-update', modelId, scale),
  resetPetPosition: () => ipcRenderer.invoke('window:reset-pet-position'),
  movePetPreset: preset => ipcRenderer.invoke('window:move-pet', preset),
  openModelsFolder: () => ipcRenderer.invoke('window:open-models-folder'),
  openPluginsFolder: () => ipcRenderer.invoke('window:open-plugins-folder'),
  openExternalUrl: url => ipcRenderer.invoke('window:open-external', url),
  openAIChat: () => ipcRenderer.send('window:open-ai-chat'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  cancelUpdateDownload: () => ipcRenderer.send('update:cancel-download'),
  openUpdateInstaller: () => ipcRenderer.send('update:open-installer'),
  ignoreUpdateVersion: version => ipcRenderer.send('update:ignore-version', version),
  installAIPlugin: pluginId => ipcRenderer.invoke('ai:plugin-install', pluginId),
  activateAIPlugin: (pluginId, capability) => ipcRenderer.invoke('ai:plugin-activate', pluginId, capability),
  uninstallAIPlugin: pluginId => ipcRenderer.invoke('ai:plugin-uninstall', pluginId),
  configureAIPlugin: (pluginId, config) => ipcRenderer.invoke('ai:plugin-configure', pluginId, config),
  testAIPlugin: pluginId => ipcRenderer.invoke('ai:plugin-test', pluginId),
  onUpdateProgress: callback => subscribe('update:progress', callback),
  closeWindow: () => ipcRenderer.send('window:settings-close'),
  minimizeWindow: () => ipcRenderer.send('window:settings-minimize'),
  quitApp: () => ipcRenderer.send('app:quit'),
  onStateChanged: callback => subscribe('state:changed', callback),
  onNavigate: callback => subscribe('settings:navigate', callback),
  onPetBackgroundFrame: callback => subscribe('settings:pet-background-frame', callback),
})
