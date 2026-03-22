/**
 * Tauri Bridge — maps window.pywebview.api.* → Tauri invoke()
 *
 * Drop-in replacement for Electron's preload.js. The V3 frontend calls
 * window.pywebview.api.method(...args) and this bridge routes to Tauri
 * commands with the same snake_case→camelCase translation.
 *
 * Loaded as a script tag in index.html when running under Tauri.
 */

(function () {
  'use strict';

  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  // Settings translation: V3 snake_case → Tauri/store camelCase
  const V3_TO_STORE = {
    auto_copy: 'autoPaste',
    start_with_windows: 'autoStart',
    close_behavior: 'closeBehavior',
    sound_enabled: 'soundEnabled',
    always_on_top: 'alwaysOnTop',
    show_pill_widget: 'showPill',
    api_provider: 'provider',
    api_model: 'apiModel',
    output_mode: 'outputMode',
    model: 'localModel',
    target_language: 'targetLanguage',
    source_language: 'sourceLanguage',
    api_base_url: 'customBaseUrl',
    pill_monitor: 'pillMonitor',
    audio_retention_days: 'audioRetentionDays',
    auto_enter_mode: 'autoEnterMode',
    tray_click_action: 'trayClickAction',
    debug_logging: 'debugLogging',
  };

  const STORE_TO_V3 = Object.fromEntries(
    Object.entries(V3_TO_STORE).map(([k, v]) => [v, k])
  );

  function patchToStore(v3Patch) {
    const storePatch = {};
    for (const [key, value] of Object.entries(v3Patch)) {
      storePatch[V3_TO_STORE[key] || key] = value;
    }
    return storePatch;
  }

  function settingsToV3(storeSettings) {
    const v3 = {};
    for (const [key, value] of Object.entries(storeSettings)) {
      v3[STORE_TO_V3[key] || key] = value;
    }
    return v3;
  }

  // Event listeners cache
  const eventListeners = {};

  function addEventListener(event, callback) {
    if (!eventListeners[event]) eventListeners[event] = [];
    eventListeners[event].push(callback);
  }

  // Forward Tauri events to window custom events (same as Electron preload)
  listen('state-update', (event) => {
    window.dispatchEvent(new CustomEvent('state-update', { detail: event.payload }));
  });

  listen('transcription', (event) => {
    window.dispatchEvent(new CustomEvent('transcription', { detail: event.payload }));
  });

  listen('translation', (event) => {
    window.dispatchEvent(new CustomEvent('translation', { detail: event.payload }));
  });

  listen('level-update', (event) => {
    window.dispatchEvent(new CustomEvent('level-update', { detail: event.payload }));
  });

  listen('sidecar-error', (event) => {
    window.dispatchEvent(new CustomEvent('sidecar-error', { detail: event.payload }));
  });

  listen('pill-hidden', () => {
    window.dispatchEvent(new CustomEvent('pill-hidden'));
  });

  listen('show-enter-button', (event) => {
    window.dispatchEvent(new CustomEvent('show-enter-button', { detail: event.payload }));
  });

  // Build the pywebview API shim
  window.pywebview = {
    api: {
      async get_settings() {
        const settings = await invoke('get_settings');
        return settingsToV3(settings);
      },

      async save_settings(patch) {
        const storePatch = patchToStore(patch);
        return await invoke('save_settings', { patch: storePatch });
      },

      async start_recording() {
        return await invoke('start_recording');
      },

      async stop_recording() {
        return await invoke('stop_recording');
      },

      async cancel_processing() {
        return await invoke('cancel_processing');
      },

      async get_recording_state() {
        const s = await invoke('get_state');
        return {
          is_recording: s.state === 'recording',
          is_processing: s.state === 'processing',
          cancel_requested: false,
        };
      },

      async ack_state() {
        return await invoke('ack_state');
      },

      async simulate_enter() {
        return await invoke('simulate_enter');
      },

      async get_history() {
        return await invoke('get_history');
      },

      async delete_history(id) {
        return await invoke('delete_history', { id });
      },

      async clear_history() {
        return await invoke('clear_history');
      },

      async get_audio(id) {
        return await invoke('get_audio', { id });
      },

      async export_transcription(text, format) {
        return await invoke('export_transcription', { text, format });
      },

      async paste_last_transcript() {
        return await invoke('paste_last_transcript');
      },

      async copy_to_clipboard(text) {
        return await invoke('copy_to_clipboard', { text });
      },

      async list_models() {
        return await invoke('list_models');
      },

      async download_model(name) {
        return await invoke('download_model', { name });
      },

      async delete_model(name) {
        return await invoke('delete_model', { name });
      },

      async list_mics() {
        return await invoke('list_mics');
      },

      async set_mic(id) {
        return await invoke('set_mic', { id });
      },

      async verify_api_key(provider, key) {
        return await invoke('verify_api_key', { provider, key });
      },

      async get_app_info() {
        return await invoke('get_app_info');
      },

      async reset_settings() {
        return await invoke('reset_settings');
      },

      async toggle_pill() {
        return await invoke('toggle_pill');
      },

      async show_main_window() {
        return await invoke('show_main_window');
      },

      async show_settings() {
        return await invoke('show_settings');
      },

      async hide_pill() {
        return await invoke('hide_pill');
      },

      async minimize() {
        return await invoke('window_minimize');
      },

      async maximize() {
        return await invoke('window_maximize');
      },

      async close() {
        return await invoke('window_close');
      },

      async is_maximized() {
        return await invoke('window_is_maximized');
      },
    },
  };

  // Signal that the bridge is ready
  window.pywebview._isReady = true;
  window.dispatchEvent(new CustomEvent('pywebview-ready'));
})();
