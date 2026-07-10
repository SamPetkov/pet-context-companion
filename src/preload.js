const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petCompanion', {
  getOverview: () => ipcRenderer.invoke('companion:overview'),
  hide: () => ipcRenderer.invoke('companion:hide'),
  openTask: (threadId) => ipcRenderer.invoke('companion:open-task', threadId),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('companion:set-ignore-mouse-events', ignore),
  onOverview: (listener) => {
    const handler = (_event, overview) => listener(overview);
    ipcRenderer.on('companion:overview', handler);
    return () => ipcRenderer.removeListener('companion:overview', handler);
  },
  onRestore: (listener) => {
    ipcRenderer.on('companion:restore', listener);
    return () => ipcRenderer.removeListener('companion:restore', listener);
  },
  onVoiceToggle: (listener) => {
    ipcRenderer.on('companion:voice-toggle', listener);
    return () => ipcRenderer.removeListener('companion:voice-toggle', listener);
  },
});
