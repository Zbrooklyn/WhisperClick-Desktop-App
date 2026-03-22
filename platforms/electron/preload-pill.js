const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Render — main process tells pill exactly what to display
  onRender: (cb) => ipcRenderer.on('pill-render', (_, data) => cb(data)),

  // Click — pill tells main what was clicked, main decides the action
  click: (action) => ipcRenderer.invoke('pill-clicked', action),

  // Window-level concerns (unchanged)
  setIgnoreMouse: (ignore) => ipcRenderer.send('pill-set-ignore-mouse', ignore),
  showContextMenu: () => ipcRenderer.invoke('pill-context-menu'),
});
