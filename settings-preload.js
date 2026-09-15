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
  reorderModels: modelIds => ipcRenderer.invoke('model:reorder', modelIds),
  importModelZip: () => ipcRenderer.invoke('model:import-zip'),
  updateModelNickname: (modelId, nickname) => ipcRenderer.invoke('model:nickname-update', modelId, nickname),
  updateModelProfile: (modelId, profile) => ipcRenderer.invoke('model:profile-update', modelId, profile),
  updateModelInteractions: (modelId, interactions) => ipcRenderer.invoke('model:interactions-update', modelId, interactions),
  updateModelGestures: (modelId, gestures) => ipcRenderer.invoke('model:gestures-update', modelId, gestures),
  previewModelInteraction: (modelId, interaction) => ipcRenderer.invoke('model:interaction-preview', modelId, interaction),
  previewModelAsset: (modelId, kind, assetId) => ipcRenderer.invoke('model:preview', modelId, kind, assetId),
  updateModelScale: (modelId, scale) => ipcRenderer.invoke('model:scale-update', modelId, scale),
  resetPetPosition: () => ipcRenderer.invoke('window:reset-pet-position'),
  movePetPreset: preset => ipcRenderer.invoke('window:move-pet', preset),
  refreshCursorFollow: () => ipcRenderer.send('cursor:refresh'),
  openModelsFolder: () => ipcRenderer.invoke('window:open-models-folder'),
  openPluginsFolder: () => ipcRenderer.invoke('window:open-plugins-folder'),
  openExternalUrl: url => ipcRenderer.invoke('window:open-external', url),
  openExternalMessageTester: target => ipcRenderer.invoke(
    'external-message:open-tester',
    target === 'browser' ? 'browser' : 'app'
  ),
  copyText: value => ipcRenderer.invoke('clipboard:write-text', value),
  captureLongScreenshot: section => ipcRenderer.invoke('settings:capture-long-screenshot', section),
  openAIChat: () => ipcRenderer.send('window:open-ai-chat'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  cancelUpdateDownload: () => ipcRenderer.send('update:cancel-download'),
  openUpdateInstaller: () => ipcRenderer.send('update:open-installer'),
  ignoreUpdateVersion: version => ipcRenderer.send('update:ignore-version', version),
  installAIPlugin: pluginId => ipcRenderer.invoke('ai:plugin-install', pluginId),
  activateAIPlugin: (pluginId, capability) => ipcRenderer.invoke('ai:plugin-activate', pluginId, capability),
  deactivateAIPlugin: (pluginId, capability) => ipcRenderer.invoke('ai:plugin-deactivate', pluginId, capability),
  configureAIPlugin: (pluginId, config) => ipcRenderer.invoke('ai:plugin-configure', pluginId, config),
  testAIPlugin: pluginId => ipcRenderer.invoke('ai:plugin-test', pluginId),
  onUpdateProgress: callback => subscribe('update:progress', callback),
  closeWindow: () => ipcRenderer.send('window:settings-close'),
  minimizeWindow: () => ipcRenderer.send('window:settings-minimize'),
  startWindowDrag: (screenX, screenY) => ipcRenderer.send('window:tool-drag-start', { screenX, screenY }),
  moveWindowDrag: (screenX, screenY) => ipcRenderer.send('window:tool-drag-move', { screenX, screenY }),
  endWindowDrag: () => ipcRenderer.send('window:tool-drag-end'),
  quitApp: () => ipcRenderer.send('app:quit'),
  onStateChanged: callback => subscribe('state:changed', callback),
  onNavigate: callback => subscribe('settings:navigate', callback),
  onNotice: callback => subscribe('settings:notice', callback),
  onModelPreviewRestored: callback => subscribe('model:preview-restored', callback),
  onPetBackgroundFrame: callback => subscribe('settings:pet-background-frame', callback),
  acknowledgePetBackgroundFrame: sequence => ipcRenderer.send('settings:pet-background-frame-ack', sequence),
})
