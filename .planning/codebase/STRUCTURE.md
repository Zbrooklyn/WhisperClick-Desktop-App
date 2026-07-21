# WhisperClick Electron — Directory Structure & File Roles

## Directory Tree

```
projects/WhisperClick Electron/
├── .planning/codebase/              # Architecture documentation (this section)
│   ├── ARCHITECTURE.md              # Process model, IPC patterns, state machine
│   └── STRUCTURE.md                 # This file — directory layout & roles
│
├── electron/                         # Main process (Node.js + native modules)
│   ├── main.js                      # Entry point: windows, IPC, sidecar, tray, hotkey
│   ├── state-machine.js             # Single source of truth for app state
│   ├── preload.js                   # V3 API shim: window.pywebview → IPC
│   ├── preload-pill.js              # Pill window API: window.electronAPI
│   ├── sidecar.js                   # Python subprocess manager (stdin/stdout JSON)
│   ├── store.js                     # JSON file persistence (settings + history)
│   ├── tray.js                      # System tray icon, menu, context actions
│   ├── updater.js                   # electron-updater integration (stable/beta channels)
│   ├── logger.js                    # File + console logging (dev only)
│   └── package.json                 # Main process dependencies (electron, electron-updater, etc.)
│
├── src/
│   ├── frontend/                    # Main UI (V3 reused, minimal changes)
│   │   ├── index.html               # V3 HTML (~4800 lines, inline JS)
│   │   ├── css/
│   │   │   └── tailwind.css         # Pre-built Tailwind (from V3)
│   │   └── js/
│   │       └── lucide.min.js        # Icon library
│   │
│   └── pill/                        # Floating pill widget (floating tooltip/capsule)
│       ├── pill.html                # Self-contained HTML (~400 lines, inline CSS/JS)
│       └── [no subfolders — single-file design]
│
├── engine/                          # Python sidecar
│   ├── engine.py                    # Main sidecar entry point (stdin/stdout JSON protocol)
│   └── backend/                     # Backend modules
│       ├── audio_recorder.py        # Capture audio from microphone
│       ├── transcription.py         # Call Whisper (local/OpenAI/Gemini)
│       ├── translator.py            # Call translation APIs
│       ├── models.py                # Model download/deletion
│       ├── config.py                # Paths, constants, language lists
│       ├── logger.py                # Logging to file (stderr redirected)
│       └── tones.py                 # Notification sound playback
│
├── tests/                           # Jest test suite (412 tests)
│   ├── mocks/
│   │   ├── electron.js              # Comprehensive Electron API mock (1000+ lines)
│   │   └── sidecar.js               # Mock subprocess for e2e tests
│   │
│   ├── unit/                        # 399 isolated tests
│   │   ├── main-ipc.test.js         # IPC handlers, state machine, settings
│   │   ├── store.test.js            # JSON persistence, encryption
│   │   ├── sidecar.test.js          # Sidecar JSON protocol
│   │   ├── preload.test.js          # Settings translation (V3 ↔ Electron)
│   │   └── [other unit tests]
│   │
│   ├── integration/                 # 12 full recording-flow tests
│   │   ├── recording-flow.test.js   # Record → transcribe → paste
│   │   └── ...
│   │
│   └── e2e/                         # 13 mock-sidecar end-to-end tests
│       └── app-startup.test.js      # Windows open, sidecar spawns, ready
│
├── dist/                            # Build output (after `npm run dist:win`)
│   ├── WhisperClick Setup.exe       # Installer
│   └── WhisperClick-x.y.z.exe       # Portable executable
│
├── docs/
│   ├── ROADMAP.md                   # Feature pipeline (private, synced)
│   ├── FEATURES.md                  # Complete feature inventory & API
│   ├── TESTING.md                   # Test architecture & coverage details
│   ├── VERIFICATION.md              # Manual test checklist
│   └── dev/
│       ├── state-machine-refactor.md  # Design decisions for state machine
│       └── SCRUB_HISTORY.md          # Procedure for removing files from git history
│
├── HANDOFF.md                       # Current state, blockers, next actions
├── CHANGELOG.md                     # Version history (updates tracked here)
├── CLAUDE.md                        # This project's rules, conventions, patterns (private)
├── package.json                     # Root: test scripts, build, dependencies
├── package-lock.json                # Lock file
├── .gitignore                       # Exclude build artifacts, node_modules, etc.
├── .github/workflows/               # CI/CD (GitHub Actions)
└── tools/
    ├── sync_public.sh               # Strip private files before pushing to public repo
    └── v3_full_test.py              # [from WhisperClick V3, legacy reference]
```

---

## Key Files and Roles

### Main Process (`electron/`)

| File | Lines | Purpose | Key Exports/Exports |
|------|-------|---------|---------|
| **main.js** | ~1500 | Entry point. Creates windows, spawns sidecar, handles IPC, manages global hotkey, tray icon. Single instance lock enforced. | `createMainWindow()`, `createPillWindow()`, hotkey handlers, IPC handlers |
| **state-machine.js** | 172 | Single source of truth for app state (dormant, recording, processing, success, error). Validates transitions. Prevents invalid commands. | `StateMachine` class, `STATES` constants, `TRANSITIONS` table |
| **preload.js** | 342 | pywebview API shim for renderer isolation. V3 frontend unchanged. Routes all calls through `contextBridge`. Translates settings (snake_case ↔ camelCase). | `window.pywebview.api.*` (40+ methods) |
| **preload-pill.js** | 25 | Simpler API for pill widget. Exposes `window.electronAPI`. | `window.electronAPI.toggleRecording()`, `.cancelRecording()`, etc. |
| **sidecar.js** | ~300 | Spawn, manage, communicate with Python subprocess. Handles JSON protocol (stdin/stdout), buffering, error recovery. | `Sidecar` class, `.request()`, `.on()`, event handling |
| **store.js** | ~250 | JSON file persistence. Settings + history. Atomic writes (rename after `.tmp`). Encrypt API keys via `safeStorage`. Backup files (`.bak`). | `Store` class, `.getSettings()`, `.saveSettings()` |
| **tray.js** | ~200 | System tray icon, context menu, recording toggle. Colored icon states (recording, error, dormant). | `createTray()`, `updateTrayIcon()`, `updateTrayTooltip()` |
| **updater.js** | ~200 | electron-updater integration. Check, download, install updates. Stable/beta channel selection. | `initUpdater()`, `checkForUpdatesQuietly()` |
| **logger.js** | ~50 | File logging (dev only). Writes to `%APPDATA%/.config/whisperclick/`. | `log.info()`, `.warn()`, `.error()` |

### Renderer Processes (`src/`)

| File | Type | Purpose | Notes |
|------|------|---------|-------|
| **src/frontend/index.html** | HTML | V3 main UI. ~4800 lines inline JS. Handles all recording, settings, history, updates. Unchanged from V3 except 2 CSS lines and button handling. | Loaded with `preload.js`. No build step — direct load. |
| **src/frontend/css/tailwind.css** | CSS | Pre-built Tailwind v3. From V3, pre-compiled (no JIT rebuild). | Pulled from original V3. |
| **src/frontend/js/lucide.min.js** | JS | Icon library. SVG icons rendered as `<i data-lucide="icon-name"></i>`. | Lucide v0.x minified. |
| **src/pill/pill.html** | HTML | Floating capsule widget. ~400 lines. Displays real-time audio level bar. Records state, responds to main window state changes. | Loaded with `preload-pill.js`. Self-contained CSS/JS. |

### Python Sidecar (`engine/`)

| File | Purpose | Key Functions |
|------|---------|---|
| **engine.py** | Main loop. stdin/stdout JSON protocol. Dispatches commands to backend. | `send()`, `recv()`, command loop, event broadcast |
| **backend/audio_recorder.py** | Capture audio from microphone via portaudio. Buffer frames, handle device enumeration. | `AudioRecorder` class, `.list_devices()`, `.start()`, `.stop()`, `.get_level()` |
| **backend/transcription.py** | Call Whisper (local/OpenAI/Gemini). Streaming, error handling, language detection. | `TranscriptionService`, `.transcribe()`, model loader |
| **backend/translator.py** | Call translation API (OpenAI/Gemini). | `translate()` function |
| **backend/models.py** | Download/delete Whisper models. Shows progress. | `list_models()`, `download_model()`, `delete_model()` |
| **backend/config.py** | Paths, constants, language lists. | `AUDIO_DIR`, `LANGUAGES`, defaults |
| **backend/logger.py** | Logging to file (stderr redirected to `/~/.config/whisperclick/engine.log`). | `get()` function returns logger instance |
| **backend/tones.py** | Notification sounds (on start/stop recording). | `play_sound()` function |

### Tests (`tests/`)

| Path | Tests | Purpose |
|------|-------|---------|
| **tests/mocks/electron.js** | Mock Electron API | ~1000 lines. Mocks `BrowserWindow`, `ipcMain`, `app`, `Menu`, `Notification`. Used by all Jest tests. |
| **tests/mocks/sidecar.js** | Mock sidecar subprocess | Simulates sidecar responses for e2e tests. |
| **tests/unit/main-ipc.test.js** | ~200 IPC tests | Test every IPC handler (start-recording, save-settings, etc.). State machine transitions. Error cases. |
| **tests/unit/store.test.js** | ~80 persistence tests | JSON read/write, encryption, fallback to .bak, defaults. |
| **tests/unit/sidecar.test.js** | ~50 protocol tests | JSON parsing, event buffering, error recovery. |
| **tests/unit/preload.test.js** | ~40 translation tests | V3 ↔ Electron settings translation, API key filtering. |
| **tests/integration/recording-flow.test.js** | ~12 flow tests | Full recording → transcribe → paste flow. |
| **tests/e2e/app-startup.test.js** | ~13 startup tests | Windows open, sidecar spawns, IPC ready. |

---

## Naming Conventions

### IPC Channels (kebab-case)
Used in `ipcMain.handle()` and `ipcRenderer.invoke()`:
- `get-settings`, `save-settings`, `reset-settings`
- `start-recording`, `stop-recording`, `cancel-processing`
- `list-models`, `download-model`, `delete-model`
- `get-state`, `get-app-info`

### Preload API Methods (snake_case)
Exposed via `window.pywebview.api`:
- `get_settings()`, `save_settings(patch)`
- `start_recording()`, `stop_recording()`
- `get_models()`, `set_model(name)`
- `get_download_progress()`, `list_mics()`

### Store Fields (camelCase)
In `settings.json`:
- `localModel`, `soundEnabled`, `autoPaste`
- `autoStart`, `alwaysOnTop`, `showPill`
- `provider`, `apiModel`, `targetLanguage`

### V3 Frontend Fields (snake_case)
In `index.html` JavaScript and preload incoming values:
- `model`, `auto_copy`, `start_with_windows`
- `api_provider`, `api_model`, `output_mode`
- `show_pill_widget`, `close_behavior`

### JavaScript Functions (camelCase)
- `createMainWindow()`, `createPillWindow()`
- `startRecording()`, `stopRecording()`
- `saveSetting()`, `patchToElectron()`

### Constants (UPPER_SNAKE_CASE)
- `PILL_WIDTH`, `MAX_HISTORY`, `DEFAULT_MODEL`
- `STATES`, `TRANSITIONS` (in state-machine.js)

### Files (kebab-case or camelCase)
- `state-machine.js`, `preload-pill.js`, `main-ipc.test.js`
- `store.js`, `sidecar.js`, `updater.js`

---

## Data Persistence

### `settings.json` (in config directory)
```json
{
  "localModel": "base",
  "soundEnabled": true,
  "autoPaste": true,
  "alwaysOnTop": false,
  "showPill": true,
  "provider": "local",
  "apiModel": "gpt-4",
  "openaiApiKey": "enc:BASE64...",
  "targetLanguage": null,
  "outputMode": "normal",
  "theme": "dark",
  "... more fields"
}
```

**Note:** API keys are encrypted as `enc:BASE64...` via Electron `safeStorage` on save.

### `history.json` (in config directory)
```json
{
  "items": [
    {
      "id": "uuid-1234",
      "text": "Hello world",
      "timestamp": 1234567890,
      "language": "en",
      "duration_s": 2.5,
      "confidence": 0.95
    },
    ...
  ],
  "maxItems": 500,
  "currentSize": 42
}
```

### Config Directories

| Environment | Path |
|-----------|------|
| **Development** | `%APPDATA%/Electron/whisperclick-dev/` |
| **Beta** | `%APPDATA%/Electron/whisperclick-beta/` |
| **Stable** | `%APPDATA%/Electron/whisperclick/` |

Each directory contains:
- `settings.json` (+ `.bak`)
- `history.json` (+ `.bak`)
- (Engine creates `engine.log` here)

---

## Build Outputs

### `dist/` Directory (after `npm run dist:win`)

| File | Purpose |
|------|---------|
| `WhisperClick Setup.exe` | NSIS installer. Downloads latest Python sidecar on first run. |
| `WhisperClick-x.y.z.exe` | Portable executable. Bundled with Electron binary. |
| `latest.yml` | Auto-updater metadata (version, hash, download URL). |

**Build chain:**
1. `npm run build` — Copy frontend, pill HTML to assets
2. `npm run dist:win` — electron-builder: bundle JS, create installer, create portable
3. **CI uploads to GitHub Releases** — Auto-updater points here

---

## Communication Layers

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (V3 index.html + pill.html)                         │
│ Calls: window.pywebview.api.method() or electronAPI.method()│
└──────────────────────────┬───────────────────────────────────┘
                           │
         ┌─────────────────┴─────────────────┐
         ↓                                     ↓
   ┌─────────────┐                   ┌──────────────┐
   │ preload.js  │                   │preload-pill  │
   │ (contextBr) │                   │    .js       │
   └─────────────┘                   └──────────────┘
         ↓                                     ↓
   ipcRenderer.invoke('ipc-channel')  ipcRenderer.invoke(...)
         ↓                                     ↓
    ┌────────────────────────────────────────────────┐
    │ Main Process (main.js)                         │
    │ ipcMain.handle('ipc-channel', handler)         │
    │ Checks sm.canRecord, sm.canCancel              │
    │ Calls: store.*, sidecar.request(), Electron API│
    └────────┬──────────────────────┬────────────────┘
             ↓                      ↓
      ┌─────────────┐      ┌──────────────────┐
      │ store.js    │      │ sidecar.js       │
      │ (JSON file) │      │ (subprocess)     │
      └─────────────┘      └─────────┬────────┘
                                    ↓
                          JSON stdin/stdout
                                    ↓
                          ┌──────────────────┐
                          │ engine.py        │
                          │ (Python process) │
                          └──────────────────┘
```

---

## Version Bump Protocol

**EVERY code change bumps the version** (because auto-updater depends on new versions):

1. Edit `package.json` → `"version": "x.y.z"`
2. Run `npm test` (confirms tests still pass at new version)
3. Prepend entry to `CHANGELOG.md` (today's date, changes)
4. Commit: "Bump version to x.y.z — [feature summary]"
5. CI: GitHub Actions detects version change → builds → creates release

If version isn't bumped, auto-updater won't deliver the new code.

---

## Dev vs. Prod Environment Detection

```javascript
const isDev = !app.isPackaged;
const isBeta = app.getVersion().includes('beta');

// Config directory changes based on isDev + isBeta:
const configDir = path.join(
  app.getPath('userData'),
  isDev ? 'whisperclick-dev' : isBeta ? 'whisperclick-beta' : 'whisperclick'
);
```

**Running locally:** `npm start` → `isDev=true` → uses `whisperclick-dev/`

**Building installer:** `npm run dist:win` → `isDev=false` → uses `whisperclick/`

**Beta version:** version string contains "beta" → uses `whisperclick-beta/`

---

## Single Instance Lock

From `main.js` lines 17-21:
```javascript
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}
```

Only one WhisperClick instance can run per config directory (dev/beta/stable). Second attempt exits.

---

## Summary

**Three-layer architecture:**
1. **UI Layer** — V3 HTML (unchanged) + Pill widget, communicates via preload shim
2. **Main Process** — Electron window/IPC/hotkey/tray management, state machine gate
3. **Sidecar** — Python subprocess for audio capture & transcription

**State machine is the enforcement point** — no recording command succeeds without valid transition through `sm.canRecord` / `sm.canCancel`.

**Settings translation** happens in preload — V3 code never sees "camelCase", main process never sees "snake_case".

**One sidecar per app instance** — spawned at startup, restarts on crash, gracefully shuts down on app exit.

