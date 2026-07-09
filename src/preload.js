const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petCompanion', {
  getOverview: () => ipcRenderer.invoke('companion:overview'),
  hide: () => ipcRenderer.invoke('companion:hide'),
  onOverview: (listener) => {
    const handler = (_event, overview) => listener(overview);
    ipcRenderer.on('companion:overview', handler);
    return () => ipcRenderer.removeListener('companion:overview', handler);
  },
});

