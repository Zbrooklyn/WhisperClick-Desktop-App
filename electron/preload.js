/**
 * preload.js — pywebview API compatibility shim for Electron
 *
 * Exposes window.pywebview.api with the same methods the V3 frontend expects,
 * but routes all calls through Electron IPC.  The V3 inline JS uses
 * callNativeApi(method, ...args) → window.pywebview.api[method](...args),
 * so this shim makes the V3 frontend work unmodified in Electron.
 */

const { contextBridge, ipcRenderer } = require('electron');

// ---------------------------------------------------------------------------
// Settings field-name translation (V3 snake_case ↔ Electron camelCase)
// ---------------------------------------------------------------------------

const V3_TO_ELECTRON = {
  model: 'localModel',
  auto_copy: 'autoPaste',
  start_with_windows: 'autoStart',
  close_behavior: 'closeBehavior',
  sound_enabled: 'soundEnabled',
  always_on_top: 'alwaysOnTop',
  show_pill_widget: 'showPill',
  api_provider: 'provider',
  api_model: 'apiModel',
  output_mode: 'outputMode',
  target_language: 'targetLanguage',
  source_language: 'sourceLanguage',
  api_base_url: 'customBaseUrl',
  pill_monitor: 'pillMonitor',
  audio_retention_days: 'audioRetentionDays',
  auto_download_updates: 'autoDownloadUpdates',
};

const ELECTRON_TO_V3 = {};
for (const [k, v] of Object.entries(V3_TO_ELECTRON)) {
  ELECTRON_TO_V3[v] = k;
}

function patchToElectron(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    out[V3_TO_ELECTRON[k] || k] = v;
  }
  return out;
}

function settingsToV3(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings)) {
    out[ELECTRON_TO_V3[k] || k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Push-event state (stored so polling-based V3 code can read latest values)
// ---------------------------------------------------------------------------

let latestDownloadProgress = null;
let latestUpdateStatus = null;

// Seed version immediately so the UI never shows stale/missing version
ipcRenderer.invoke('get-app-info').then((info) => {
  if (!latestUpdateStatus) {
    latestUpdateStatus = { status: 'idle', currentVersion: info.version };
  }
}).catch(() => {});

ipcRenderer.on('model-download-progress', (_e, data) => {
  const { current, total, model } = data || {};
  const prog = total > 0 ? current / total : 0;
  latestDownloadProgress = {
    status: prog >= 0.999 ? 'complete' : 'downloading',
    progress: prog,
    model,
    current,
    total,
  };
});

ipcRenderer.on('update-status', (_e, data) => {
  latestUpdateStatus = data;
});

ipcRenderer.on('pill-hidden', () => {
  // Dispatch a custom event so the frontend can sync the pill toggle
  window.dispatchEvent(new CustomEvent('pill-hidden'));
});

// ---------------------------------------------------------------------------
// Expose window.pywebview.api
// ---------------------------------------------------------------------------

contextBridge.exposeInMainWorld('pywebview', {
  api: {
    // ── Settings ──────────────────────────────────────────────────────────
    async get_settings() {
      const s = await ipcRenderer.invoke('get-settings');
      const v3 = settingsToV3(s);
      // Filter API keys from settings response (V3 does this for security)
      delete v3.openai_api_key;
      delete v3.gemini_api_key;
      delete v3.openaiApiKey;
      delete v3.geminiApiKey;
      return v3;
    },

    async save_settings(patch) {
      const electronPatch = patchToElectron(patch);
      await ipcRenderer.invoke('save-settings', electronPatch);
      return { success: true };
    },

    // ── Factory reset ──────────────────────────────────────────────────────
    async reset_settings() {
      return await ipcRenderer.invoke('reset-settings');
    },

    // ── Recording ─────────────────────────────────────────────────────────
    async start_recording() {
      return await ipcRenderer.invoke('start-recording');
    },

    async stop_recording() {
      return await ipcRenderer.invoke('stop-recording');
    },

    async cancel_processing() {
      return await ipcRenderer.invoke('cancel-processing');
    },

    async get_recording_state() {
      const s = await ipcRenderer.invoke('get-state');
      return {
        is_recording: s.state === 'recording',
        is_processing: s.state === 'processing',
        cancel_requested: false,
      };
    },

    // ── Models ────────────────────────────────────────────────────────────
    async get_models() {
      const result = await ipcRenderer.invoke('list-models');
      if (result && result.error) return [];
      // Sidecar returns { models: [...] } or an array directly
      if (Array.isArray(result)) return result;
      if (result && Array.isArray(result.models)) return result.models;
      return [];
    },

    async set_model(name) {
      await ipcRenderer.invoke('save-settings', { localModel: name });
      return { success: true };
    },

    async download_model(name) {
      const result = await ipcRenderer.invoke('download-model', name);
      if (result && result.error) return { success: false, error: result.error };
      return { success: true };
    },

    async delete_model(name) {
      const result = await ipcRenderer.invoke('delete-model', name);
      if (result && result.error) return { success: false, error: result.error };
      return { success: true };
    },

    async get_download_progress() {
      if (latestDownloadProgress) return latestDownloadProgress;
      return { status: 'idle', progress: 0 };
    },

    // ── Microphones ───────────────────────────────────────────────────────
    async get_microphones() {
      const result = await ipcRenderer.invoke('list-mics');
      if (result && result.error) return [];
      if (Array.isArray(result)) return result;
      if (result && Array.isArray(result.mics)) return result.mics;
      if (result && Array.isArray(result.devices)) return result.devices;
      return [];
    },

    async set_microphone(id) {
      const result = await ipcRenderer.invoke('set-mic', id);
      if (result && result.error) return { success: false, error: result.error };
      return { success: true };
    },

    // ── API Keys ──────────────────────────────────────────────────────────
    async get_api_keys() {
      const settings = await ipcRenderer.invoke('get-settings');
      return {
        success: true,
        openai: settings.openaiApiKey || '',
        gemini: settings.geminiApiKey || '',
      };
    },

    async set_api_key(provider, key) {
      const field = provider === 'gemini' ? 'geminiApiKey' : 'openaiApiKey';
      await ipcRenderer.invoke('save-settings', { [field]: key });
      return { success: true };
    },

    async verify_api_key(provider, key, baseUrl) {
      const result = await ipcRenderer.invoke('verify-api-key', provider, key, baseUrl);
      return {
        success: true,
        valid: !!result.valid,
        error: result.valid ? undefined : (result.message || 'Verification failed'),
      };
    },

    // ── History ───────────────────────────────────────────────────────────
    async get_history() {
      return await ipcRenderer.invoke('get-history');
    },

    async delete_history(id) {
      await ipcRenderer.invoke('delete-history', id);
      return { success: true };
    },

    async clear_history() {
      await ipcRenderer.invoke('clear-history');
      return { success: true };
    },

    // ── Clipboard ─────────────────────────────────────────────────────────
    async copy_to_clipboard(text) {
      return await ipcRenderer.invoke('copy-to-clipboard', text);
    },

    async paste_last_transcript() {
      return await ipcRenderer.invoke('paste-last-transcript');
    },

    // ── Window controls ───────────────────────────────────────────────────
    async minimize() {
      return await ipcRenderer.invoke('window-minimize');
    },

    async close() {
      return await ipcRenderer.invoke('window-close');
    },

    async toggle_maximize() {
      return await ipcRenderer.invoke('window-maximize');
    },

    async is_maximized() {
      return await ipcRenderer.invoke('window-is-maximized');
    },

    // No-ops — Electron uses -webkit-app-region: drag CSS instead
    async drag_start() {},
    async nc_resize_start() {},

    // ── App info ──────────────────────────────────────────────────────────
    async get_version() {
      const info = await ipcRenderer.invoke('get-app-info');
      return { version: info.version, dev: info.isDev };
    },

    // ── Monitors / Pill ───────────────────────────────────────────────────
    async get_monitors() {
      const displays = await ipcRenderer.invoke('get-displays');
      return displays.map(d => ({ index: d.id, label: d.label }));
    },

    async set_pill_display(idx) {
      return await ipcRenderer.invoke('move-pill-to-display', idx);
    },

    async toggle_pill() {
      return await ipcRenderer.invoke('toggle-pill');
    },

    // ── Audio playback ────────────────────────────────────────────────────
    async get_audio(historyId) {
      return await ipcRenderer.invoke('get-audio', historyId);
    },

    // ── Export ─────────────────────────────────────────────────────────────
    async export_transcription(text, format) {
      return await ipcRenderer.invoke('export-transcription', text, format);
    },

    // ── Auto-updater ─────────────────────────────────────────────────────
    async check_for_updates() {
      return await ipcRenderer.invoke('check-for-updates');
    },
    async download_update() {
      return await ipcRenderer.invoke('download-update');
    },
    async install_update() {
      return await ipcRenderer.invoke('install-update');
    },
    async set_update_channel(channel) {
      return await ipcRenderer.invoke('set-update-channel', channel);
    },
    async get_update_channel() {
      return await ipcRenderer.invoke('get-update-channel');
    },
    async get_update_status() {
      return latestUpdateStatus || { status: 'idle' };
    },
  },
});
