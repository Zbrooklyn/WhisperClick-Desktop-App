const { app, BrowserWindow, ipcMain, screen, globalShortcut, clipboard, Menu, Notification, shell, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./store');
const { migrateLegacyConfig } = require('./migration');
const Sidecar = require('./sidecar');
const { sweepStaleEngines } = require('./orphan-sweep');
const { createTray, updateTrayIcon, updateTrayTooltip, showTrayBalloon, flashTrayError } = require('./tray');
const { initUpdater, checkForUpdatesQuietly, checkUpdateMarker } = require('./updater');
const log = require('./logger');
const { StateMachine } = require('./state-machine');
// Register the bytenode require hook so `require('./premium/x')` can resolve a
// compiled x.jsc when no x.js is present (the Pro package ships ONLY .jsc; the
// build tool is tools/protect-premium.js). Optional on purpose: the free build
// ships no premium files and may not bundle bytenode, and dev/unpackaged builds
// resolve the readable .js first regardless — so a missing hook is harmless.
try { require('bytenode'); } catch { /* free/dev build: no .jsc to load */ }
// Premium (Pro) modules live in ./premium/ and are stripped from the public/free
// build, so require them optionally — the free build simply has no Pro features.
let proUi = null;
try { proUi = require('./premium/pro-ui'); } catch { proUi = null; }
let proWindows = null;
try { proWindows = require('./premium/pro-windows'); } catch { proWindows = null; }
let proContext = null;
try { proContext = require('./premium/pro-context'); } catch { proContext = null; }
let proLicense = null;
try { proLicense = require('./premium/pro-license'); } catch { proLicense = null; }
let proLicenseUi = null;
try { proLicenseUi = require('./premium/pro-license-ui'); } catch { proLicenseUi = null; }
let proIntegrations = null;
try { proIntegrations = require('./premium/pro-integrations-ui'); } catch { proIntegrations = null; }
let proMeetingUi = null;
try { proMeetingUi = require('./premium/pro-meeting-ui'); } catch { proMeetingUi = null; }
let proDataTools = null;
try { proDataTools = require('./premium/pro-data-tools'); } catch { proDataTools = null; }

// Snapshot which premium modules resolved. In a Pro build these load from .jsc
// bytecode; a false here means the module (or its .jsc) failed to load, which
// silently disables that Pro feature. Logged after log.init() (below) so the
// signal actually lands in debug.log for diagnosis.
const PREMIUM_LOAD_STATUS = {
  proUi: !!proUi, proWindows: !!proWindows, proContext: !!proContext,
  proLicense: !!proLicense, proLicenseUi: !!proLicenseUi,
  proIntegrations: !!proIntegrations, proMeetingUi: !!proMeetingUi,
};

// Parity convenience: seed provider API keys from a repo-root .env when the store
// has none — mirrors the web build's .env loader so the desktop app is usable with
// the same key without re-entering it. Never overwrites a key the user already set.
function seedApiKeysFromDotEnv(store, log) {
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (!fs.existsSync(envPath)) return;
    const env = {};
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    const s = store.getSettings();
    const patch = {};
    if (env.OPENAI_API_KEY && !(s.openaiApiKey && s.openaiApiKey.trim())) patch.openaiApiKey = env.OPENAI_API_KEY;
    if (env.GEMINI_API_KEY && !(s.geminiApiKey && s.geminiApiKey.trim())) patch.geminiApiKey = env.GEMINI_API_KEY;
    if (Object.keys(patch).length) {
      // saveSettings is a full replace, not a merge — spread current settings so
      // seeding a key never wipes the user's other settings back to defaults.
      store.saveSettings({ ...s, ...patch });
      if (log && log.info) log.info(`[env] seeded ${Object.keys(patch).join(', ')} from .env`);
    }
  } catch (e) { if (log && log.error) log.error('[env] seed failed: ' + (e && e.message)); }
}

// Suppress EPIPE errors on stdout/stderr (broken pipe when parent process closes)
// This prevents crash dialogs from electron-updater's console.info calls
process.stdout?.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr?.on('error', (err) => { if (err.code !== 'EPIPE') throw err; });

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
let pillReconciler = null; // R4: interval that self-heals a vanished pill
// When the main window is closed, the pill is PROMOTED to the live surface even
// if the ambient `showPill` setting is off — otherwise closing the window would
// leave the app with no visible surface (just a tray icon). Cleared when the
// window is shown again.
let pillPromoted = false;
let updateCheckInterval = null; // periodic background update check
let migrationNotice = null; // set during app.whenReady, read by get-migration-notice IPC
// State machine — single source of truth for app state
const sm = new StateMachine('dormant', { logger: (...args) => log.info(...args) });

let isQuitting = false;

// When a caller (e.g. retranscribe) owns the next `transcription` event, it sets
// this claim so the global listener skips its default "add a new history entry +
// auto-paste" flow. Without it, re-transcribing would silently DUPLICATE the entry
// instead of updating it. Always released in transcribeFileViaEngine's cleanup.
let _transcriptionClaim = null;

const isDev = !app.isPackaged;
const isBeta = app.getVersion().includes('beta');
const channel = isDev ? 'dev' : isBeta ? 'beta' : 'stable';
const configDir = path.join(
  app.getPath('userData'),
  isDev ? 'com.whisperclick.dev' : isBeta ? 'com.whisperclick.beta' : 'com.whisperclick.app'
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
    icon: path.join(__dirname, '../../icons/icon.ico'),
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
  mainWindow.loadFile(path.join(__dirname, '../../shared/frontend/index.html'));

  // Premium: inject the Pro settings UI once the renderer has loaded. Runs again
  // on every load, so it survives the self-heal reload below. No-op on the free
  // build (proUi is null) or when premium is disabled.
  mainWindow.webContents.on('did-finish-load', () => {
    // Availability, not entitlement: an unlicensed paid install still renders
    // these panels (grayed by the renderer) so a key can be entered.
    if (!premiumAvailable()) return;
    try { (proUi.injectProSettings || proUi.injectVocabularySettings)(mainWindow, store); }
    catch (e) { log.error('Pro UI injection failed: ' + e); }
    // "Your Data": import from Free, backup, restore.
    if (proUi.injectDataSettings) {
      try { proUi.injectDataSettings(mainWindow); }
      catch (e) { log.error('Pro data UI injection failed: ' + e); }
    }
    // Phase 3-4 panels: license/upgrade, direct-send integrations, meeting mode.
    // Each guards internally and is a no-op when its module is absent (free build).
    if (proLicenseUi && proLicenseUi.injectLicenseUI) {
      try { proLicenseUi.injectLicenseUI(mainWindow, store); }
      catch (e) { log.error('Pro license UI injection failed: ' + e); }
    }
    if (proIntegrations && proIntegrations.injectIntegrationsUI) {
      try { proIntegrations.injectIntegrationsUI(mainWindow, store); }
      catch (e) { log.error('Pro integrations UI injection failed: ' + e); }
    }
    if (proMeetingUi && proMeetingUi.injectMeetingUI) {
      try { proMeetingUi.injectMeetingUI(mainWindow, store); }
      catch (e) { log.error('Pro meeting UI injection failed: ' + e); }
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Pill visibility follows main window: pill shows when window is hidden, hides when shown
  mainWindow.on('show', () => {
    pillPromoted = false; // window is back — the pill is no longer the live surface
    if (pillWindow && !pillWindow.isDestroyed()) pillWindow.hide();
    // Sync frontend state so timer/UI matches actual backend state
    broadcastState();
    // Reset settings drawer so window always reopens to main view
    mainWindow.webContents.executeJavaScript(
      'document.getElementById("settings-drawer")?.classList.add("translate-x-full")'
    ).catch(() => {});
  });
  mainWindow.on('restore', () => {
    pillPromoted = false;
    if (pillWindow && !pillWindow.isDestroyed()) pillWindow.hide();
    broadcastState();
  });
  function showPillOnPrimaryDisplay() {
    if (!pillShouldShow()) return;
    if (!pillWindow || pillWindow.isDestroyed()) {
      createPillWindow();
    } else {
      // Reposition to primary display bottom-center (handles monitor changes)
      const display = screen.getPrimaryDisplay();
      const { width: screenW, height: screenH } = display.workAreaSize;
      const { x: areaX, y: areaY } = display.workArea;
      pillWindow.setPosition(
        areaX + Math.round((screenW - PILL_WIDTH) / 2),
        areaY + screenH - PILL_HEIGHT - 10
      );
      pillWindow.show();
      broadcastState();
    }
  }
  mainWindow.on('hide', showPillOnPrimaryDisplay);
  mainWindow.on('minimize', showPillOnPrimaryDisplay);

  mainWindow.on('close', (e) => {
    if (isQuitting) return; // Let close proceed during quit/update
    const settings = store.getSettings();
    if (settings.closeBehavior === 'tray' && tray) {
      e.preventDefault();
      // Promote the pill BEFORE hiding: closing the window makes the pill the
      // app's only live surface, so it must appear even when the ambient
      // showPill setting is off. The 'hide' handler then shows it.
      pillPromoted = true;
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Self-heal: if the main window's renderer crashes (GPU reset, OOM, "Aw,
  // Snap"), the window goes blank and stays dead until manual restart. Reload
  // it to respawn a fresh renderer. A 10s guard prevents a tight crash-loop.
  let lastMainReload = 0;
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const reason = details && details.reason;
    log.error(`Main window renderer gone: ${reason}`);
    if (isQuitting || reason === 'clean-exit') return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const now = Date.now();
    if (now - lastMainReload < 10000) {
      log.error('Main window renderer crashed again within 10s — not auto-reloading');
      return;
    }
    lastMainReload = now;
    try { mainWindow.reload(); log.info('Main window reloaded after renderer crash'); }
    catch { /* ignore */ }
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
    show: false, // Don't show until ready — avoids flash and race conditions
    webPreferences: {
      preload: path.join(__dirname, 'preload-pill.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  pillWindow.loadFile(path.join(__dirname, '../../shared/pill/pill.html'));
  // Click-through: transparent areas pass clicks to apps behind the pill.
  // The renderer toggles this off when the mouse enters visible content.
  pillWindow.setIgnoreMouseEvents(true, { forward: true });
  // Push current state once it loads; show only if main window is hidden
  pillWindow.webContents.once('did-finish-load', () => {
    if (pillWindow && !pillWindow.isDestroyed()) {
      const mainHidden = !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible();
      if (mainHidden) pillWindow.show();
      renderPill();
    }
  });

  // R4: if the pill's renderer crashes, drop the dead window and self-heal
  // immediately (the reconciler is the slower backstop).
  pillWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error(`Pill renderer gone: ${details && details.reason}`);
    if (pillWindow && !pillWindow.isDestroyed()) {
      try { pillWindow.destroy(); } catch { /* ignore */ }
    }
    pillWindow = null;
    ensurePill();
  });

  pillWindow.on('closed', () => {
    log.info('Pill window closed/destroyed');
    pillWindow = null;
  });
}

/**
 * R4 — pill self-heal. `showPill` (the setting) is the single source of truth
 * for whether the pill should exist. When it should but the window is missing
 * or destroyed (renderer crash, display change, GPU reset), recreate it.
 * Idempotent and cheap; safe to call on a timer.
 */
function pillShouldShow() {
  if (pillPromoted) return true; // window closed → pill is the live surface
  if (!store) return false;
  try { return !!store.getSettings().showPill; } catch { return false; }
}

function ensurePill() {
  const alive = pillWindow && !pillWindow.isDestroyed();
  if (pillShouldShow() && !alive) {
    log.info('ensurePill: recreating missing pill');
    createPillWindow();
    return true;
  }
  return !!alive;
}

// --- State transitions ---

/**
 * Transition app state via the state machine.
 * Phase 2: invalid transitions are rejected (logged + returned false).
 * The single input gate (canAcceptAction) should prevent invalid
 * transitions from ever being attempted.
 */
function setAppState(state, message) {
  if (!sm.transition(state, message)) {
    log.error(`[state] REJECTED transition: ${sm.state} → ${state} — this should not happen (check canAcceptAction)`);
    return false;
  }
  return true;
}

/**
 * Send a render payload to the pill. This is the ONLY way main talks to the pill
 * about visual state. The pill has no state of its own — it renders exactly this.
 */
function renderPill(overrides = {}) {
  if (!pillWindow || pillWindow.isDestroyed()) return;
  const settings = store ? store.getSettings() : {};
  const payload = {
    shape: sm.state,           // dormant | recording | processing | success | error
    level: 0,                  // audio level — only meaningful during recording
    autoEnterMode: settings.autoEnterMode || 'off',
    message: sm.message || '', // error message text — only meaningful for shape='error'
    ...overrides,              // caller can override shape (e.g., 'enter-ready') or level
  };
  pillWindow.webContents.send('pill-render', payload);
}

function broadcastState() {
  const autoEnterMode = store ? store.getSettings().autoEnterMode : 'off';
  const payload = { state: sm.state, message: sm.message, autoEnterMode };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state-update', payload);
  renderPill({ shape: sm.state });
  updateTrayIcon(sm.state);
  // Update tray tooltip to reflect current state
  const prefix = isDev ? 'WhisperClick [DEV]' : 'WhisperClick';
  if (sm.state === 'recording') updateTrayTooltip(`${prefix} — Recording...`);
  else if (sm.state === 'processing') updateTrayTooltip(`${prefix} — Processing...`);
  else updateTrayTooltip(prefix);
}

let _lastLevelBroadcast = 0;
const LEVEL_THROTTLE_MS = 50; // Cap at ~20fps — still smooth for visualizer

function broadcastLevel(level) {
  const now = Date.now();
  if (now - _lastLevelBroadcast < LEVEL_THROTTLE_MS) return;
  _lastLevelBroadcast = now;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('level-update', level);
  renderPill({ shape: 'recording', level });
}

function broadcastError(message) {
  log.error(`broadcastError: ${message}`);
  setAppState('error', message);
  broadcastState();
  // Fallback timer — UI can ack earlier via ack-state IPC
  setTimeout(() => {
    if (sm.is('error')) {
      setAppState('dormant');
      broadcastState();
    }
  }, 3000);
}

/**
 * Pre-validate recording readiness from the main process.
 * Returns null if ready, or an error message string if not.
 * This ensures the pill always gets feedback — even when mainWindow is hidden.
 */
/**
 * Single input gate — the ONLY place that decides whether an action is allowed.
 * All entry points (hotkey, pill, tray, IPC) call this before doing anything.
 *
 * @param {'start'|'stop'|'cancel'|'toggle'} action
 * @returns {{ allowed: boolean, error?: string, actualAction?: string }}
 */
function canAcceptAction(action) {
  if (action === 'toggle') {
    // Toggle resolves to start or stop based on current state
    if (sm.state === 'recording') {
      return { allowed: true, actualAction: 'stop' };
    }
    if (sm.state === 'processing') {
      return { allowed: true, actualAction: 'cancel' };
    }
    // For dormant/success/error → treat as start
    action = 'start';
  }

  if (action === 'stop') {
    if (sm.state !== 'recording') {
      return { allowed: false, error: 'Not recording' };
    }
    // Don't check sidecar here — if sidecar crashed mid-recording,
    // we still need to allow stop to clean up state. Handler checks sidecar.
    return { allowed: true, actualAction: 'stop' };
  }

  if (action === 'cancel') {
    if (!sm.canCancel) {
      return { allowed: false, error: 'Nothing to cancel' };
    }
    // Cancel can succeed even without sidecar (just reset state)
    return { allowed: true, actualAction: 'cancel' };
  }

  if (action === 'start') {
    // Sidecar must be running to start recording
    if (!sidecar || !sidecar.isRunning) {
      return { allowed: false, error: 'Backend not ready — restarting…' };
    }
    // Can only start from dormant, success, or error
    if (!sm.canRecord) {
      log.warn(`canAcceptAction: start rejected — state is ${sm.state}`);
      return { allowed: false, error: `Cannot start recording (${sm.state})` };
    }
    // Check API keys in api mode
    const s = store.getSettings();
    const mode = s.mode || 'api';
    if (mode === 'api') {
      const hasAnyKey = (s.openaiApiKey && s.openaiApiKey.trim()) ||
                        (s.geminiApiKey && s.geminiApiKey.trim());
      if (!hasAnyKey) {
        return { allowed: false, error: 'No API key configured. Open Settings to add one.' };
      }
    }
    return { allowed: true, actualAction: 'start' };
  }

  return { allowed: false, error: `Unknown action: ${action}` };
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
      // Debounce: prevent rapid double-fires
      const now = Date.now();
      if (now - lastHotkeyAt < HOTKEY_DEBOUNCE_MS) {
        log.info(`Hotkey debounced (${now - lastHotkeyAt}ms since last)`);
        return;
      }
      lastHotkeyAt = now;
      log.ipc('hotkey', `fired (state=${sm.state})`);

      // Single input gate — decides if action is allowed
      const gate = canAcceptAction('toggle');
      if (!gate.allowed) {
        broadcastError(gate.error);
        return;
      }

      // Capture the foreground window *before* toggling
      if (sidecar && sidecar.isRunning) sidecar.send('capture_fg').catch(() => {});

      // Route through frontend for start; stop/cancel go direct
      if (gate.actualAction === 'start') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript('triggerTrustedHotkeyToggle()').catch(() => {});
        } else {
          toggleRecording();
        }
      } else {
        toggleRecording();
      }
    });
    if (success) {
      currentHotkey = normalized;
    } else {
      log.error(`Hotkey registration failed for "${normalized}" — likely in use by another app`);
    }
    return success;
  } catch (err) {
    log.error(`Hotkey registration threw for "${normalized}": ${err.message}`);
    return false;
  }
}

// Surface a failed hotkey registration to the user — the app's headline feature
// is dead-on-arrival if its shortcut couldn't be claimed, so don't fail silently.
function notifyHotkeyFailed(accel) {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'WhisperClick — shortcut unavailable',
        body: `Couldn't register ${accel}. It may be in use by another app. Pick a different shortcut in Settings.`,
      }).show();
    }
  } catch { /* notification is best-effort */ }
}

async function trayToggleRecording() {
  log.tray('toggle-recording', `state=${sm.state}`);
  const gate = canAcceptAction('toggle');
  if (!gate.allowed) {
    log.tray('toggle-recording', `blocked: ${gate.error}`);
    showTrayBalloon('Recording Error', gate.error);
    flashTrayError('WhisperClick — Setup required');
    return;
  }
  // Foreground window already captured by onCaptureTarget in tray click handler
  await toggleRecording();
}

async function toggleRecording() {
  log.info(`toggleRecording called (state=${sm.state})`);
  if (sm.state === 'recording') {
    // Stop recording
    if (sidecar && sidecar.isRunning) {
      try {
        await sidecar.send('stop_rec');
      } catch { /* ignore */ }
    }
    setAppState('processing');
    broadcastState();
  } else if (sm.state === 'dormant') {
    // Start recording
    setAppState('recording');
    broadcastState();
    if (sidecar && sidecar.isRunning) {
      try {
        await sidecar.send('start_rec');
      } catch { /* ignore */ }
    }
  } else {
    log.warn(`toggleRecording ignored — unexpected state: ${sm.state}`);
  }
}

// --- Premium gating ---
// Two questions, deliberately separate.
//
// AVAILABLE = the paid modules are packed and the user hasn't switched them off.
// This one is licence-blind on purpose: an unlicensed paid install must still
// render the licence form and the grayed-out premium surfaces (3-state arch,
// State 2), or there is no way to enter a key at all.
function premiumAvailable() {
  return !!proUi && store.getSettings().premiumEnabled !== false;
}

// ON = available AND actually paid for. Entitlement comes from the signed token
// via getLicenseStatus — never from settings.licenseTier, which pro-license.js
// documents as a cosmetic cache and which a user could simply edit. Unpackaged
// trees stay unlocked so development never needs a key.
let entitlementCache = null;
function invalidateEntitlement() { entitlementCache = null; }
function entitled() {
  if (entitlementCache !== null) return entitlementCache;
  try {
    const st = proLicense && proLicense.getLicenseStatus
      ? proLicense.getLicenseStatus(store)
      : null;
    entitlementCache = !!(st && st.valid && st.tier && st.tier !== 'free');
  } catch (e) {
    log.error('entitlement check failed: ' + (e && e.message));
    entitlementCache = false; // fail closed
  }
  return entitlementCache;
}

function premiumOn() {
  if (!premiumAvailable()) return false;
  return isDev || entitled();
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
    ...(premiumOn() ? (proUi.getProConfig ? proUi.getProConfig(store) : proUi.getVocabularyConfig(store)) : {}),
    ...(premiumOn() && store.getSettings().confidenceHighlighting ? { word_confidence: true } : {}),
    // Complete tier: route transcription through the managed proxy instead of the
    // user's own key. Only engages when licensed AND a proxy URL is configured;
    // otherwise the engine keeps using the local provider above.
    ...(premiumOn() && s.licenseTier === 'complete' && s.managedProxyUrl
      ? { provider: 'managed', managed_proxy_url: s.managedProxyUrl, license_token: s.licenseToken || '' }
      : {}),
    // Meeting mode toggle for the engine (premium builds enable long-form capture). The
    // engine still only records on an explicit start, so this is a capability flag.
    ...(premiumOn() ? { meeting_mode: !!s.meetingMode } : {}),
  }).catch(() => {});
}

// --- IPC Handlers ---

// Settings
ipcMain.handle('get-settings', () => store.getSettings());
ipcMain.handle('get-decrypt-failures', () => store.getDecryptFailures());
// One-shot: returns the migration result if legacy data was restored this
// launch. Null otherwise. Frontend reads once at boot and shows a toast so
// the user knows their settings + history came from a previous install.
ipcMain.handle('get-migration-notice', () => {
  const notice = migrationNotice;
  migrationNotice = null; // one-shot; don't show the same toast twice
  return notice;
});
ipcMain.handle('save-settings', (_, patch) => {
  log.ipc('save-settings', Object.keys(patch).join(', '));
  const prev = store.getSettings();
  const settings = { ...prev, ...patch };
  store.saveSettings(settings);
  // A patch can carry licenseToken / premiumEnabled, so the entitlement answer
  // may have just changed. Cheaper to recompute lazily than to reason about it.
  invalidateEntitlement();
  // Update background + title bar overlay color on theme change
  if (mainWindow) {
    const isDark = settings.theme === 'dark';
    mainWindow.setBackgroundColor(isDark ? '#1C1917' : '#FAFAF9');
    if (process.platform === 'win32') {
      mainWindow.setTitleBarOverlay({
        color: isDark ? '#1C1917' : '#F5F5F4',
        symbolColor: isDark ? '#A8A29E' : '#78716C',
      });
    }
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
    if (!registerHotkey(settings.hotkey)) notifyHotkeyFailed(settings.hotkey);
  }
  // Toggle pill visibility — honor pillShouldShow() (setting OR promotion) so a
  // settings save can't tear down a pill that's currently the live surface.
  if (pillShouldShow() && (!pillWindow || pillWindow.isDestroyed())) {
    createPillWindow();
  } else if (!pillShouldShow() && pillWindow && !pillWindow.isDestroyed()) {
    pillWindow.close();
  }
  // Toggle debug logging at runtime
  if (patch.debugLogging !== undefined) {
    log.setEnabled(!!settings.debugLogging);
  }
  // Push relevant changes to sidecar
  const sidecarFields = ['mode', 'language', 'localModel', 'provider', 'apiModel',
    'openaiApiKey', 'geminiApiKey', 'customBaseUrl', 'soundEnabled',
    'outputMode', 'targetLanguage', 'sourceLanguage', 'audioRetentionDays',
    'customVocabulary', 'activeSnippet', 'snippetTemplates', 'recordingSound',
    'postProcessingEnabled', 'postProcessingPrompt', 'voiceCommands', 'smartPunctuation',
    'liveStreaming', 'continuousListening', 'voiceCorrections',
    'licenseTier', 'licenseToken', 'managedProxyUrl', 'meetingMode'];
  const changed = sidecarFields.some(k => settings[k] !== prev[k]);
  if (changed) {
    configureSidecar();
  }
  // Premium: start/stop the always-on VAD listener when continuous-listening toggles
  if (premiumOn() && settings.continuousListening !== prev.continuousListening
      && sidecar && sidecar.isRunning) {
    sidecar.send(settings.continuousListening ? 'start_continuous' : 'stop_continuous').catch(() => {});
  }
  return { success: true };
});

// --- Premium: license / integrations / meeting IPC (Phase 3-4) ---
// All guarded so the free build (modules absent) answers honestly instead of
// throwing. The injected Pro UIs degrade gracefully when a handler is missing.

// Activate a license key: verify + persist tier/token via pro-license, then
// re-push managed credentials to the sidecar so Complete-tier routing turns on.
ipcMain.handle('pro-activate', async (_, key) => {
  // Availability only — gating activation on entitlement would mean you need a
  // licence before you can enter your licence.
  if (!premiumAvailable() || !proLicense || !proLicense.activate) {
    return { ok: false, error: 'licensing-unavailable' };
  }
  try {
    const res = await proLicense.activate(store, key);
    invalidateEntitlement();
    configureSidecar();
    if (proLicenseUi && proLicenseUi.injectLicenseUI && mainWindow) {
      try { proLicenseUi.injectLicenseUI(mainWindow, store); } catch {}
    }
    return res;
  } catch (e) {
    log.error('pro-activate failed: ' + e);
    return { ok: false, error: String(e && e.message || e) };
  }
});
ipcMain.handle('pro-deactivate', async () => {
  if (!premiumAvailable() || !proLicense || !proLicense.deactivate) {
    return { ok: false, error: 'licensing-unavailable' };
  }
  try {
    const res = await proLicense.deactivate(store);
    invalidateEntitlement();
    configureSidecar();
    if (proLicenseUi && proLicenseUi.injectLicenseUI && mainWindow) {
      try { proLicenseUi.injectLicenseUI(mainWindow, store); } catch {}
    }
    return res;
  } catch (e) {
    log.error('pro-deactivate failed: ' + e);
    return { ok: false, error: String(e && e.message || e) };
  }
});
// Open a URL in the user's real browser (upgrade / OAuth consent links).
ipcMain.handle('open-external', async (_, url) => {
  try {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
      return { ok: true };
    }
    return { ok: false, error: 'invalid-url' };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

// License/tier for the shared frontend. The UI used to read /api/license over
// HTTP — web-only — so on desktop it failed and WC_TIER fell back to "free",
// silently locking every paid entry point. Serve the real desktop status here.
ipcMain.handle('get_license', () => {
  try {
    if (proLicense && proLicense.getLicenseStatus) return proLicense.getLicenseStatus(store);
  } catch (e) { log.error('get_license failed: ' + (e && e.message)); }
  return { tier: 'free', valid: false, expiresAt: null, offlineGrace: false, email: null, reason: 'no-license' };
});



// Factory reset
ipcMain.handle('reset-settings', () => {
  if (pillWindow) pillWindow.close();
  store.resetAll();
  return { success: true };
});

// History
ipcMain.handle('get-history', () => store.getHistory());

// Paginated, newest-first, optional text search — parity with the web
// /api/history/page. Returns {items,total,offset,limit} so the frontend pager
// works identically on desktop.
ipcMain.handle('get_history_page', (_, payload) => {
  const limit = parseInt((payload && payload.limit) ?? 50, 10) || 50;
  const offset = parseInt((payload && payload.offset) ?? 0, 10) || 0;
  const query = (payload && payload.query) || '';
  return {
    items: store.page({ limit, offset, query }),
    total: store.count(query),
    offset,
    limit,
  };
});

// Persist an edited transcript AND review-enrichment fields (summary, action
// items, speakers, title) so a coherent meeting review survives reopen/restart.
// Whitelisted like server.js; the JSON store keeps unknown fields via spread.
ipcMain.handle('update_history_text', (_, payload) => {
  const body = payload || {};
  const patch = {};
  if (typeof body.text === 'string') { patch.text = body.text; patch.edited = true; }
  if (typeof body.title === 'string') patch.title = body.title;
  if (typeof body.summary === 'string') patch.summary = body.summary;
  if (Array.isArray(body.action_items)) patch.action_items = body.action_items;
  if (body.speakers && typeof body.speakers === 'object') patch.speakers = body.speakers;
  if (!Object.keys(patch).length) return { success: true };
  const before = store.getHistory().find(h => h.id === body.id);
  if (!before) return { success: false, error: 'Not found.' };
  store.updateHistory(body.id, patch);
  return { success: true };
});
// --- Pro data portability: import from Free, backup, restore (premium only) ---
// Guarded by premiumOn() so the free build (which ships no pro-data-tools) never
// exposes these. Each returns a plain {success,...} result the injected Pro UI
// renders.
ipcMain.handle('data-scan-free', () => {
  if (!premiumOn() || !proDataTools) return { success: false, available: false };
  try {
    const freeDir = proDataTools.freeConfigDirFrom(store.configDir);
    const scan = proDataTools.scanInstall(freeDir);
    return { success: true, available: scan.exists, historyCount: scan.historyCount, dir: freeDir };
  } catch (e) { return { success: false, error: String(e && e.message || e) }; }
});
ipcMain.handle('data-import-free', () => {
  if (!premiumOn() || !proDataTools) return { success: false };
  try {
    const freeDir = proDataTools.freeConfigDirFrom(store.configDir);
    const res = proDataTools.importFrom(store, freeDir);
    return { success: true, ...res };
  } catch (e) { return { success: false, error: String(e && e.message || e) }; }
});
ipcMain.handle('data-backup', async () => {
  if (!premiumOn() || !proDataTools) return { success: false };
  try {
    const { dialog } = require('electron');
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where to save your WhisperClick backup',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (pick.canceled || !pick.filePaths[0]) return { success: false, canceled: true };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const res = proDataTools.backupTo(pick.filePaths[0], store.configDir, stamp);
    return { success: true, ...res };
  } catch (e) { return { success: false, error: String(e && e.message || e) }; }
});
ipcMain.handle('data-restore', async () => {
  if (!premiumOn() || !proDataTools) return { success: false };
  try {
    const { dialog } = require('electron');
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a WhisperClick backup folder to restore',
      properties: ['openDirectory'],
    });
    if (pick.canceled || !pick.filePaths[0]) return { success: false, canceled: true };
    const res = proDataTools.restoreFrom(store, pick.filePaths[0], proDataTools.audioDir());
    return { success: true, ...res };
  } catch (e) { return { success: false, error: String(e && e.message || e) }; }
});

ipcMain.handle('delete-history', (_, id) => {
  // Delete associated audio file before removing the history entry
  const history = store.getHistory();
  const entry = history.find(h => h.id === id);
  if (entry && entry.audio_file) {
    try { fs.unlinkSync(entry.audio_file); } catch { /* already gone */ }
  }
  return store.deleteHistory(id);
});
ipcMain.handle('clear-history', () => {
  // Delete all associated audio files before clearing history
  const history = store.getHistory();
  for (const entry of history) {
    if (entry.audio_file) {
      try { fs.unlinkSync(entry.audio_file); } catch { /* already gone */ }
    }
  }
  return store.clearHistory();
});

// State
ipcMain.handle('get-state', () => ({ state: sm.state, message: sm.message }));

// UI acknowledges a transient state (success/error) — transition to dormant
ipcMain.handle('ack-state', () => {
  log.ipc('ack-state', `state=${sm.state}`);
  if (sm.is('success', 'error')) {
    setAppState('dormant');
    broadcastState();
    return { success: true };
  }
  return { success: false, error: 'Nothing to acknowledge' };
});

// Pill click — pill sends what was clicked, main decides the action
ipcMain.handle('pill-clicked', async (_, action) => {
  log.ipc('pill-clicked', `action=${action} state=${sm.state}`);

  if (action === 'enter') {
    // Enter button clicked — simulate Enter keystroke, then go dormant
    simulateEnter();
    setAppState('dormant');
    broadcastState();
    return;
  }

  if (action === 'cancel') {
    const gate = canAcceptAction('cancel');
    if (!gate.allowed) return { success: false, error: gate.error };
    // Reset state immediately so UI unblocks
    setAppState('dormant');
    broadcastState();
    // Await sidecar cancel — matches cancel-processing behavior exactly
    if (!sidecar || !sidecar.isRunning) return { success: true };
    try {
      await sidecar.send('cancel');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'stop') {
    const gate = canAcceptAction('stop');
    if (!gate.allowed) return;
    await toggleRecording();
    return;
  }

  // action === 'capsule' — dormant click or fallback
  // Capture foreground before starting — pill is non-focusable so target app is still fg
  if (sidecar && sidecar.isRunning) sidecar.send('capture_fg').catch(() => {});

  const gate = canAcceptAction('toggle');
  if (!gate.allowed) {
    broadcastError(gate.error);
    return;
  }

  if (gate.actualAction === 'stop' || gate.actualAction === 'cancel') {
    await toggleRecording();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
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
      // Surface the failure instead of silently downgrading to a format check
      // that falsely reports success.
      log.error(`verify-api-key: backend verification failed (${err.message}); format-only fallback`);
    }
  }

  // Fallback: format-only check if sidecar is down. This is NOT verification —
  // never report valid:true here (that's the false-success bug); only say whether
  // the format is plausible and that we couldn't actually verify.
  if (provider === 'openai' && !key.startsWith('sk-')) {
    return { valid: false, verified: false, message: 'OpenAI keys start with sk-' };
  }
  if (provider === 'gemini' && !key.startsWith('AIza')) {
    return { valid: false, verified: false, message: 'Gemini keys start with AIza' };
  }
  return {
    valid: false, verified: false, formatValid: true,
    message: 'Could not verify key — backend unavailable. Format looks correct; try again.',
  };
});

// Start recording — separate from toggle, used by V3 frontend
ipcMain.handle('start-recording', async () => {
  log.ipc('start-recording', `state=${sm.state}`);

  // Single input gate — prevents "Already recording" by never reaching sidecar in wrong state
  const gate = canAcceptAction('start');
  if (!gate.allowed) {
    log.warn(`start-recording rejected: ${gate.error}`);
    return { success: false, error: gate.error };
  }
  setAppState('recording');
  broadcastState();
  try {
    await sidecar.send('start_rec');
    return { success: true };
  } catch (err) {
    log.error(`start-recording failed: ${err.message}`);
    // If sidecar thinks it's already recording (stale state from a previous
    // double-click or queued start), cancel it so the next attempt works.
    if (err.message && /already recording/i.test(err.message)) {
      log.warn('Sidecar has stale recording — sending cancel to reset');
      sidecar.send('cancel').catch(() => {});
    }
    setAppState('dormant');
    broadcastError(err.message || 'Failed to start recording');
    return { success: false, error: err.message };
  }
});

// Stop recording — blocks until transcription completes (V3 frontend expects this)
ipcMain.handle('stop-recording', async () => {
  log.ipc('stop-recording', `state=${sm.state}`);
  const gate = canAcceptAction('stop');
  if (!gate.allowed) {
    log.warn(`stop-recording rejected: ${gate.error}`);
    return { success: false, error: gate.error };
  }
  setAppState('processing');
  broadcastState();
  // Register listeners BEFORE sending stop_rec to avoid missing fast sidecar responses
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log.error('stop-recording: 120s timeout reached');
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
      const text = String(data.text || '');
      log.ipc('stop-recording', `transcription received (${text.length} chars)`);
      cleanup();
      if (text.trim().length === 0) {
        // Surface empty transcription instead of silently succeeding — prior
        // versions let users record, see nothing, and assume the app or key
        // was broken. A clear message lets them retry or check their mic.
        resolve({ success: false, error: 'No speech detected. Check your microphone and try again.' });
        return;
      }
      resolve({ success: true, text: data.text });
    }
    function onError(data) {
      log.error(`stop-recording: sidecar error — ${data.message || 'unknown'}`);
      cleanup();
      resolve({ success: false, error: data.message || 'Transcription failed' });
    }
    function onCancelled() {
      log.ipc('stop-recording', 'cancelled by user');
      cleanup();
      resolve({ success: false, error: 'Cancelled' });
    }
    function onExit() {
      log.error('stop-recording: sidecar exited during processing');
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
  log.ipc('cancel-processing', `state=${sm.state}`);

  // Single input gate
  const gate = canAcceptAction('cancel');
  if (!gate.allowed) {
    return { success: false, error: gate.error };
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

// Recording controls (Batch C) — pause/resume freeze buffering in the engine
// without tearing down the mic stream, so the take resumes instantly.
ipcMain.handle('pause_recording', async () => {
  try {
    const r = await sidecar.send('pause_rec');
    return { success: true, paused: !!(r && r.paused) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('resume_recording', async () => {
  try {
    const r = await sidecar.send('resume_rec');
    return { success: true, paused: !!(r && r.paused) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('is_recording_paused', async () => {
  try {
    const r = await sidecar.send('is_paused');
    return { paused: !!(r && r.paused) };
  } catch {
    return { paused: false };
  }
});

// Audio prefs — echo/noise/AGC constraints for renderer-side capture paths
// (system-capture, redo). Persisted in settings so they survive restarts.
const AUDIO_PREFS_DEFAULT = { echoCancellation: true, noiseSuppression: true, autoGainControl: false };
ipcMain.handle('get_audio_prefs', () => {
  const s = store.getSettings() || {};
  return { ...AUDIO_PREFS_DEFAULT, ...(s.audioPrefs || {}) };
});
ipcMain.handle('set_audio_prefs', (_, prefs) => {
  const s = store.getSettings() || {};
  const merged = { ...AUDIO_PREFS_DEFAULT, ...(s.audioPrefs || {}), ...(prefs && typeof prefs === 'object' ? prefs : {}) };
  store.saveSettings({ ...s, audioPrefs: merged });
  return { success: true, prefs: merged };
});

// Redo — re-record a short clip and return its text WITHOUT saving to history
// (the user is replacing a selection, not adding a take). Reuses the engine
// record path; the claim token keeps the global listener from persisting it.
let _redoActive = false;
ipcMain.handle('redo_start', async () => {
  if (sm.state === 'recording' || sm.state === 'processing') {
    return { success: false, error: 'Finish the current recording first.' };
  }
  try {
    await sidecar.send('start_rec');
    _redoActive = true;
    return { success: true };
  } catch (err) {
    if (err.message && /already recording/i.test(err.message)) sidecar.send('cancel').catch(() => {});
    return { success: false, error: err.message };
  }
});
ipcMain.handle('redo_stop', async () => {
  if (!_redoActive) return { success: false, error: 'not recording' };
  _redoActive = false;
  const token = {};
  _transcriptionClaim = token;
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      clearTimeout(timer);
      if (_transcriptionClaim === token) _transcriptionClaim = null;
      sidecar.removeListener('transcription', onDone);
      sidecar.removeListener('error', onErr);
    };
    const onDone = (data) => {
      if (done) return; done = true; cleanup();
      resolve({ success: true, text: ((data && data.text) || '').trim() });
    };
    const onErr = (data) => {
      if (done) return; done = true; cleanup();
      resolve({ success: false, error: (data && data.message) || 'Transcription failed.' });
    };
    const timer = setTimeout(() => {
      if (done) return; done = true; cleanup();
      resolve({ success: false, error: 'Transcription timed out.' });
    }, 120000);
    sidecar.on('transcription', onDone);
    sidecar.on('error', onErr);
    sidecar.send('stop_rec').catch((e) => {
      if (done) return; done = true; cleanup();
      resolve({ success: false, error: e.message });
    });
  });
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

// Legacy — pill no longer calls this directly (pill-clicked 'enter' handles it)
ipcMain.handle('simulate-enter', () => {
  simulateEnter();
  return { success: true };
});

// Audio playback — read audio file from disk and return as base64
ipcMain.handle('get-audio', async (_, historyId) => {
  const history = store.getHistory();
  const entry = history.find(h => String(h.id) === String(historyId));
  if (!entry || !entry.audio_file) return { success: false, error: 'No audio file' };
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
  const isRecording = sm.state === 'recording';
  const isProcessing = sm.state === 'processing';
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
  } catch (err) {
    // Mic submenu is best-effort; fall back to no submenu. Still log it — a
    // persistent failure here means the engine isn't answering list_mics.
    log.warn(`[tray] could not build mic submenu: ${err && err.message}`);
  }

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
        const gate = canAcceptAction('toggle');
        if (!gate.allowed) return;
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

  // Premium: transcribe an existing audio file (no recording needed)
  if (premiumOn() && proWindows && proWindows.openFileDialogAndTranscribe) {
    template.push({ type: 'separator' });
    template.push({
      label: 'Transcribe audio file…',
      click: () => {
        const { dialog } = require('electron');
        proWindows.openFileDialogAndTranscribe({ dialog, sidecar, BrowserWindow });
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

function simulateEnter() {
  if (process.platform === 'win32') {
    if (sidecar && sidecar.isRunning) {
      sidecar.send('press_enter').catch(() => {});
    }
  } else if (process.platform === 'darwin') {
    const { exec } = require('child_process');
    exec('osascript -e \'tell application "System Events" to keystroke return\'');
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
  // ── PHASE 1: Critical path — get window visible + hotkey active ASAP ──
  // Migrate legacy config folders before constructing the Store. If the
  // current configDir has no settings.json but a legacy path does, copy
  // settings + history over. See platforms/electron/migration.js.
  migrationNotice = migrateLegacyConfig(
    app.getPath('userData'),
    configDir,
    channel,
    app.getVersion(),
  );
  store = new Store(configDir, log);
  seedApiKeysFromDotEnv(store, log);

  // System-audio capture: grant getDisplayMedia with loopback audio (the machine's
  // output) without a picker, so start_system_capture works like the web build's
  // getDisplayMedia path. Electron 30+ supports audio:'loopback' on Windows/macOS.
  try {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback(sources && sources.length ? { video: sources[0], audio: 'loopback' } : {});
      }).catch(() => callback({}));
    }, { useSystemPicker: false });
  } catch (e) { log.error('setDisplayMediaRequestHandler failed: ' + (e && e.message)); }

  const settings = store.getSettings();
  log.init(configDir, settings.debugLogging, isDev);
  log.info(`[premium] module load: ${JSON.stringify(PREMIUM_LOAD_STATUS)}`);
  if (migrationNotice) {
    log.info(`[migration] restored config from ${migrationNotice.from} (${migrationNotice.filesCopied} files, ${migrationNotice.historyCount} history entries)`);
  }

  createMainWindow();
  if (!registerHotkey(settings.hotkey || 'Ctrl+Alt+R')) {
    notifyHotkeyFailed(settings.hotkey || 'Ctrl+Alt+R');
  }
  // Premium: clipboard-history ring on Ctrl+Shift+V (paste any recent transcription)
  if (premiumOn() && proWindows && proWindows.openClipboardRing) {
    try {
      globalShortcut.register('CommandOrControl+Shift+V', () => {
        if (!premiumOn()) return;
        proWindows.openClipboardRing({
          BrowserWindow, clipboard, screen, store,
          onPick: (text) => { clipboard.writeText(text); setTimeout(simulatePaste, 150); },
        });
      });
    } catch (e) { log.error('Clipboard-ring hotkey failed: ' + e); }
  }

  // Start sidecar early — Python spawn takes time, run in parallel with UI setup
  const enginePath = process.env.WHISPERCLICK_ENGINE_PATH || path.join(__dirname, '../../shared/engine/engine.py');
  sidecar = new Sidecar(enginePath);

  // Register updater IPC + events synchronously (cheap — no network) so the
  // frontend's startup get_update_channel query can't race a deferred
  // registration. The actual network update check stays deferred (Phase 3).
  initUpdater(mainWindow, store, sidecar);

  // ── PHASE 2: Next tick — non-critical UI that user doesn't see immediately ──
  setImmediate(() => {
    if (settings.showPill) {
      createPillWindow();
    }

    // R4: reconciler backstop — every ~4s, recreate the pill if it should be
    // showing but has vanished (renderer crash, display change). unref so it
    // never keeps the process (or a test runner) alive on its own.
    pillReconciler = setInterval(ensurePill, 4000);
    if (pillReconciler.unref) pillReconciler.unref();

    tray = createTray({
      onShow: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
      onBuildMenu: () => buildRichMenuTemplate({ includeQuit: true }),
      onToggleRecording: () => trayToggleRecording(),
      onCancelRecording: async () => {
        log.tray('cancel-recording', `state=${sm.state}`);
        const gate = canAcceptAction('cancel');
        if (!gate.allowed) return;
        setAppState('dormant');
        broadcastState();
        if (sidecar && sidecar.isRunning) {
          try { await sidecar.send('cancel'); } catch { /* ignore */ }
        }
      },
      getIsRecordingActive: () => sm.state === 'recording' || sm.state === 'processing',
      onBalloonClick: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.executeJavaScript('openSettingsDrawer()').catch(() => {});
        }
      },
      getTrayClickAction: () => store.getSettings().trayClickAction || 'show',
      onCaptureTarget: () => {
        if (sidecar && sidecar.isRunning) sidecar.send('capture_fg').catch(() => {});
      },
      isDev,
    });
  });

  // ── PHASE 3: Deferred — updater, history preload, post-update check ──
  setTimeout(() => {
    // Pre-warm history cache so first getHistory() call doesn't block main process
    store.getHistory();

    // Background update checks must not keep the event loop alive (clean quit) or
    // leak across test runs — unref them, and clear the interval on will-quit.
    const firstUpdateCheck = setTimeout(() => checkForUpdatesQuietly(), 8_000);
    if (firstUpdateCheck.unref) firstUpdateCheck.unref();
    updateCheckInterval = setInterval(() => checkForUpdatesQuietly(), 4 * 60 * 60 * 1000);
    if (updateCheckInterval.unref) updateCheckInterval.unref();

    const updateResult = checkUpdateMarker();
    if (updateResult.updated) {
      log.info(`Post-update launch: ${updateResult.from} → ${updateResult.to}`);
      if (Notification.isSupported()) {
        const n = new Notification({
          title: 'WhisperClick Updated',
          body: `Successfully updated to v${updateResult.to}`,
        });
        n.on('click', () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
        });
        n.show();
      }
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('update-success', updateResult);
      });
    }
  }, 500);

  let sidecarRestartCount = 0;
  let sidecarRecoveryCycles = 0;

  sidecar.on('ready', () => {
    log.sidecar('ready', 'pushing initial config');
    // Engine is healthy again — restore both the fast-restart and cooldown budgets.
    sidecarRestartCount = 0;
    sidecarRecoveryCycles = 0;
    configureSidecar();
  });

  sidecar.on('level', (data) => broadcastLevel(data.level));

  // Premium: forward streaming partial transcripts to the renderer as a DOM event
  sidecar.on('partial_transcript', (data) => {
    if (!premiumOn() || !mainWindow || mainWindow.isDestroyed()) return;
    const payload = JSON.stringify(data || {});
    mainWindow.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('whisperclick:partial-transcript',{detail:${payload}}))`
    ).catch(() => {});
  });


  sidecar.on('transcription', (data) => {
    log.sidecar('transcription', `${(data.text || '').length} chars, provider=${data.provider || '?'}`);
    // A caller owns this result (retranscribe updates an existing entry) — skip the
    // default add-new-entry + auto-paste flow so we don't duplicate or paste it.
    if (_transcriptionClaim) {
      log.sidecar('transcription', 'claimed by caller — skipping default history/paste flow');
      setAppState('success');
      broadcastState();
      return;
    }
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
      // Premium: decorate the new history row (language / speaker / confidence badges)
      if (premiumOn() && proUi.onTranscription) {
        try { proUi.onTranscription(mainWindow, store, data); }
        catch (e) { log.error('Pro onTranscription failed: ' + e); }
      }
      // Premium: direct-send the finished transcript to the active integration
      // (Obsidian/Notion/Slack/GDoc). No-op unless the user enabled one. Fire-and-
      // forget so a slow/failed send never blocks the paste path below.
      if (premiumOn() && proIntegrations && proIntegrations.sendActiveTranscription) {
        Promise.resolve(proIntegrations.sendActiveTranscription(store, data.text, { source: 'WhisperClick' }))
          .catch((e) => log.error('Pro integration send failed: ' + e));
      }
    }
    // Auto-paste: copy to clipboard and simulate Ctrl+V
    const currentSettings = store.getSettings();
    const didPaste = currentSettings.autoPaste && data.text;
    if (didPaste) {
      clipboard.writeText(data.text);
      // Small delay to ensure focus is on the target app
      setTimeout(() => {
        simulatePaste();
        // Auto-enter: press Enter after paste with smart delay
        if (currentSettings.autoEnterMode === 'auto') {
          const charDelay = Math.min(300 + (data.text.length * 5), 3000);
          setTimeout(() => simulateEnter(), charDelay);
        }
      }, 150);
    }
    // Notify pill of button mode for enter button display (only if something was pasted)
    if (didPaste && currentSettings.autoEnterMode === 'button') {
      const dur = data.duration || 0;
      renderPill({ shape: 'enter-ready' });
    }
    // Fallback timer — UI can ack earlier via ack-state IPC.
    // Enter button mode gets longer delay since user may click enter up to 5s later.
    const enterButtonActive = didPaste && currentSettings.autoEnterMode === 'button';
    const fallbackDelay = enterButtonActive ? 6000 : 1500;
    setTimeout(() => {
      if (sm.is('success')) {
        setAppState('dormant');
        broadcastState();
      }
    }, fallbackDelay);
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
    log.sidecar('cancelled');
    setAppState('dormant');
    broadcastState();
  });

  sidecar.on('model_download_progress', (data) => {
    if (mainWindow) mainWindow.webContents.send('model-download-progress', data);
  });

  sidecar.on('error', (data) => {
    log.sidecar('error', data.message || 'unknown');
    broadcastError(data.message || 'Something went wrong');
    if (mainWindow) mainWindow.webContents.send('sidecar-error', data);
  });

  const MAX_SIDECAR_RESTARTS = 3;
  // After the fast restarts are exhausted, try a few slow "cooldown" recoveries
  // before giving up — so a transient cause (mic locked by an AV scan, a brief
  // device glitch) can recover instead of bricking voice for the whole session.
  const RECOVERY_DELAY_MS = 30000;
  const MAX_RECOVERY_CYCLES = 2;

  function scheduleSidecarStart(delay) {
    const timer = setTimeout(() => {
      if (isQuitting) return;
      try { sidecar.start(); } catch (err) { log.error(`Sidecar restart failed: ${err.message}`); }
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
  }

  sidecar.on('exit', (code) => {
    log.sidecar('exit', `code=${code}`);
    if (isQuitting) return;

    // If recording or processing was in progress, reset state and notify user
    if (sm.state === 'recording' || sm.state === 'processing') {
      broadcastError('Backend crashed — recording lost');
    }

    if (code === 0 || code === null) return; // clean exit — no restart

    if (sidecarRestartCount < MAX_SIDECAR_RESTARTS) {
      sidecarRestartCount++;
      const delay = 1000 * sidecarRestartCount;
      log.sidecar('restart', `in ${delay}ms (attempt ${sidecarRestartCount}/${MAX_SIDECAR_RESTARTS})`);
      scheduleSidecarStart(delay);
    } else if (sidecarRecoveryCycles < MAX_RECOVERY_CYCLES) {
      // Fast restarts exhausted — slow cooldown retry with a fresh fast-restart budget.
      sidecarRecoveryCycles++;
      sidecarRestartCount = 0;
      log.sidecar('restart',
        `cooldown recovery ${sidecarRecoveryCycles}/${MAX_RECOVERY_CYCLES} in ${RECOVERY_DELAY_MS}ms`);
      broadcastError('Backend is restarting…');
      scheduleSidecarStart(RECOVERY_DELAY_MS);
    } else {
      log.error('Sidecar crashed too many times — giving up');
      broadcastError('Backend failed to start — restart the app');
    }
  });

  // Start sidecar (synchronously — engine spawn takes time, run early).
  try {
    log.sidecar('start', `engine=${enginePath}`);
    sidecar.start();
  } catch (err) {
    log.error(`Failed to start sidecar: ${err.message}`);
  }

  // R10: sweep orphaned engine.exe left by a prior crashed/hard-killed run,
  // sparing the engine we just started (keepPid). Best-effort and async.
  //
  // ONLY in production. In production our engine IS the bundled engine.exe, so
  // any other engine.exe is genuinely our own orphan. In dev the engine runs
  // as `python`, so keepPid is a python pid and every engine.exe on the box
  // belongs to a *different* (packaged) install — sweeping there would kill a
  // bystander's live engine. (Surfaced by live testing 2026-06-03.)
  if (!isDev) {
    // Scoped by executable PATH (ownDir = our resourcesPath): only engines that
    // live under THIS install are eligible, and keepPid spares the live one. It
    // cannot touch a different install, a dev instance, or an unrelated
    // engine.exe. (Path-scoping added 2026-06-04 after live testing.)
    sweepStaleEngines({ keepPid: sidecar.pid, ownDir: process.resourcesPath })
      .then((r) => {
        if (r.swept && r.swept.length) {
          log.sidecar('orphan-sweep', `killed ${r.swept.length} stale engine(s): ${r.swept.join(',')}`);
        }
      })
      .catch(() => { /* sweep is best-effort */ });
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  if (pillReconciler) { clearInterval(pillReconciler); pillReconciler = null; }
  if (updateCheckInterval) { clearInterval(updateCheckInterval); updateCheckInterval = null; }
  // R5: force-reap synchronously so the engine child can't be orphaned if the
  // app process exits before a deferred kill timer would have fired.
  if (sidecar) sidecar.stop({ force: true });
});

app.on('window-all-closed', () => {
  // Don't quit on macOS unless explicitly quitting
  if (process.platform !== 'darwin') {
    // Only quit if no tray (tray keeps app alive)
    if (!tray) app.quit();
  }
});
