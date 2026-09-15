const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('longMessageAPI', {
  onState: callback => subscribe('long-message-reader:state', callback),
  requestState: () => ipcRenderer.send('long-message-reader:request-state'),
  sendAction: action => ipcRenderer.send('long-message-reader:action', action),
  reportRendered: revision => ipcRenderer.send('long-message-reader:rendered', revision),
  writeClipboardText: text => ipcRenderer.invoke('clipboard:write-text', text),
})
