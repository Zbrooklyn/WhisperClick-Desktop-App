/**
 * Tauri Pill Bridge — maps window.electronAPI.* → Tauri invoke()
 *
 * Drop-in replacement for Electron's preload-pill.js.
 * The pill widget calls window.electronAPI.method() and this bridge
 * routes to Tauri commands.
 */

(function () {
  'use strict';

  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  window.electronAPI = {
    // Render — Tauri sends pill-render events
    onRender: (cb) => {
      listen('pill-render', (event) => cb(event.payload));
    },

    // Click — pill tells Tauri what was clicked
    click: (action) => invoke('pill_clicked', { action }),

    // Window-level concerns
    setIgnoreMouse: (ignore) => invoke('pill_set_ignore_mouse', { ignore }),
    showContextMenu: () => invoke('pill_context_menu'),
  };
})();
