# WhisperClick Electron — Process Architecture

## Overview

WhisperClick Electron is a 3-process Electron app with a Python sidecar.

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Process (Node.js)                 │
│  electron/main.js — Windows, IPC, Sidecar, Tray, Hotkey   │
│                                                              │
│  State Machine: dormant → recording → processing → success  │
│  (with error/recovery paths)                                │
└─────────────────────────────────────────────────────────────┘
           ↓                            ↓                  ↓
  ┌──────────────┐          ┌──────────────┐      ┌──────────────┐
  │  Renderer 1  │          │  Renderer 2  │      │   Python     │
  │  (Main UI)   │          │   (Pill)     │      │   Sidecar    │
  │              │          │              │      │  engine.py   │
  │ index.html   │          │ pill.html    │      │              │
  │ preload.js   │          │preload-pill  │      │ Audio record │
  │              │          │   .js        │      │ Transcribe   │
  └──────────────┘          └──────────────┘      │ Translate    │
                                                   │ Models       │
                                                   └──────────────┘
                                                        ↓
                                          JSON stdin/stdout protocol
```

---

## Main Process — `electron/main.js` (lines 1-50 show initialization)

**Purpose:** Window lifecycle, IPC routing, global hotkey, tray icon, sidecar spawn.

**Key globals (from lines 23-39):**
- `mainWindow, pillWindow, tray` — Electron window references
- `store` — JSON file persistence (`electron/store.js`)
- `sidecar` — Python subprocess manager (`electron/sidecar.js`)
- `sm` — **State Machine** (single source of truth for app state)
- `isDev, isBeta, configDir` — Environment detection

**Main window creation (lines 43-50 partial):**
```javascript
function createMainWindow() {
  const settings = store.getSettings();

  // Responsive: 22% of monitor width, clamped to [480, 650]
  const display = screen.getPrimaryDisplay();
  const effectiveWidth = display.workAreaSize.width;
  const targetWidth = Math.round(effectiveWidth * 0.22);
  const winWidth = Math.max(480, Math.min(650, targetWidth));
```
This window loads V3 frontend (`src/frontend/index.html`) with preload shim.

---

## State Machine — `electron/state-machine.js` (lines 1-172)

**Purpose:** Prevent invalid state transitions. Single source of truth.

**States:**
- `dormant` — Ready to record. Hotkey works. No recording active.
- `recording` — Audio stream open. User is speaking.
- `processing` — Recording stopped, waiting for transcription result.
- `success` — Transcription complete. Auto-paste happened. Timed out to dormant (2–3s).
- `error` — Sidecar crashed or transcription failed. Blocks recording until recovered.

**Valid transitions (lines 22-31):**
```javascript
TRANSITIONS = {
  dormant:    ['recording', 'error'],
  recording:  ['processing', 'dormant', 'error', 'success'],
  processing: ['success', 'dormant', 'error'],
  success:    ['dormant', 'recording'],
  error:      ['dormant', 'recording'],
};
```

**Key methods:**

| Method | Purpose |
|--------|---------|
| `can(to)` | Check if transition is allowed |
| `is(...states)` | Check current state |
| `canRecord` | Alias for `can(RECORDING)` — gates hotkey |
| `canAcceptAction` | Not shown in excerpt, but gates recording commands |
| `transition(to, msg)` | Attempt transition; notify listeners |
| `reset(msg)` | Force to dormant (error recovery only) |
| `on(fn)` | Subscribe to state changes |

**Usage in main.js:** State is checked before starting/stopping recording or handling sidecar events:

```javascript
if (!sm.canRecord) return; // Hotkey press blocked
sm.transition('recording');
// ... start sidecar audio
```

**Message context:** `sm.message` holds error details:
```javascript
sm.transition('error', 'Microphone unplugged');
// Later: console.log(sm.message) → "Microphone unplugged"
```

---

## IPC Patterns — Main ↔ Renderer

**All communication is request-reply via `ipcRenderer.invoke()`:**

```javascript
// Renderer (preload.js → V3 frontend)
async get_settings() {
  const s = await ipcRenderer.invoke('get-settings');
  return settingsToV3(s);  // snake_case for V3
}

// Main (main.js IPC handler)
ipcMain.handle('get-settings', () => {
  return store.getSettings();  // camelCase in store
});
```

**Key IPC channels:**
- `get-settings`, `save-settings`, `reset-settings` → Store operations
- `start-recording`, `stop-recording`, `cancel-processing` → Sidecar commands (gate via `sm.canRecord`, `sm.canCancel`)
- `get-state` → Return `{ state: sm.state, message: sm.message }`
- `list-models`, `download-model`, `delete-model` → Sidecar model ops
- `set-mic`, `list-mics` → Microphone queries
- `get-history`, `delete-history`, `clear-history` → History persistence
- `copy-to-clipboard`, `paste-last-transcript` → Clipboard operations
- `get-app-info`, `check-for-updates`, `install-update` → Auto-updater flow

**Error handling:**
```javascript
// IPC handler should NEVER throw. Return error object instead:
ipcMain.handle('start-recording', async () => {
  if (!sm.canRecord) {
    return { success: false, error: 'Already recording' };
  }
  // proceed...
  return { success: true };
});
```

---

## Preload Shim — `electron/preload.js` (lines 1-342)

**Purpose:** Bridge V3 JavaScript to Electron IPC. V3 code is unchanged.

**Architecture:**
1. V3 frontend calls `window.pywebview.api.method(...args)`
2. Preload intercepts via `contextBridge.exposeInMainWorld('pywebview', { api: { ... } })`
3. Each method routes to `ipcRenderer.invoke('ipc-channel', args)`
4. Main process handles, returns result
5. Preload translates response back if needed (e.g., settings camelCase → snake_case)

**Settings translation (lines 14-57):**

V3 uses snake_case; Electron store uses camelCase. Preload converts both ways:

```javascript
// V3 → Electron mapping
const V3_TO_ELECTRON = {
  'auto_copy': 'autoPaste',
  'api_provider': 'provider',
  'api_model': 'apiModel',
  'start_with_windows': 'autoStart',
  // ... 20+ more
};

// Save patch: V3 patch → translate → IPC
async save_settings(patch) {
  const electronPatch = patchToElectron(patch);
  await ipcRenderer.invoke('save-settings', electronPatch);
}

// Get settings: IPC → translate → V3 format
async get_settings() {
  const s = await ipcRenderer.invoke('get-settings');
  const v3 = settingsToV3(s);
  delete v3.openai_api_key;  // Filter API keys for security
  return v3;
}
```

**Push events (lines 63-116):**

Some events are sent from main → renderer asynchronously:
```javascript
// Lines 83-92: Model download progress
ipcRenderer.on('model-download-progress', (_e, data) => {
  latestDownloadProgress = data;
});

// Lines 95-97: Update status
ipcRenderer.on('update-status', (_e, data) => {
  latestUpdateStatus = data;
});

// Lines 110-112: State sync (when tray or pill changes recording state)
ipcRenderer.on('state-update', (_e, data) => {
  window.dispatchEvent(new CustomEvent('state-update', { detail: data }));
});
```

These are cached in preload module scope so polling-based V3 code can read them:
```javascript
// Line 196-199
async get_download_progress() {
  if (latestDownloadProgress) return latestDownloadProgress;
  return { status: 'idle', progress: 0 };
}
```

---

## Pill Renderer — `electron/preload-pill.js` (lines 1-25)

**Purpose:** Simpler API for the floating pill widget.

**Exposed API via `window.electronAPI`:**
```javascript
{
  getState: () => ipcRenderer.invoke('get-state'),
  onStateUpdate: (cb) => { ... },
  onLevelUpdate: (cb) => { ... },      // Real-time audio level

  toggleRecording: () => ipcRenderer.invoke('pill-toggle-recording'),
  cancelRecording: () => ipcRenderer.invoke('cancel-processing'),

  showContextMenu: () => ipcRenderer.invoke('pill-context-menu'),

  setIgnoreMouse: (ignore) => ipcRenderer.send('pill-set-ignore-mouse', ignore),

  onShowEnterButton: (cb) => { ... },
  simulateEnter: () => ipcRenderer.invoke('simulate-enter'),
}
```

**Note on `simulateEnter`:** Auto-Enter feature. After transcription, pill shows "Enter ↵" button. Click → macro simulates Enter key press.

---

## Sidecar Manager — `electron/sidecar.js`

**Purpose:** Spawn, manage, and communicate with Python subprocess.

**Communication:** JSON-over-stdin/stdout, one message per line.

**Commands (engine.py → sidecar.js):**
- `ping` — Heartbeat
- `quit` — Graceful shutdown
- `configure` — Set audio device, model path, API credentials
- `start_rec` — Begin recording
- `stop_rec` → `transcription` event (blocking)
- `cancel` → `cancelled` event
- `set_mode`, `set_language`, `set_model` — Runtime config
- `list_models` → array of available models
- `download_model`, `delete_model` → Model lifecycle
- `verify_key` — Test API key validity

**Events (sidecar.js → main.js):**
- `ready` — Sidecar initialized
- `level` — Real-time audio level (0–1) → display waveform
- `transcription` → text result + metadata
- `cancelled` → Recording aborted by user
- `error` → Sidecar crashed or command failed
- `model_download_progress` → { current, total, model }

**IPC routing:**
```javascript
// Main calls sidecar command:
sidecar.request('start_rec', {
  audio_device: '0',
  model: 'base',
  provider: 'local',  // 'local' | 'openai' | 'gemini'
  api_base_url: null,
  language: 'en',
  output_mode: 'normal',
  target_language: null,
});

// Sidecar responds with event:
sidecar.on('transcription', (result) => {
  sm.transition('success');
  // result = { text, language, confidence, duration_s, timestamp }
  // Main pastes text if autoPaste enabled
});
```

---

## Recording Data Flow

**Phase 1: User starts recording**
```
Hotkey pressed
→ executeJavaScript('triggerTrustedHotkeyToggle()')
→ V3 frontend validates: API keys?, Model downloaded?, Microphone OK?
→ window.pywebview.api.start_recording()
→ preload: ipcRenderer.invoke('start-recording')
→ main: sm.canRecord? → sm.transition('recording')
→ main: sidecar.request('start_rec', {...})
```

**Phase 2: User stops recording**
```
Hotkey pressed (or click Stop button)
→ window.pywebview.api.stop_recording()
→ ipcRenderer.invoke('stop-recording')
→ main: sm.canCancel? → sm.transition('processing')
→ main: sidecar.request('stop_rec')
→ [BLOCKING] Wait for sidecar 'transcription' event (120s timeout)
→ sidecar sends JSON: { "event": "transcription", "data": { "text": "...", ... } }
→ main: history.push(result) → store.saveSettings() → sm.transition('success')
→ main: if (settings.autoPaste) → simulateEnter + paste text
→ main: IPC 'state-update' → renderer displays text
→ [2–3s later] sm.transition('dormant')
```

**Error recovery:**
```
Sidecar crash or timeout → sm.transition('error', 'Sidecar died')
→ Block hotkey (sm.canRecord = false)
→ Tray icon shows red X
→ User clicks "Restart" → sm.reset() → sidecar respawn
```

---

## Frontend State Sync — Push Events

**The main window and pill window must stay in sync when recording state changes externally** (e.g., user pressed hotkey while window is hidden, or tray toggled recording).

**Main process broadcasts state changes:**
```javascript
// When sm transitions, or external event occurs:
function broadcastStateUpdate() {
  const state = { state: sm.state, message: sm.message };
  if (mainWindow) mainWindow.webContents.send('state-update', state);
  if (pillWindow) pillWindow.webContents.send('state-update', state);
}
```

**Renderers listen (preload.js lines 110-112):**
```javascript
ipcRenderer.on('state-update', (_e, data) => {
  window.dispatchEvent(new CustomEvent('state-update', { detail: data }));
});
```

**V3 frontend (index.html inline JS):**
```javascript
window.addEventListener('state-update', (e) => {
  // Update recording button, disable/enable inputs, etc.
  updateUIFromState(e.detail);
});
```

---

## Auto-Updater Flow

**Check for updates (main process trigger):**
```javascript
ipcMain.handle('check-for-updates', async () => {
  const result = await initUpdater();
  return result;
});

// initUpdater() returns: { hasUpdate, version, releaseNotes }
```

**Preload push events (lines 95-97):**
```javascript
ipcRenderer.on('update-status', (_e, data) => {
  latestUpdateStatus = data;  // { status: 'idle'|'downloading'|'ready', ... }
});

// V3 frontend polls:
async get_update_status() {
  return latestUpdateStatus || { status: 'idle' };
}
```

**Download and install:**
```javascript
await ipcRenderer.invoke('download-update');
// User clicks "Install and Restart"
await ipcRenderer.invoke('install-update');  // Spawns update installer, exits app
```

---

## Summary Table: Process Communication

| **From** | **To** | **Protocol** | **Example** |
|----------|--------|-------------|-----------|
| V3 frontend (renderer) | Main | IPC `invoke()` | `get_settings()` → `ipcRenderer.invoke('get-settings')` |
| Main | V3 frontend | IPC `send()` (broadcast) | `state-update`, `model-download-progress` |
| Pill renderer | Main | IPC `invoke()` + `send()` | `toggleRecording()` → `ipcRenderer.invoke('pill-toggle-recording')` |
| Main | Sidecar | JSON stdin | `{ "command": "start_rec", "args": {...} }` |
| Sidecar | Main | JSON stdout | `{ "event": "transcription", "data": {...} }` |
| Main | Tray/Hotkey | Node.js global | Direct function calls, no IPC |

---

## State Machine as a Gate

**The `canAcceptAction` pattern (not explicitly named in excerpt, but critical):**

Before any recording command reaches the sidecar, it must pass the state machine gate:

```javascript
// User hotkey pressed
if (!sm.canRecord) {
  console.log('Recording already in progress or app recovering from error');
  return;
}

// User clicks "Cancel"
if (!sm.canCancel) {
  console.log('No recording to cancel');
  return;
}

// Only after gates pass:
sm.transition('recording');
sidecar.request('start_rec', {...});
```

This ensures the sidecar never receives conflicting commands (e.g., two `start_rec` calls, or `stop_rec` when `start_rec` never arrived).

