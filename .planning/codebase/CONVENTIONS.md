# CONVENTIONS.md — WhisperClick Electron Codebase

Code style, naming conventions, and hard boundaries for consistency across the Electron-based WhisperClick desktop app.

## Code Style & Architecture

### No React / Vanilla JS + Inline HTML

- **V3 frontend is used directly** — `src/frontend/index.html` (4800+ lines of inline JavaScript)
- **No frameworks** — vanilla JavaScript, no React, Vue, Svelte, or similar
- **No bundler** — frontend is loaded directly, not compiled through Webpack/Vite
- **Inline CSS and JS** — styles and scripts live in `<style>` and `<script>` tags within the HTML
- **Architecture**: Renderer → preload shim → IPC → main process → sidecar (Python)

### Preload as Compatibility Layer

The preload script (`electron/preload.js`) acts as a **pywebview API shim**:
- V3 frontend calls `window.pywebview.api.method(...args)` (unchanged from pywebview)
- Preload translates field names and routes calls through `ipcRenderer.invoke()` to the main process
- This design ensures **pixel-perfect parity with V3** — the frontend is portable and unmodified

## Naming Conventions

### IPC Channels — `kebab-case`

IPC channel names (passed to `ipcMain.handle()` and `ipcRenderer.invoke()`) use kebab-case:

```javascript
// electron/main.js (main process)
ipcMain.handle('save-settings', handler);
ipcMain.handle('start-recording', handler);
ipcMain.handle('stop-recording', handler);
ipcMain.handle('get-app-info', handler);
ipcMain.handle('get-update-status', handler);
ipcMain.handle('list-models', handler);
ipcMain.handle('download-model', handler);
ipcMain.handle('cancel-download', handler);

// electron/preload.js (renderer)
ipcRenderer.invoke('save-settings', patch);
ipcRenderer.invoke('start-recording');
```

**Rationale**: IPC channels are external API contracts between main and renderer. Kebab-case is Electron convention and clearly distinct from camelCase JS names.

### Preload API Methods — `snake_case`

Methods exposed via `window.pywebview.api` use snake_case to match V3 expectations:

```javascript
// Exposed to V3 frontend via contextBridge
window.pywebview.api = {
  get_settings: (...) => ipcRenderer.invoke('get-settings', ...)
  save_settings: (patch) => ipcRenderer.invoke('save-settings', ...)
  start_recording: (...) => ipcRenderer.invoke('start-recording', ...)
  stop_recording: (...) => ipcRenderer.invoke('stop-recording', ...)
  set_api_key: (key, value) => ipcRenderer.invoke('set-api-key', ...)
  get_api_key: (key) => ipcRenderer.invoke('get-api-key', ...)
  list_models: (...) => ipcRenderer.invoke('list-models', ...)
}
```

**Rationale**: V3 frontend was written for pywebview, which uses snake_case. By matching that convention, the preload becomes a transparent API shim and the V3 code needs no modification.

### Store Fields & JS Variables — `camelCase`

Settings stored in `electron/store.js` and all JS variables use camelCase:

```javascript
const DEFAULT_SETTINGS = {
  mode: 'api',
  provider: 'openai',
  apiModel: 'whisper-1',
  localModel: 'base',
  alwaysOnTop: false,
  autoPaste: true,
  autoStart: false,
  soundEnabled: true,
  outputMode: 'transcribe',
  targetLanguage: 'en',
  sourceLanguage: 'auto',
  customBaseUrl: '',
  audioRetentionDays: 30,
  autoDownloadUpdates: false,
  trayClickAction: 'show',
  debugLogging: false,
  openaiApiKey: '',
  geminiApiKey: '',
};
```

**Rationale**: JS convention. Stores, variables, and object keys in JS use camelCase. Easy to read and matches Node.js/Electron ecosystem defaults.

### Settings Translation (V3 ↔ Electron)

The preload automatically translates field names between V3's snake_case and Electron's camelCase:

```javascript
// electron/preload.js
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
  tray_click_action: 'trayClickAction',
  auto_enter_mode: 'autoEnterMode',
  debug_logging: 'debugLogging',
};

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
```

**How it works:**
- V3 frontend sends `{ auto_copy: true, start_with_windows: false }`
- Preload translates to `{ autoPaste: true, autoStart: false }`
- Sent to main process via `ipcRenderer.invoke('save-settings', translated)`
- Main process stores the camelCase version
- When returning settings to frontend, preload translates back to snake_case

### JS Functions & Classes — `camelCase`

All function and class names use camelCase:

```javascript
// electron/main.js
function createMainWindow() { ... }
function createPillWindow() { ... }
function setupGlobalHotkey() { ... }
function broadcastState() { ... }

class StateMachine { ... }
class Sidecar extends EventEmitter { ... }
class Store { ... }

// electron/preload.js
function patchToElectron(patch) { ... }
function settingsToV3(settings) { ... }
```

### Constants — `UPPER_SNAKE_CASE`

Constants use UPPER_SNAKE_CASE:

```javascript
// electron/store.js
const MAX_HISTORY = 500;
const DEFAULT_SETTINGS = { ... };
const KEY_FIELDS = ['openaiApiKey', 'geminiApiKey'];

// tests/unit/main-ipc.test.js
const TEST_CONFIG_BASE = realFs.mkdtempSync(path.join(os.tmpdir(), 'wc-ipc-'));
```

### File Names — kebab-case or camelCase

- **Electron main process files**: `main.js`, `preload.js`, `preload-pill.js`, `sidecar.js`, `store.js`, `tray.js`, `updater.js`, `logger.js`, `state-machine.js`
- **Test files**: `main-ipc.test.js`, `preload.test.js`, `sidecar.test.js`, `store.test.js`, `tray.test.js`, `updater.test.js`, `logger.test.js`, `state-machine.test.js`
- **Frontend assets**: `index.html`, `tailwind.css`, `lucide.min.js`
- **Mock files**: `electron.js`, `electron-updater.js`, `mock-sidecar.py`

**Rationale**: File names use kebab-case for multi-word files (e.g., `state-machine.js`, `main-ipc.test.js`) for readability; single-word files stay as-is (`store.js`, `tray.js`).

## Error Handling Patterns

### IPC Handlers Return `{ success, error }`

All IPC handlers in `electron/main.js` follow this pattern:

```javascript
ipcMain.handle('save-settings', (event, patch) => {
  try {
    const prev = store.getSettings();
    const settings = { ...prev, ...patch };
    store.saveSettings(settings);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('start-recording', async (event, options) => {
  try {
    // Perform action
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
```

**Why this pattern:**
- **Never throw into the renderer** — errors would crash the renderer process or be unhandled
- **Consistent response shape** — all handlers follow the same `{ success, error }` structure
- **Preload can safely wrap** — frontend receives predictable error objects
- **Sidecar-proxy handlers** explicitly check `if (!sidecar || !sidecar.isRunning)` before delegating

Example from `electron/main.js`:

```javascript
ipcMain.handle('list-models', async (event) => {
  try {
    if (!sidecar || !sidecar.isRunning()) {
      return { success: false, error: 'Sidecar not running' };
    }
    const result = await sidecar.invoke('list-models', {});
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
```

### Preload Methods Return Defaults on Error

Preload methods catch errors and return safe defaults so the V3 frontend never sees exceptions:

```javascript
// electron/preload.js
window.pywebview.api = {
  get_settings: async () => {
    try {
      const resp = await ipcRenderer.invoke('get-settings');
      if (!resp.success) return {};
      return settingsToV3(resp.settings);
    } catch {
      return {};  // Safe fallback
    }
  },
  save_settings: async (patch) => {
    try {
      const electronPatch = patchToElectron(patch);
      const resp = await ipcRenderer.invoke('save-settings', electronPatch);
      return resp.success;  // Boolean
    } catch {
      return false;  // Safe fallback
    }
  },
};
```

### Store Reads Never Throw

Store reads fall back gracefully:

```javascript
// electron/store.js
_safeReadJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  // Fallback to .bak if primary is corrupt
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath + '.bak', 'utf8'));
    try { this._atomicWrite(filePath, JSON.stringify(parsed, null, 2)); } catch {}
    return parsed;
  } catch {}
  return fallback;  // Last resort: use defaults
}

getSettings() {
  if (!this._settingsCache) {
    this._settingsCache = this._safeReadJSON(
      this.settingsPath,
      { ...DEFAULT_SETTINGS }
    );
  }
  return this._settingsCache;
}
```

## Forbidden Patterns

### Security — IPC Isolation

**MUST NOT:**
- Use `nodeIntegration: true` in BrowserWindow config — enables full Node.js in renderer (security violation)
- Use `contextIsolation: false` — exposes main process internals to untrusted renderer code
- Direct `require('electron')` in renderer — must go through preload's `contextBridge`
- Store API keys in localStorage — use Electron's `safeStorage` for encryption

**CORRECT:**

```javascript
// electron/main.js
mainWindow = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,  // REQUIRED
    nodeIntegration: false,  // REQUIRED
  },
});
```

**Preload must use contextBridge:**

```javascript
// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pywebview', {
  api: {
    get_settings: (...) => ipcRenderer.invoke('get-settings', ...),
    // ... other methods
  },
});
```

### IPC Communication

**MUST NOT:**
- Use `ipcRenderer.send()` for request/response — use `ipcRenderer.invoke()` for bidirectional IPC
- Direct `ipcRenderer` calls from V3 frontend code — route through preload shim
- `ipcMain.on()` for handlers that expect responses — use `ipcMain.handle()`

**CORRECT:**

```javascript
// electron/main.js
ipcMain.handle('save-settings', (event, patch) => {
  // ... handle and return response
  return { success: true };
});

// electron/preload.js
const resp = await ipcRenderer.invoke('save-settings', patch);
```

### Store Mutations

**MUST NOT:**
- Call `store.saveSettings(patch)` without merging — wipes all existing settings
- Store without merging with previous state

**CORRECT:**

```javascript
// electron/main.js
const prev = store.getSettings();
const settings = { ...prev, ...patch };  // MERGE
store.saveSettings(settings);
```

### Frontend Modifications

**MUST NOT:**
- Modify V3 `index.html` JS logic — keep it unmodified for portability
- Add React, Vue, or other frameworks to the frontend
- Use Tailwind CDN for dynamically-injected HTML (won't compile classes)

**CORRECT:**
- Route new features through the preload shim and IPC handlers
- Add IPC handlers in `electron/main.js`
- Extend preload API methods in `electron/preload.js`
- Keep V3 frontend code as-is (only 2 lines differ from the original)

### Process Management

**MUST NOT:**
- Call `app.quit()` without cleanup — must set `isQuitting`, close windows, stop sidecar first
- Use `pythonw.exe` for sidecar — silently crashes with Qt/PySide6
- Skip git hooks with `--no-verify` on commits

**CORRECT:**

```javascript
// electron/main.js
app.on('before-quit', async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    if (sidecar && sidecar.isRunning()) {
      await sidecar.stop();
    }
    app.quit();
  }
});
```

## Summary Table

| Element | Convention | Example |
|---------|-----------|---------|
| IPC channels | `kebab-case` | `save-settings`, `start-recording` |
| Preload API methods | `snake_case` | `get_settings()`, `set_api_key()` |
| Store fields | `camelCase` | `localModel`, `soundEnabled` |
| V3 frontend fields | `snake_case` | `auto_copy`, `api_provider` |
| JS functions | `camelCase` | `createMainWindow()`, `configureSidecar()` |
| JS classes | `camelCase` | `StateMachine`, `Sidecar` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_HISTORY`, `DEFAULT_SETTINGS` |
| Files | kebab-case or single word | `preload.js`, `main-ipc.test.js` |
| Error pattern | `{ success, error }` | All IPC handlers |
| Settings merge | Always merge | `{ ...prev, ...patch }` |
| API isolation | contextBridge required | `contextIsolation: true` |
| Settings encryption | safeStorage required | For API keys only |

## Files Reference

- **`electron/main.js`** — Main process, IPC handlers, window management, sidecar, tray, hotkey. ~800 lines, heavily structured.
- **`electron/preload.js`** — Renderer bridge, field translation, API shim. ~350 lines. Maps V3 API to Electron IPC.
- **`electron/preload-pill.js`** — Pill window preload, simpler API. ~50 lines.
- **`electron/store.js`** — Settings and history persistence, atomic writes, encryption. ~300 lines. Single source of truth.
- **`electron/sidecar.js`** — Python sidecar process manager, JSON stdin/stdout protocol. ~200 lines.
- **`electron/state-machine.js`** — Recording state tracking. ~150 lines.
- **`electron/tray.js`** — System tray icon and menu. ~150 lines.
- **`electron/updater.js`** — Auto-update management, channel selection. ~100 lines.
- **`electron/logger.js`** — Console logging with optional file output. ~50 lines.
- **`src/frontend/index.html`** — V3 frontend, 4800+ lines of inline HTML/CSS/JS. Unmodified except 2 lines.
- **`src/pill/pill.html`** — Floating pill widget, self-contained HTML.
- **`engine/engine.py`** — Python sidecar, recording, transcription, model management. Spawned by main process.

