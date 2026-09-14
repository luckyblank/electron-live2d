const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('externalTesterAPI', Object.freeze({
  isElectron: true,
  minimizeWindow: () => ipcRenderer.send('external-message:tester-minimize'),
  closeWindow: () => ipcRenderer.send('external-message:tester-close'),
  startWindowDrag: (screenX, screenY) => ipcRenderer.send('window:tool-drag-start', { screenX, screenY }),
  moveWindowDrag: (screenX, screenY) => ipcRenderer.send('window:tool-drag-move', { screenX, screenY }),
  endWindowDrag: () => ipcRenderer.send('window:tool-drag-end'),
}))
