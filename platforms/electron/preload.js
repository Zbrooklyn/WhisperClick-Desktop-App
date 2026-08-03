/**
 * preload.js — pywebview API compatibility shim for Electron
 *
 * Exposes window.pywebview.api with the same methods the V3 frontend expects,
 * but routes all calls through Electron IPC.  The V3 inline JS uses
 * callNativeApi(method, ...args) → window.pywebview.api[method](...args),
 * so this shim makes the V3 frontend work unmodified in Electron.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  tray_click_action: 'trayClickAction',
  auto_enter_mode: 'autoEnterMode',
  debug_logging: 'debugLogging',
  custom_vocabulary: 'customVocabulary',
  active_snippet: 'activeSnippet',
  snippet_templates: 'snippetTemplates',
  recording_sound: 'recordingSound',
  post_processing_enabled: 'postProcessingEnabled',
  post_processing_prompt: 'postProcessingPrompt',
  voice_commands: 'voiceCommands',
  smart_punctuation: 'smartPunctuation',
  live_streaming: 'liveStreaming',
  continuous_listening: 'continuousListening',
  voice_corrections: 'voiceCorrections',
  confidence_highlighting: 'confidenceHighlighting',
  license_key: 'licenseKey',
  license_token: 'licenseToken',
  license_tier: 'licenseTier',
  license_last_validated: 'licenseLastValidated',
  managed_proxy_url: 'managedProxyUrl',
  meeting_mode: 'meetingMode',
  obsidian_vault_path: 'obsidianVaultPath',
  active_integration: 'activeIntegration',
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

// System-audio capture state (loopback via getDisplayMedia; main grants it).
let _sysStream = null, _sysRecorder = null, _sysChunks = [], _sysMime = '';
function _pickSysMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const o of opts) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(o)) return o;
  }
  return '';
}

// Seed version immediately so the UI never shows stale/missing version
ipcRenderer.invoke('get-app-info').then((info) => {
  if (!latestUpdateStatus) {
    latestUpdateStatus = { status: 'idle', currentVersion: info.version };
  }
  // Inject version into footer as soon as DOM is ready
  const setVersion = () => {
    const el = document.getElementById('app-version');
    if (el) el.textContent = 'v' + info.version;
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setVersion);
  } else {
    setVersion();
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

ipcRenderer.on('update-success', (_e, data) => {
  window.dispatchEvent(new CustomEvent('update-success', { detail: data }));
});

ipcRenderer.on('pill-hidden', () => {
  // Dispatch a custom event so the frontend can sync the pill toggle
  window.dispatchEvent(new CustomEvent('pill-hidden'));
});

// Forward state-update so the frontend stays in sync with externally-triggered
// recording changes (tray toggle, pill toggle, hotkey when window is hidden).
ipcRenderer.on('state-update', (_e, data) => {
  window.dispatchEvent(new CustomEvent('state-update', { detail: data }));
});

ipcRenderer.on('show-enter-button', () => {
  window.dispatchEvent(new CustomEvent('show-enter-button'));
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

    // ── Premium: license activation / external links / meeting control ──────
    // These back the injected Pro settings UIs (pro-license-ui, pro-meeting-ui).
    // The free build never injects those UIs, so these channels simply go unused.
    async get_license() {
      return await ipcRenderer.invoke('get_license');
    },
    async pro_activate(key) {
      return await ipcRenderer.invoke('pro-activate', key);
    },
    async pro_deactivate() {
      return await ipcRenderer.invoke('pro-deactivate');
    },
    async open_external(url) {
      return await ipcRenderer.invoke('open-external', url);
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

    // ── Recording controls (Batch C parity) ────────────────────────────────
    async pause_recording() {
      return await ipcRenderer.invoke('pause_recording');
    },
    async resume_recording() {
      return await ipcRenderer.invoke('resume_recording');
    },
    async is_recording_paused() {
      return await ipcRenderer.invoke('is_recording_paused');
    },
    async get_audio_prefs() {
      return await ipcRenderer.invoke('get_audio_prefs');
    },
    async set_audio_prefs(prefs) {
      return await ipcRenderer.invoke('set_audio_prefs', prefs);
    },
    async redo_start() {
      return await ipcRenderer.invoke('redo_start');
    },
    async redo_stop() {
      return await ipcRenderer.invoke('redo_stop');
    },

    async get_recording_state() {
      const s = await ipcRenderer.invoke('get-state');
      return {
        is_recording: s.state === 'recording',
        is_processing: s.state === 'processing',
        cancel_requested: false,
      };
    },

    async ack_state() {
      return await ipcRenderer.invoke('ack-state');
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
      const failures = (await ipcRenderer.invoke('get-decrypt-failures').catch(() => null)) || {};
      return {
        success: true,
        openai: settings.openaiApiKey || '',
        gemini: settings.geminiApiKey || '',
        openai_decrypt_failed: !!failures.openaiApiKey,
        gemini_decrypt_failed: !!failures.geminiApiKey,
      };
    },

    async get_migration_notice() {
      return await ipcRenderer.invoke('get-migration-notice').catch(() => null);
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

    // Paginated + search (Batch D parity). Signature matches web-shim:
    // get_history_page(limit, offset, q) → {items,total,offset,limit}.
    async get_history_page(limit, offset, q) {
      return await ipcRenderer.invoke('get_history_page', { limit, offset, query: q || '' });
    },

    // Persist edited text + enrichment (summary/action_items/speakers/title).
    async update_history_text(id, text, extra) {
      return await ipcRenderer.invoke('update_history_text', { id, text, ...(extra || {}) });
    },

    async delete_history(id) {
      await ipcRenderer.invoke('delete-history', id);
      return { success: true };
    },

    // Pro data portability (import from Free / backup / restore).
    async data_scan_free() { return await ipcRenderer.invoke('data-scan-free'); },
    async data_import_free() { return await ipcRenderer.invoke('data-import-free'); },
    async data_backup() { return await ipcRenderer.invoke('data-backup'); },
    async data_restore() { return await ipcRenderer.invoke('data-restore'); },

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

    async simulate_enter() {
      return await ipcRenderer.invoke('simulate-enter');
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
