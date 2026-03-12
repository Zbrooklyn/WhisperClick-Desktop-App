const { app, BrowserWindow, ipcMain, screen, globalShortcut, clipboard, Menu } = require('electron');
const path = require('path');
const Store = require('./store');
const Sidecar = require('./sidecar');
const { createTray, updateTrayIcon } = require('./tray');
const { initUpdater, checkForUpdatesQuietly } = require('./updater');

// --- Single instance lock ---
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

// --- Globals ---
let mainWindow = null;
let pillWindow = null;
let tray = null;
let store = null;
let sidecar = null;
let appState = 'dormant'; // dormant | recording | processing | success | error
let appStateMessage = '';  // Human-readable context for current state (e.g. error details)
let isQuitting = false;

const isDev = !app.isPackaged;
const isBeta = app.getVersion().includes('beta');
const configDir = path.join(
  app.getPath('userData'),
  isDev ? 'whisperclick-dev' : isBeta ? 'whisperclick-beta' : 'whisperclick'
);

// --- Window creation ---

function createMainWindow() {
  const settings = store.getSettings();

  // Responsive sizing: 22% of primary monitor width, clamped to [480, 650], matching V3
  const display = screen.getPrimaryDisplay();
  const effectiveWidth = display.workAreaSize.width;
  const targetWidth = Math.round(effectiveWidth * 0.22);
  const winWidth = Math.max(480, Math.min(650, targetWidth));
  const winHeight = Math.max(620, Math.round(winWidth * 1.58));

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 480,
    minHeight: 218,
    icon: path.join(__dirname, '../icons/icon.ico'),
    backgroundColor: settings.theme === 'dark' ? '#1C1917' : '#FAFAF9',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: settings.theme === 'dark' ? '#1C1917' : '#F5F5F4',
      symbolColor: settings.theme === 'dark' ? '#A8A29E' : '#78716C',
      height: 40,
    },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the V3 frontend directly (no Vite build step)
  mainWindow.loadFile(path.join(__dirname, '../src/frontend/index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Pill visibility follows main window: pill shows when window is hidden, hides when shown
  mainWindow.on('show', () => {
    if (pillWindow && !pillWindow.isDestroyed()) pillWindow.hide();
  });
  mainWindow.on('restore', () => {
    if (pillWindow && !pillWindow.isDestroyed()) pillWindow.hide();
  });
  mainWindow.on('hide', () => {
    const settings = store.getSettings();
    if (settings.showPill && pillWindow && !pillWindow.isDestroyed()) pillWindow.show();
  });
  mainWindow.on('minimize', () => {
    const settings = store.getSettings();
    if (settings.showPill && pillWindow && !pillWindow.isDestroyed()) pillWindow.show();
  });

  mainWindow.on('close', (e) => {
    const settings = store.getSettings();
    if (settings.closeBehavior === 'tray' && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const PILL_WIDTH = 220, PILL_HEIGHT = 140;

function createPillWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;
  const { x: areaX, y: areaY } = display.workArea;
  const pillW = PILL_WIDTH, pillH = PILL_HEIGHT;

  pillWindow = new BrowserWindow({
    width: pillW,
    height: pillH,
    x: areaX + Math.round((screenW - pillW) / 2),
    y: areaY + screenH - pillH - 10,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,  // V3 uses WA_ShowWithoutActivating — pill must not steal focus
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-pill.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  pillWindow.loadFile(path.join(__dirname, '../src/pill/pill.html'));
  // Click-through: transparent areas pass clicks to apps behind the pill.
  // The renderer toggles this off when the mouse enters visible content.
  pillWindow.setIgnoreMouseEvents(true, { forward: true });

  pillWindow.on('closed', () => {
    pillWindow = null;
  });
}

// --- State machine ---

function setAppState(state, message) {
  appState = state;
  if (message !== undefined) appStateMessage = message;
  else if (state === 'dormant' || state === 'success') appStateMessage = '';
}

function broadcastState() {
  const payload = { state: appState, message: appStateMessage };
  if (mainWindow) mainWindow.webContents.send('state-update', payload);
  if (pillWindow) pillWindow.webContents.send('state-update', payload);
  updateTrayIcon(appState);
}

let _lastLevelBroadcast = 0;
const LEVEL_THROTTLE_MS = 50; // Cap at ~20fps — still smooth for visualizer

function broadcastLevel(level) {
  const now = Date.now();
  if (now - _lastLevelBroadcast < LEVEL_THROTTLE_MS) return;
  _lastLevelBroadcast = now;
  if (mainWindow) mainWindow.webContents.send('level-update', level);
  if (pillWindow) pillWindow.webContents.send('level-update', level);
}

function broadcastError(message) {
  setAppState('error', message);
  broadcastState();
  setTimeout(() => {
    setAppState('dormant');
    broadcastState();
  }, 3000);
}

/**
 * Pre-validate recording readiness from the main process.
 * Returns null if ready, or an error message string if not.
 * This ensures the pill always gets feedback — even when mainWindow is hidden.
 */
function validateRecordingReadiness() {
  if (!sidecar || !sidecar.isRunning) {
    return 'Backend not ready — restarting…';
  }
  if (appState === 'processing') {
    return null; // Let cancel logic handle it
  }
  if (appState !== 'dormant') {
    return null; // Already recording — stop logic will handle it
  }
  const s = store.getSettings();
  const mode = s.mode || 'api';
  if (mode === 'api') {
    // Only block if NO provider has a key. If the active provider's key is
    // missing but another provider has one, let V3 auto-switch providers.
    const hasAnyKey = (s.openaiApiKey && s.openaiApiKey.trim()) ||
                      (s.geminiApiKey && s.geminiApiKey.trim());
    if (!hasAnyKey) {
      return 'No API key configured. Open Settings to add one.';
    }
  }
  // Local mode: sidecar handles model checks — no pre-validation needed here
  return null;
}

// --- Hotkey ---

let currentHotkey = null;
let lastHotkeyAt = 0;
const HOTKEY_DEBOUNCE_MS = 300;

function registerHotkey(accelerator) {
  // Normalize: V3 sends "Ctrl + Alt + R", Electron expects "Ctrl+Alt+R"
  const normalized = accelerator.split('+').map(s => s.trim()).join('+');
  if (currentHotkey) {
    globalShortcut.unregister(currentHotkey);
  }
  try {
    const success = globalShortcut.register(normalized, () => {
      // Debounce: prevent rapid double-fires from reaching the frontend or
      // the toggleRecording() fallback, which has no internal debounce.
      const now = Date.now();
      if (now - lastHotkeyAt < HOTKEY_DEBOUNCE_MS) return;
      lastHotkeyAt = now;

      // Pre-validate before routing — ensures pill always gets error feedback
      const validationError = validateRecordingReadiness();
      if (validationError) {
        broadcastError(validationError);
        return;
      }

      // Capture the foreground window *before* toggling — mirrors V3's
      // capture_paste_target() so auto-paste can restore focus later.
      if (sidecar && sidecar.isRunning) sidecar.send('capture_fg').catch(() => {});

      // Route hotkey through the V3 frontend so it handles validation,
      // mode checks, API key checks, etc. — mirrors V3's evaluate_js pattern.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript('triggerTrustedHotkeyToggle()').catch(() => {});
      } else {
        // Fallback: toggle directly via main process (for pill-only mode)
        toggleRecording();
      }
    });
    if (success) {
      currentHotkey = normalized;
    }
    return success;
  } catch {
    return false;
  }
}

async function toggleRecording() {
  if (appState === 'recording') {
    // Stop recording
    if (sidecar && sidecar.isRunning) {
      try {
        await sidecar.send('stop_rec');
      } catch { /* ignore */ }
    }
    setAppState('processing');
    broadcastState();
  } else if (appState === 'dormant') {
    // Start recording
    setAppState('recording');
    broadcastState();
    if (sidecar && sidecar.isRunning) {
      try {
        await sidecar.send('start_rec');
      } catch { /* ignore */ }
    }
  }
}

// --- Push settings to sidecar ---

function configureSidecar() {
  if (!sidecar || !sidecar.isRunning) return;
  const s = store.getSettings();
  const apiKey = s.provider === 'gemini' ? s.geminiApiKey : s.openaiApiKey;
  sidecar.send('configure', {
    mode: s.mode,
    language: s.language,
    model: s.localModel || 'base',
    provider: s.provider || 'openai',
    api_key: apiKey || '',
    base_url: s.customBaseUrl || '',
    api_model: s.apiModel || 'whisper-1',
    sound_enabled: s.soundEnabled !== false,
    output_mode: s.outputMode || 'transcribe',
    target_language: s.targetLanguage || 'en',
    source_language: s.sourceLanguage || 'auto',
    audio_retention_days: s.audioRetentionDays ?? 30,
  }).catch(() => {});
}

// --- IPC Handlers ---

// Settings
ipcMain.handle('get-settings', () => store.getSettings());
ipcMain.handle('save-settings', (_, patch) => {
  const prev = store.getSettings();
  const settings = { ...prev, ...patch };
  store.saveSettings(settings);
  // Update background + title bar overlay color on theme change
  if (mainWindow) {
    const isDark = settings.theme === 'dark';
    mainWindow.setBackgroundColor(isDark ? '#1C1917' : '#FAFAF9');
    mainWindow.setTitleBarOverlay({
      color: isDark ? '#1C1917' : '#F5F5F4',
      symbolColor: isDark ? '#A8A29E' : '#78716C',
    });
  }
  // Gap #20: Wire alwaysOnTop
  if (mainWindow && settings.alwaysOnTop !== undefined) {
    mainWindow.setAlwaysOnTop(!!settings.alwaysOnTop);
  }
  // Gap #21: Wire autoStart
  if (settings.autoStart !== undefined) {
    app.setLoginItemSettings({
      openAtLogin: !!settings.autoStart,
      path: process.execPath,
    });
  }
  // Re-register hotkey if changed
  if (settings.hotkey && settings.hotkey !== currentHotkey) {
    registerHotkey(settings.hotkey);
  }
  // Toggle pill visibility
  if (settings.showPill && !pillWindow) {
    createPillWindow();
  } else if (!settings.showPill && pillWindow) {
    pillWindow.close();
  }
  // Push relevant changes to sidecar
  const sidecarFields = ['mode', 'language', 'localModel', 'provider', 'apiModel',
    'openaiApiKey', 'geminiApiKey', 'customBaseUrl', 'soundEnabled',
    'outputMode', 'targetLanguage', 'sourceLanguage', 'audioRetentionDays'];
  const changed = sidecarFields.some(k => settings[k] !== prev[k]);
  if (changed) {
    configureSidecar();
  }
  return { success: true };
});
// Factory reset
ipcMain.handle('reset-settings', () => {
  if (pillWindow) pillWindow.close();
  store.resetAll();
  return { success: true };
});

// History
ipcMain.handle('get-history', () => store.getHistory());
ipcMain.handle('delete-history', (_, id) => store.deleteHistory(id));
ipcMain.handle('clear-history', () => store.clearHistory());

// State
ipcMain.handle('get-state', () => ({ state: appState, message: appStateMessage }));

// Pill recording — routes through the V3 frontend so both share one state machine
ipcMain.handle('pill-toggle-recording', async () => {
  // Pre-validate before routing — ensures pill always gets error feedback
  const validationError = validateRecordingReadiness();
  if (validationError) {
    broadcastError(validationError);
    return;
  }

  // Capture foreground before toggle — pill is non-focusable so target app is still fg
  if (sidecar && sidecar.isRunning) sidecar.send('capture_fg').catch(() => {});

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript('triggerTrustedHotkeyToggle()').catch(() => {});
  } else {
    toggleRecording();
  }
});

// Models (proxied through sidecar)
ipcMain.handle('list-models', async () => {
  if (!sidecar || !sidecar.isRunning) return { error: 'Sidecar not running' };
  try {
    return await sidecar.send('list_models');
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('download-model', async (_, name) => {
  if (!sidecar || !sidecar.isRunning) return { error: 'Sidecar not running' };
  try {
    return await sidecar.send('download_model', { model_name: name });
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('delete-model', async (_, name) => {
  if (!sidecar || !sidecar.isRunning) return { error: 'Sidecar not running' };
  try {
    return await sidecar.send('delete_model', { model_name: name });
  } catch (err) {
    return { error: err.message };
  }
});

// Microphones (proxied through sidecar)
ipcMain.handle('list-mics', async () => {
  if (!sidecar || !sidecar.isRunning) return { error: 'Sidecar not running' };
  try {
    return await sidecar.send('list_mics');
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('set-mic', async (_, id) => {
  if (!sidecar || !sidecar.isRunning) return { error: 'Sidecar not running' };
  try {
    return await sidecar.send('set_mic', { device_id: id });
  } catch (err) {
    return { error: err.message };
  }
});

// API key verification — routes through sidecar for real HTTP validation
ipcMain.handle('verify-api-key', async (_, provider, key, baseUrl) => {
  if (!key || key.trim() === '') return { valid: false, message: 'No key provided' };

  // If sidecar is running, do real HTTP verification
  if (sidecar && sidecar.isRunning) {
    try {
      const result = await sidecar.send('verify_key', {
        provider: provider || 'openai',
        api_key: key,
        base_url: baseUrl || '',
      });
      return {
        valid: !!result.valid,
        success: result.success !== false,
        status: result.http_status,
        message: result.error || (result.valid ? 'Key verified' : 'Invalid key'),
      };
    } catch (err) {
      // Sidecar call failed — fall through to format check
    }
  }

  // Fallback: format-only check if sidecar is down
  if (provider === 'openai' && !key.startsWith('sk-')) {
    return { valid: false, message: 'OpenAI keys start with sk-' };
  }
  if (provider === 'gemini' && !key.startsWith('AIza')) {
    return { valid: false, message: 'Gemini keys start with AIza' };
  }
  return { valid: true, message: 'Key format looks valid (offline check)' };
});

// Start recording — separate from toggle, used by V3 frontend
ipcMain.handle('start-recording', async () => {
  if (!sidecar || !sidecar.isRunning) {
    broadcastError('Backend not ready — restarting…');
    return { success: false, error: 'Backend not ready' };
  }
  setAppState('recording');
  broadcastState();
  try {
    await sidecar.send('start_rec');
    return { success: true };
  } catch (err) {
    broadcastError(err.message || 'Failed to start recording');
    return { success: false, error: err.message };
  }
});

// Stop recording — blocks until transcription completes (V3 frontend expects this)
ipcMain.handle('stop-recording', async () => {
  if (!sidecar || !sidecar.isRunning) return { success: false, error: 'Backend not ready' };
  setAppState('processing');
  broadcastState();
  // Register listeners BEFORE sending stop_rec to avoid missing fast sidecar responses
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      broadcastError('Processing timed out');
      resolve({ success: false, error: 'Processing timed out' });
    }, 120000);

    function cleanup() {
      clearTimeout(timeout);
      sidecar.removeListener('transcription', onTranscription);
      sidecar.removeListener('error', onError);
      sidecar.removeListener('cancelled', onCancelled);
      sidecar.removeListener('exit', onExit);
    }
    function onTranscription(data) {
      cleanup();
      resolve({ success: true, text: data.text });
    }
    function onError(data) {
      cleanup();
      resolve({ success: false, error: data.message || 'Transcription failed' });
    }
    function onCancelled() {
      cleanup();
      resolve({ success: false, error: 'Cancelled' });
    }
    function onExit() {
      cleanup();
      resolve({ success: false, error: 'Backend crashed during processing' });
    }
    sidecar.once('transcription', onTranscription);
    sidecar.once('error', onError);
    sidecar.once('cancelled', onCancelled);
    sidecar.once('exit', onExit);

    // Send stop_rec after listeners are attached
    sidecar.send('stop_rec').catch((err) => {
      cleanup();
      resolve({ success: false, error: err.message });
    });
  });
});

// Cancel in-flight processing (idempotent — no-op if transcription already completed)
ipcMain.handle('cancel-processing', async () => {
  const wasActive = appState === 'recording' || appState === 'processing';

  if (!wasActive) {
    // Already completed, errored, or dormant — nothing to cancel
    return { success: false, error: 'Nothing to cancel' };
  }

  // Immediately reset to dormant so the UI unblocks
  setAppState('dormant');
  broadcastState();

  if (!sidecar || !sidecar.isRunning) {
    return { success: true };
  }
  try {
    await sidecar.send('cancel');
    return { success: true };
  } catch (err) {
    // State already reset — just report the sidecar error
    return { success: false, error: err.message };
  }
});

// Clipboard
ipcMain.handle('copy-to-clipboard', (_, text) => {
  clipboard.writeText(text);
  return { success: true };
});

ipcMain.handle('paste-last-transcript', () => {
  const history = store.getHistory();
  if (!history.length) return { success: false, error: 'No transcriptions' };
  const text = history[0].text || '';
  clipboard.writeText(text);
  setTimeout(() => simulatePaste(), 150);
  return { success: true, text };
});

// Audio playback — read audio file from disk and return as base64
ipcMain.handle('get-audio', async (_, historyId) => {
  const history = store.getHistory();
  const entry = history.find(h => String(h.id) === String(historyId));
  if (!entry || !entry.audio_file) return { success: false, error: 'No audio file' };
  const fs = require('fs');
  try {
    const audioPath = entry.audio_file;
    if (!fs.existsSync(audioPath)) return { success: false, error: 'Audio file not found' };
    const data = fs.readFileSync(audioPath).toString('base64');
    const ext = path.extname(audioPath).slice(1).toLowerCase();
    const mimeMap = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', webm: 'audio/webm' };
    return { success: true, data, mime: mimeMap[ext] || 'audio/wav' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Export transcription — save to file via dialog
ipcMain.handle('export-transcription', async (_, text, format) => {
  const { dialog } = require('electron');
  const ext = format || 'txt';
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `transcription.${ext}`,
    filters: [{ name: 'Text Files', extensions: [ext] }],
  });
  if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };
  const fs = require('fs');
  fs.writeFileSync(result.filePath, text, 'utf8');
  return { success: true, path: result.filePath };
});

// Pill
ipcMain.handle('toggle-pill', () => {
  if (pillWindow) {
    pillWindow.close();
    return false;
  } else {
    createPillWindow();
    return true;
  }
});
// Pill context menu actions
ipcMain.handle('show-main-window', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});
ipcMain.handle('show-settings', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.executeJavaScript('openSettingsDrawer()').catch(() => {});
  }
});
// Pill click-through toggle — renderer calls these on mouseenter/mouseleave
// of visible content so transparent areas pass clicks to apps behind.
ipcMain.on('pill-set-ignore-mouse', (_, ignore) => {
  if (pillWindow && !pillWindow.isDestroyed()) {
    if (ignore) {
      pillWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      pillWindow.setIgnoreMouseEvents(false);
    }
  }
});

ipcMain.handle('hide-pill', () => {
  if (pillWindow) {
    pillWindow.close();
    // Update settings to reflect pill hidden
    const settings = store.getSettings();
    store.saveSettings({ ...settings, showPill: false });
    // Notify renderer so settings drawer toggle stays in sync
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pill-hidden');
    }
  }
});

// ---------------------------------------------------------------------------
// Shared rich context menu template (used by pill right-click AND tray)
// ---------------------------------------------------------------------------
async function buildRichMenuTemplate({ includePillItems = false, includeQuit = false } = {}) {
  const isRecording = appState === 'recording';
  const isProcessing = appState === 'processing';
  const settings = store.getSettings();
  const history = store.getHistory();

  // Build microphone submenu (with timeout so menu doesn't hang)
  let micSubmenu = [{ label: 'Unavailable', enabled: false }];
  try {
    if (sidecar && sidecar.isRunning) {
      const mics = await Promise.race([
        sidecar.send('list_mics'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      if (Array.isArray(mics) && mics.length) {
        micSubmenu = mics.map(m => ({
          label: m.name || `Mic ${m.id}`,
          type: 'radio',
          checked: !!m.is_default,
          click: () => {
            if (sidecar && sidecar.isRunning) sidecar.send('set_mic', { device_id: m.id }).catch(() => {});
          },
        }));
      }
    }
  } catch {}

  // Build recent transcriptions submenu (up to 3)
  const recentItems = history.slice(0, 3).map(h => {
    const text = h.text || '';
    const label = text.length > 40 ? text.slice(0, 40) + '…' : text;
    return {
      label: label || '(empty)',
      click: () => { clipboard.writeText(text); },
    };
  });

  const template = [
    {
      label: isRecording ? 'Stop Recording' : (isProcessing ? 'Processing…' : 'Start Recording'),
      enabled: !isProcessing,
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript('triggerTrustedHotkeyToggle()').catch(() => {});
        } else {
          toggleRecording();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Microphone',
      submenu: micSubmenu,
    },
    {
      label: `Sound Effects`,
      type: 'checkbox',
      checked: settings.soundEnabled !== false,
      click: (item) => {
        const updated = store.getSettings();
        store.saveSettings({ ...updated, soundEnabled: item.checked });
        configureSidecar();
      },
    },
    {
      label: `Mode: ${settings.mode === 'local' ? 'Local' : 'API'}`,
      click: () => {
        const cur = store.getSettings();
        const nextMode = cur.mode === 'local' ? 'api' : 'local';
        store.saveSettings({ ...cur, mode: nextMode });
        configureSidecar();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript(`setMode('${nextMode}')`).catch(() => {});
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Recent Transcriptions',
      submenu: recentItems.length ? recentItems : [{ label: 'No transcriptions yet', enabled: false }],
    },
    {
      label: 'Paste Last Transcript',
      enabled: history.length > 0,
      click: () => {
        const text = history[0]?.text || '';
        if (text) {
          clipboard.writeText(text);
          setTimeout(() => simulatePaste(), 150);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Show WhisperClick',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.executeJavaScript('openSettingsDrawer()').catch(() => {});
        }
      },
    },
    { type: 'separator' },
    {
      label: settings.hotkey || 'Ctrl+Alt+R',
      enabled: false,
    },
  ];

  // Pill-specific: History + Hide Pill
  if (includePillItems) {
    template.push({
      label: 'History',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          // Close settings drawer so history list is visible
          mainWindow.webContents.executeJavaScript(
            "document.getElementById('settings-drawer')?.classList.add('translate-x-full')"
          ).catch(() => {});
        }
      },
    });
    template.push({
      label: 'Hide Pill',
      click: () => {
        if (pillWindow) {
          pillWindow.close();
          const s = store.getSettings();
          store.saveSettings({ ...s, showPill: false });
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pill-hidden');
          }
        }
      },
    });
  }

  // Tray-specific: Quit
  if (includeQuit) {
    template.push({ type: 'separator' });
    template.push({
      label: 'Quit',
      click: () => {
        isQuitting = true;
        if (pillWindow) pillWindow.close();
        if (mainWindow) mainWindow.destroy();
        if (sidecar) sidecar.stop();
        app.quit();
      },
    });
  }

  return template;
}

// Native context menu for pill (replaces HTML-based menu that gets clipped)
ipcMain.handle('pill-context-menu', async () => {
  if (!pillWindow) return;
  const template = await buildRichMenuTemplate({ includePillItems: true });
  const menu = Menu.buildFromTemplate(template);
  // Position menu centered above the pill with ~20px gap.
  // menu.popup x/y are content-area-relative to the specified window.
  // Electron converts them to screen coords via ConvertPointToScreen internally.
  const pillBounds = pillWindow.getBounds();
  const estimatedMenuWidth = 220;
  const estimatedMenuHeight = 300; // ~14 items + separators
  const x = Math.round(pillBounds.width / 2) - Math.round(estimatedMenuWidth / 2);
  const y = -(estimatedMenuHeight + 20);
  menu.popup({ window: pillWindow, x, y });
});

// Window controls (frameless)
ipcMain.handle('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window-close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.handle('window-is-maximized', () => mainWindow ? mainWindow.isMaximized() : false);

// Monitors / Displays
ipcMain.handle('get-displays', () => {
  const displays = screen.getAllDisplays();
  return displays.map((d, i) => ({
    id: d.id,
    label: `Display ${i + 1} (${d.size.width}x${d.size.height})`,
  }));
});

ipcMain.handle('move-pill-to-display', (_, displayId) => {
  if (!pillWindow) return { success: false, error: 'Pill not visible' };
  const displays = screen.getAllDisplays();
  const target = displays.find(d => d.id === displayId);
  if (!target) return { success: false, error: 'Display not found' };
  const { x: areaX, y: areaY, width: areaW, height: areaH } = target.workArea;
  pillWindow.setBounds({
    x: areaX + Math.round((areaW - PILL_WIDTH) / 2),
    y: areaY + areaH - PILL_HEIGHT - 10,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
  });
  return { success: true };
});

// App info
ipcMain.handle('get-app-info', () => ({
  version: app.getVersion(),
  name: app.getName(),
  isPackaged: app.isPackaged,
  isDev,
  platform: process.platform,
  arch: process.arch,
  modKey: process.platform === 'darwin' ? 'Cmd' : 'Ctrl',
}));

// --- Auto-paste helper ---
// Mirrors V3's _auto_paste: captures the foreground window before recording starts
// (via capture_fg), then restores focus and simulates Ctrl+V via the sidecar's
// native Win32 keybd_event — no PowerShell subprocess needed.

function simulatePaste() {
  if (process.platform === 'win32') {
    if (sidecar && sidecar.isRunning) {
      const wcFocused = !!mainWindow?.isFocused?.();
      sidecar.send('paste', { wc_focused: wcFocused }).catch(() => {});
    }
  } else if (process.platform === 'darwin') {
    const { exec } = require('child_process');
    exec('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
  }
}

// --- App lifecycle ---

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  store = new Store(configDir);
  const settings = store.getSettings();

  createMainWindow();
  // Create pill but keep it hidden — it shows when main window is hidden/minimized
  if (settings.showPill) {
    createPillWindow();
    if (pillWindow) pillWindow.hide();
  }

  // Auto-updater
  initUpdater(mainWindow, store, sidecar);
  setTimeout(() => checkForUpdatesQuietly(), 10_000);

  // System tray — dynamic menu rebuilt on each right-click
  tray = createTray({
    onShow: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    onBuildMenu: () => buildRichMenuTemplate({ includeQuit: true }),
    isDev,
  });

  // Hotkey
  registerHotkey(settings.hotkey || 'Ctrl+Alt+R');

  // Sidecar
  const enginePath = process.env.WHISPERCLICK_ENGINE_PATH || path.join(__dirname, '../engine/engine.py');
  sidecar = new Sidecar(enginePath);

  let sidecarRestartCount = 0;

  sidecar.on('ready', () => {
    console.log('Sidecar ready — pushing initial config');
    sidecarRestartCount = 0;
    configureSidecar();
  });

  sidecar.on('level', (data) => broadcastLevel(data.level));

  sidecar.on('transcription', (data) => {
    setAppState('success');
    broadcastState();
    if (data.text) {
      // Gap #46: Include translation field; Gap #47: Include audio_file
      const entry = store.addHistory({
        text: data.text,
        timestamp: new Date().toISOString(),
        duration: data.duration || 0,
        transcriptionTime: data.transcription_time || 0,
        provider: data.provider || 'unknown',
        model: data.model || 'unknown',
        language: data.language || 'auto',
        translation: data.translation || '',
        audio_file: data.audio_file || null,
      });
      if (mainWindow) mainWindow.webContents.send('transcription', data);
    }
    // Auto-paste: copy to clipboard and simulate Ctrl+V
    const currentSettings = store.getSettings();
    if (currentSettings.autoPaste && data.text) {
      clipboard.writeText(data.text);
      // Small delay to ensure focus is on the target app
      setTimeout(() => {
        simulatePaste();
      }, 150);
    }
    setTimeout(() => {
      setAppState('dormant');
      broadcastState();
    }, 1500);
  });

  sidecar.on('translation', (data) => {
    if (mainWindow) mainWindow.webContents.send('translation', data);
    // Gap #46: Update the most recent history entry with the translation text
    if (data.text) {
      const history = store.getHistory();
      if (history.length > 0) {
        store.updateHistory(history[0].id, { translation: data.text });
      }
    }
    // Auto-paste translation if configured
    const currentSettings = store.getSettings();
    if (currentSettings.autoPaste && data.text) {
      clipboard.writeText(data.text);
      setTimeout(() => simulatePaste(), 150);
    }
  });

  sidecar.on('cancelled', () => {
    setAppState('dormant');
    broadcastState();
  });

  sidecar.on('model_download_progress', (data) => {
    if (mainWindow) mainWindow.webContents.send('model-download-progress', data);
  });

  sidecar.on('error', (data) => {
    broadcastError(data.message || 'Something went wrong');
    if (mainWindow) mainWindow.webContents.send('sidecar-error', data);
  });

  const MAX_SIDECAR_RESTARTS = 3;

  sidecar.on('exit', (code) => {
    console.log(`Sidecar exited with code ${code}`);
    if (isQuitting) return;

    // If recording or processing was in progress, reset state and notify user
    if (appState === 'recording' || appState === 'processing') {
      broadcastError('Backend crashed — recording lost');
    }

    if (code !== 0 && code !== null && sidecarRestartCount < MAX_SIDECAR_RESTARTS) {
      sidecarRestartCount++;
      const delay = 1000 * sidecarRestartCount;
      console.log(`Restarting sidecar in ${delay}ms (attempt ${sidecarRestartCount}/${MAX_SIDECAR_RESTARTS})`);
      setTimeout(() => {
        if (isQuitting) return;
        try { sidecar.start(); } catch (err) { console.error('Restart failed:', err.message); }
      }, delay);
    } else if (sidecarRestartCount >= MAX_SIDECAR_RESTARTS) {
      console.error('Sidecar crashed too many times — giving up');
      broadcastError('Backend failed to start — restart the app');
    }
  });

  // Start sidecar
  try {
    sidecar.start();
  } catch (err) {
    console.error('Failed to start sidecar:', err.message);
  }
});

app.on('will-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (sidecar) sidecar.stop();
});

app.on('window-all-closed', () => {
  // Don't quit on macOS unless explicitly quitting
  if (process.platform !== 'darwin') {
    // Only quit if no tray (tray keeps app alive)
    if (!tray) app.quit();
  }
});
