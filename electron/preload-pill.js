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

  // Click-through toggle — called on mouseenter/mouseleave of visible content
  // so transparent areas pass clicks to apps behind the pill window.
  setIgnoreMouse: (ignore) => ipcRenderer.send('pill-set-ignore-mouse', ignore),

  // Auto-Enter: show enter button after transcription
  onShowEnterButton: (cb) => ipcRenderer.on('show-enter-button', (_, data) => cb(data)),
  simulateEnter: () => ipcRenderer.invoke('simulate-enter'),
});
