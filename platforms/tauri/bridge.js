/**
 * Tauri Bridge — maps window.pywebview.api.* → Tauri invoke()
 *
 * Drop-in replacement for Electron's preload.js. The V3 frontend calls
 * window.pywebview.api.method(...args) and this bridge routes to Tauri
 * commands with the same snake_case→camelCase translation.
 *
 * Includes convenience methods that match Electron preload exactly
 * (get_models, get_microphones, get_api_keys, set_api_key, etc.)
 */

(function () {
  'use strict';

  // initialization_script runs after Tauri injects __TAURI__ — direct access is safe
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  // Debug mode: enabled in Tauri debug builds, disabled in production
  // Force debug ON for now — Tauri doesn't set __TAURI_INTERNALS__.metadata.debug reliably
  const _IS_DEBUG = true;

  // --- Forward JS console + errors to Rust stdout ---
  function _jsLog(level, msg) {
    if (!_IS_DEBUG) return;
    try { invoke('js_log', { level, msg: String(msg).substring(0, 500) }); } catch (_) {}
  }
  if (_IS_DEBUG) {
    const _origError = console.error;
    const _origWarn = console.warn;
    console.error = function(...args) { _jsLog('error', args.join(' ')); _origError.apply(console, args); };
    console.warn = function(...args) { _jsLog('warn', args.join(' ')); _origWarn.apply(console, args); };
    window.onerror = function(msg, src, line, col, err) {
      _jsLog('error', `${msg} at ${src}:${line}:${col} ${err?.stack || ''}`);
    };
    window.onunhandledrejection = function(e) {
      _jsLog('error', `Unhandled rejection: ${e.reason}`);
    };
  }

  // --- Debug logging overlay ---
  const _debugLogs = [];
  let _debugPanel = null;
  function _debugLog(msg) {
    if (!_IS_DEBUG) return;
    const ts = new Date().toLocaleTimeString();
    const entry = `[${ts}] ${msg}`;
    _debugLogs.push(entry);
    if (_debugLogs.length > 50) _debugLogs.shift();
    _jsLog('debug', msg);
    if (_debugPanel) {
      _debugPanel.textContent = _debugLogs.slice(-15).join('\n');
    }
  }
  // Create debug panel when DOM is ready
  function _createDebugPanel() {
    if (_debugPanel) return;
    const el = document.createElement('div');
    el.id = 'bridge-debug';
    el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:180px;overflow-y:auto;' +
      'background:rgba(0,0,0,0.85);color:#0f0;font:11px monospace;padding:6px 8px;z-index:99999;' +
      'pointer-events:auto;white-space:pre-wrap;display:none;';
    document.body.appendChild(el);
    _debugPanel = el;
    // Toggle with Ctrl+Shift+D
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
        if (el.style.display === 'block') {
          el.textContent = _debugLogs.slice(-15).join('\n');
        }
      }
    });
    _debugLog('Debug panel ready (Ctrl+Shift+D to toggle)');
  }
  // Try immediately, then on DOMContentLoaded
  if (_IS_DEBUG) {
    if (document.body) _createDebugPanel();
    else document.addEventListener('DOMContentLoaded', _createDebugPanel);
  }

  // Wrap invoke to log all calls
  const _rawInvoke = invoke;
  function trackedInvoke(cmd, args) {
    if (!_IS_DEBUG) return _rawInvoke(cmd, args);
    _debugLog(`→ invoke("${cmd}", ${JSON.stringify(args || {}).substring(0, 100)})`);
    return _rawInvoke(cmd, args).then(result => {
      const preview = JSON.stringify(result)?.substring(0, 120) || 'undefined';
      _debugLog(`← ${cmd}: ${preview}`);
      return result;
    }).catch(err => {
      _debugLog(`✗ ${cmd}: ERROR ${err}`);
      throw err;
    });
  }

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
    auto_download_updates: 'autoDownloadUpdates',
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

  // Cache for model download progress (populated by events)
  let _downloadProgress = null;

  // Forward Tauri events to window custom events (same as Electron preload)
  // Track last state — used by stop_recording's race guard and debug logging
  window._debugAppState = 'dormant';
  listen('state-update', (event) => {
    const prev = window._debugAppState;
    window._debugAppState = event.payload?.state || 'unknown';
    _debugLog(`[state-update] ${prev} → ${window._debugAppState} (payload: ${JSON.stringify(event.payload)})`);
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

  listen('model-download-progress', (event) => {
    // Transform raw {model, current, total} → status object (matches Electron preload)
    const { current, total, model } = event.payload || {};
    const prog = total > 0 ? current / total : 0;
    _downloadProgress = {
      status: prog >= 0.999 ? 'complete' : 'downloading',
      progress: prog,
      model,
      current,
      total,
    };
    _debugLog(`download progress: ${current}/${total} (${(prog * 100).toFixed(0)}%) status=${_downloadProgress.status}`);
    window.dispatchEvent(new CustomEvent('model-download-progress', { detail: _downloadProgress }));
  });

  // Update status caching (for polling from frontend)
  let _updateStatus = { status: 'idle', currentVersion: '...' };
  listen('auto-update-check', async () => {
    try {
      _updateStatus = { status: 'checking', currentVersion: _updateStatus.currentVersion || '...' };
      const result = await trackedInvoke('check_for_update');
      if (result && result.available) {
        _updateStatus = { status: 'available', currentVersion: _updateStatus.currentVersion, version: result.version || 'unknown' };
        window.dispatchEvent(new CustomEvent('update-available', { detail: _updateStatus }));
      } else {
        _updateStatus = { status: 'idle', currentVersion: _updateStatus.currentVersion };
      }
    } catch (e) {
      _updateStatus = { status: 'idle', currentVersion: _updateStatus.currentVersion, error: String(e) };
      console.warn('[bridge] Auto-update check failed:', e);
    }
  });

  listen('tray-error-notification', (event) => {
    window.dispatchEvent(new CustomEvent('tray-error-notification', { detail: event.payload }));
  });

  // Build the pywebview API shim
  window.pywebview = {
    api: {
      // --- Settings ---
      async get_settings() {
        const settings = await trackedInvoke('get_settings');
        return settingsToV3(settings);
      },

      async save_settings(patch) {
        const storePatch = patchToStore(patch);
        return await trackedInvoke('save_settings', { patch: storePatch });
      },

      async reset_settings() {
        return await trackedInvoke('reset_settings');
      },

      // --- Recording ---
      async start_recording() {
        return await trackedInvoke('start_recording');
      },

      async stop_recording() {
        // Rust stop_recording returns immediately (state → processing).
        // We must wait for the state to leave 'processing' before resolving,
        // matching Electron's pattern where stop-recording waits for sidecar events.
        const invokeResult = await trackedInvoke('stop_recording');
        if (!invokeResult?.success) {
          return invokeResult;
        }

        // Race guard: check if state already left processing before we listen
        const currentState = window._debugAppState;
        if (currentState && currentState !== 'processing') {
          _debugLog(`[stop_recording] state already left processing: ${currentState}`);
          if (currentState === 'success') return { success: true };
          if (currentState === 'dormant') return { success: false, error: 'Cancelled' };
          return { success: false, error: 'Transcription failed' };
        }

        _debugLog('[stop_recording] waiting for state to leave processing...');

        return new Promise((resolve) => {
          let unlisten = null;
          let timeoutId = null;

          function cleanup() {
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
            if (unlisten) { unlisten(); unlisten = null; }
          }

          function onStateUpdate(event) {
            const state = event.detail?.state;
            if (!state || state === 'processing') return; // still processing

            cleanup();
            _debugLog(`[stop_recording] resolved with state: ${state}`);

            if (state === 'success') {
              resolve({ success: true });
            } else if (state === 'dormant') {
              resolve({ success: false, error: 'Cancelled' });
            } else {
              resolve({ success: false, error: 'Transcription failed' });
            }
          }

          // Listen on the window CustomEvent (dispatched by the Tauri listener above)
          window.addEventListener('state-update', onStateUpdate);
          unlisten = () => window.removeEventListener('state-update', onStateUpdate);

          // 120s timeout — same as Electron's ceiling
          timeoutId = setTimeout(() => {
            cleanup();
            _debugLog('[stop_recording] timed out after 120s');
            resolve({ success: false, error: 'Processing timed out' });
          }, 120_000);

          // Second race guard: re-check after listener is attached
          const postState = window._debugAppState;
          if (postState && postState !== 'processing') {
            cleanup();
            _debugLog(`[stop_recording] state changed during setup: ${postState}`);
            if (postState === 'success') { resolve({ success: true }); return; }
            if (postState === 'dormant') { resolve({ success: false, error: 'Cancelled' }); return; }
            resolve({ success: false, error: 'Transcription failed' });
          }
        });
      },

      async cancel_processing() {
        return await trackedInvoke('cancel_processing');
      },

      async get_recording_state() {
        const s = await trackedInvoke('get_state');
        return {
          is_recording: s.state === 'recording',
          is_processing: s.state === 'processing',
          cancel_requested: false,
        };
      },

      async ack_state() {
        return await trackedInvoke('ack_state');
      },

      async simulate_enter() {
        return await trackedInvoke('simulate_enter');
      },

      // --- History ---
      async get_history() {
        return await trackedInvoke('get_history');
      },

      async delete_history(id) {
        return await trackedInvoke('delete_history', { id });
      },

      async clear_history() {
        return await trackedInvoke('clear_history');
      },

      async get_audio(id) {
        return await trackedInvoke('get_audio', { id });
      },

      async export_transcription(text, format) {
        return await trackedInvoke('export_transcription', { text, format });
      },

      async paste_last_transcript() {
        return await trackedInvoke('paste_last_transcript');
      },

      async copy_to_clipboard(text) {
        return await trackedInvoke('copy_to_clipboard', { text });
      },

      // --- Models (convenience wrappers matching Electron preload) ---
      async list_models() {
        return await trackedInvoke('list_models');
      },

      async get_models() {
        const result = await trackedInvoke('list_models');
        // Normalize: always return an array
        if (Array.isArray(result)) return result;
        if (result && Array.isArray(result.models)) return result.models;
        return [];
      },

      async download_model(name) {
        return await trackedInvoke('download_model', { name });
      },

      async delete_model(name) {
        return await trackedInvoke('delete_model', { name });
      },

      async set_model(name) {
        return await trackedInvoke('save_settings', { patch: { localModel: name } });
      },

      async get_download_progress() {
        return _downloadProgress || { status: 'idle', progress: 0 };
      },

      // --- Microphones (convenience wrappers) ---
      async list_mics() {
        return await trackedInvoke('list_mics');
      },

      async get_microphones() {
        const result = await trackedInvoke('list_mics');
        if (Array.isArray(result)) return result;
        if (result && Array.isArray(result.mics)) return result.mics;
        return [];
      },

      async set_mic(id) {
        return await trackedInvoke('set_mic', { id });
      },

      async set_microphone(id) {
        return await trackedInvoke('set_mic', { id });
      },

      // --- API Keys (convenience wrappers matching Electron preload) ---
      async verify_api_key(provider, key, baseUrl) {
        return await trackedInvoke('verify_api_key', { provider, key, base_url: baseUrl || '' });
      },

      async get_api_keys() {
        // Match Electron behavior: return both keys from secure storage
        const openai = await trackedInvoke('get_api_key', { provider: 'openai' });
        const gemini = await trackedInvoke('get_api_key', { provider: 'gemini' });
        return {
          success: true,
          openai: openai?.key || '',
          gemini: gemini?.key || '',
        };
      },

      async set_api_key(provider, key) {
        // Store in secure storage
        await trackedInvoke('store_api_key', { provider, key });
        // Also save field name to settings so has_key checks work
        const fieldMap = { openai: 'openaiApiKey', gemini: 'geminiApiKey' };
        const field = fieldMap[provider] || `${provider}ApiKey`;
        // Save a marker (not the actual key) in settings
        return await trackedInvoke('save_settings', {
          patch: { [field]: key ? '***secured***' : '' }
        });
      },

      async store_api_key(provider, key) {
        return await trackedInvoke('store_api_key', { provider, key });
      },

      async get_api_key(provider) {
        return await trackedInvoke('get_api_key', { provider });
      },

      async delete_api_key(provider) {
        return await trackedInvoke('delete_api_key', { provider });
      },

      // --- App info ---
      async get_app_info() {
        return await trackedInvoke('get_app_info');
      },

      async get_version() {
        const info = await trackedInvoke('get_app_info');
        return { version: info.version, dev: !!info.isDev };
      },

      // --- Window management ---
      async toggle_pill() {
        return await trackedInvoke('toggle_pill');
      },

      async show_main_window() {
        return await trackedInvoke('show_main_window');
      },

      async show_settings() {
        return await trackedInvoke('show_settings');
      },

      async hide_pill() {
        return await trackedInvoke('hide_pill');
      },

      async minimize() {
        return await trackedInvoke('window_minimize');
      },

      async maximize() {
        return await trackedInvoke('window_maximize');
      },

      async toggle_maximize() {
        return await trackedInvoke('window_maximize');
      },

      async close() {
        return await trackedInvoke('window_close');
      },

      async is_maximized() {
        return await trackedInvoke('window_is_maximized');
      },

      // --- Drag/resize stubs (V3 frontend calls these, Tauri handles natively) ---
      async drag_start() { /* no-op: Tauri handles window drag natively */ },
      async nc_resize_start() { /* no-op: Tauri handles resize natively */ },

      // --- Multi-monitor ---
      async get_displays() {
        return await trackedInvoke('get_displays');
      },

      async get_monitors() {
        return await this.get_displays();
      },

      async move_pill_to_display(id) {
        return await trackedInvoke('move_pill_to_display', { display_id: id });
      },

      // --- Auto-start ---
      async set_auto_start(enabled) {
        return await trackedInvoke('set_auto_start', { enabled });
      },

      async get_auto_start() {
        return await trackedInvoke('get_auto_start');
      },

      // --- Updates ---
      async check_for_update() {
        _updateStatus = { status: 'checking', currentVersion: (await trackedInvoke('get_app_info')).version };
        try {
          const result = await trackedInvoke('check_for_update');
          if (result && result.available) {
            _updateStatus = { status: 'available', currentVersion: _updateStatus.currentVersion, version: result.version || 'unknown' };
          } else {
            _updateStatus = { status: 'idle', currentVersion: _updateStatus.currentVersion };
          }
        } catch (e) {
          _updateStatus = { status: 'idle', currentVersion: _updateStatus.currentVersion, error: String(e) };
        }
        return _updateStatus;
      },

      async check_for_updates() {
        return await this.check_for_update();
      },

      async download_update() {
        // Tauri combines download+install — mark as ready, actual install happens on install_update
        _updateStatus = { ..._updateStatus, status: 'ready' };
        return { status: 'ready' };
      },

      async install_update() {
        return await trackedInvoke('install_update');
      },

      async get_update_status() {
        return _updateStatus || { status: 'idle' };
      },

      async set_update_channel(channel) {
        return await trackedInvoke('save_settings', { patch: { updateChannel: channel } });
      },

      async get_update_channel() {
        const settings = await trackedInvoke('get_settings');
        return { channel: settings.updateChannel || 'stable' };
      },
    },
  };

  // --- Tauri-specific CSS overrides (injected, not modifying shared index.html) ---
  function _injectTauriCSS() {
    const target = document.head || document.documentElement;
    if (!target) {
      document.addEventListener('DOMContentLoaded', _injectTauriCSS);
      return;
    }
    const style = document.createElement('style');
    style.textContent = `
      /* Disable -webkit-app-region: drag — not supported by WebView2 */
      #title-bar { -webkit-app-region: initial !important; padding-right: 12px !important; position: relative !important; z-index: 50 !important; }
      #title-bar button, #title-bar a, #title-bar input,
      #title-bar select, #title-bar [onclick] { -webkit-app-region: initial !important; position: relative !important; z-index: 51 !important; }
      /* Show custom window controls (hidden in Electron which has native overlay) */
      .electron-hide { display: inline-flex !important; }
    `;
    target.appendChild(style);
    _debugLog('Tauri CSS overrides injected (frameless mode)');
  }
  _injectTauriCSS();

  // --- Frameless window: drag regions + double-click maximize ---
  function _addDragRegions() {
    const titleBar = document.getElementById('title-bar');
    if (!titleBar) return;
    titleBar.setAttribute('data-tauri-drag-region', '');
    // Add to ALL descendants EXCEPT interactive elements
    titleBar.querySelectorAll('*').forEach(el => {
      if (!el.closest('button') && !el.closest('a') &&
          !el.closest('input') && !el.closest('select')) {
        el.setAttribute('data-tauri-drag-region', '');
      }
    });
    // Double-click title bar to toggle maximize (standard Windows behavior)
    titleBar.addEventListener('dblclick', (e) => {
      if (e.target.closest('button') || e.target.closest('a')) return;
      trackedInvoke('window_maximize');
    });
    _debugLog('Drag regions + double-click-maximize installed');
  }
  if (document.body) _addDragRegions();
  else document.addEventListener('DOMContentLoaded', _addDragRegions);

  // Signal that the bridge is ready
  window.pywebview._isReady = true;
  _debugLog('Bridge initialized — firing pywebviewready events');
  // Fire BOTH event names: V3 pywebview uses 'pywebviewready', our bridge used 'pywebview-ready'
  window.dispatchEvent(new CustomEvent('pywebviewready'));
  window.dispatchEvent(new CustomEvent('pywebview-ready'));

  // Global click logger for debugging button issues
  function _installClickLogger() {
    document.addEventListener('click', (e) => {
      const t = e.target;
      const tag = t.tagName;
      const id = t.id ? `#${t.id}` : '';
      const cls = t.className ? `.${String(t.className).split(' ').slice(0,3).join('.')}` : '';
      const onclick = t.getAttribute('onclick') || '';
      const disabled = t.disabled ? ' [DISABLED]' : '';
      const text = (t.textContent || '').trim().substring(0, 30);
      _debugLog(`CLICK: ${tag}${id}${cls}${disabled} onclick="${onclick}" text="${text}"`);
    }, true); // capture phase — fires even if propagation stops
    _debugLog('Click logger installed');
  }
  if (_IS_DEBUG) {
    if (document.body) _installClickLogger();
    else document.addEventListener('DOMContentLoaded', _installClickLogger);
  }

  // Monkey-patch frontend functions to trace onboarding flow
  function _patchOnboarding() {
    if (typeof window.startOnboarding === 'function' && !window._startOnboardingPatched) {
      const orig = window.startOnboarding;
      window.startOnboarding = function() {
        _debugLog(`startOnboarding() called — localModelReady=${window.localModelReady}, nativeBridgeReady=${window.nativeBridgeReady}`);
        return orig.apply(this, arguments);
      };
      window._startOnboardingPatched = true;
      _debugLog('Patched startOnboarding()');
    }
    if (typeof window.startOnboardingModelDownload === 'function' && !window._dlPatched) {
      const orig2 = window.startOnboardingModelDownload;
      window.startOnboardingModelDownload = function() {
        _debugLog(`startOnboardingModelDownload() called — nativeBridgeReady=${window.nativeBridgeReady}`);
        return orig2.apply(this, arguments);
      };
      window._dlPatched = true;
      _debugLog('Patched startOnboardingModelDownload()');
    }
    if (typeof window.useApiInstead === 'function' && !window._apiPatched) {
      const orig3 = window.useApiInstead;
      window.useApiInstead = function() {
        _debugLog(`useApiInstead() called`);
        return orig3.apply(this, arguments);
      };
      window._apiPatched = true;
      _debugLog('Patched useApiInstead()');
    }
  }
  // Patch toggleRecording to log state during cancel attempts
  // NOTE: currentAppState is a closure `let` in index.html — NOT on window.
  // We use window._debugAppState (set by our state-update listener above) as a proxy.
  function _patchToggleRecording() {
    if (typeof window.toggleRecording === 'function' && !window._togglePatched) {
      const origToggle = window.toggleRecording;
      window.toggleRecording = function(event) {
        const tauriState = window._debugAppState || 'no-state-updates-yet';
        _debugLog(`toggleRecording() called — _debugAppState=${tauriState}, event.type=${event?.type || 'none'}`);
        return origToggle.apply(this, arguments);
      };
      window._togglePatched = true;
      _debugLog('Patched toggleRecording()');
    }
  }

  // Patch after DOM + frontend JS loads
  setTimeout(_patchOnboarding, 500);
  setTimeout(_patchOnboarding, 2000);
  setTimeout(_patchToggleRecording, 500);
  setTimeout(_patchToggleRecording, 2000);
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(_patchOnboarding, 100);
    setTimeout(_patchToggleRecording, 100);
  });
})();
