const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // State
  getState: () => ipcRenderer.invoke('get-state'),
  onStateUpdate: (cb) => ipcRenderer.on('state-update', (_, data) => cb(data)),
  onLevelUpdate: (cb) => ipcRenderer.on('level-update', (_, val) => cb(val)),

  // Recording — routes through V3 frontend so pill and main window share state
  toggleRecording: () => ipcRenderer.invoke('pill-toggle-recording'),

  // Native context menu (replaces clipped HTML menu)
  showContextMenu: () => ipcRenderer.invoke('pill-context-menu'),

  // Cancel recording — discards audio, goes dormant
  cancelRecording: () => ipcRenderer.invoke('cancel-processing'),
});
