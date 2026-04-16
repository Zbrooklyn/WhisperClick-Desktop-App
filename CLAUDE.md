# CLAUDE.md — WhisperClick

Golden principles for AI-assisted development. Every agent session must follow these rules.

## Quick Start

1. **Read** `HANDOFF.md` for current state, known issues, and next actions.
2. **Read** `FEATURES.md` for complete feature inventory and API method list.
3. **Run** `npm test` after every code change (412 Electron Jest tests).
4. **Run** `cd platforms/tauri && cargo test` (518 Rust tests).
5. **Run** `npm test -- --coverage` before committing to enforce thresholds.

## Architecture

```
platforms/electron/          # Electron platform (Node.js main process)
  main.js                    # Windows, IPC, sidecar, tray, hotkey
  preload.js                 # pywebview API shim (window.pywebview.api -> IPC)
  preload-pill.js            # Pill window preload (window.electronAPI)
  sidecar.js                 # Python sidecar manager (stdin/stdout JSON protocol)
  store.js                   # JSON file settings/history persistence
  updater.js                 # Auto-updater (electron-updater, stable/beta channels)
  tray.js                    # System tray icon and menu

platforms/tauri/             # Tauri platform (Rust + system WebView)
  src-tauri/                 # Rust backend (commands, sidecar bridge, tray)
  src/                       # Tauri-specific frontend wiring

shared/frontend/             # Shared V3 frontend (used by both platforms)
  index.html                 # Main UI (4800+ lines, inline JS)
  css/tailwind.css           # Pre-built Tailwind CSS
  js/lucide.min.js           # Lucide icon library

shared/pill/
  pill.html                  # Floating pill widget (self-contained)

shared/engine/
  engine.py                  # Python sidecar (recording, transcription, models)

tests/
  mocks/electron.js          # Comprehensive Electron API mock
  unit/                      # 399 Jest tests
  integration/               # 12 recording-flow tests
  e2e/                       # 13 mock-sidecar tests
```

### Key Design Decision

V3's original `index.html` (in `shared/frontend/`) is used directly by both platforms — no React rewrite. On Electron, `preload.js` acts as a compatibility shim: V3 code calls `window.pywebview.api.method(...)`, and the preload routes those to Electron IPC. On Tauri, the Rust backend exposes equivalent commands. This guarantees pixel-perfect parity with V3 on both platforms.

### Hard Boundaries

- **Renderer must NOT use `nodeIntegration`.** All renderer↔main communication goes through IPC via preload scripts. `contextIsolation: true` is mandatory.
- **Frontend communicates only through `window.pywebview.api`.** The preload shim is the only bridge. No direct `ipcRenderer` calls from frontend code.
- **Store is the single source of truth** for settings and history. No shadow state in main process globals.
- **Sidecar communication is JSON-over-stdin/stdout.** No HTTP, no sockets. One message per line.
- **V3 frontend changes must be minimal.** Only 2 lines differ from V3. Any new feature should work through the preload shim, not by modifying V3's HTML/JS.

### Process Boundaries

```
Main Process (main.js)
  ├─ IPC handlers (save-settings, start-recording, etc.)
  ├─ Sidecar manager (spawn, restart, JSON protocol)
  ├─ Tray, hotkey, window management
  └─ Store (atomic JSON file read/write)

Renderer (preload.js → index.html)
  ├─ window.pywebview.api.* → ipcRenderer.invoke()
  └─ Settings translation (snake_case ↔ camelCase)

Pill Renderer (preload-pill.js → pill.html)
  └─ window.electronAPI.* → ipcRenderer.invoke()

Python Sidecar (engine.py)
  └─ stdin/stdout JSON: configure, start_rec, stop_rec, cancel, list_models, etc.
```

### Settings Translation

V3 uses `snake_case`; Electron store uses `camelCase`. The preload translates automatically:

| V3 (frontend)       | Electron (store)  |
|----------------------|-------------------|
| `auto_copy`          | `autoPaste`       |
| `start_with_windows` | `autoStart`       |
| `close_behavior`     | `closeBehavior`   |
| `sound_enabled`      | `soundEnabled`    |
| `always_on_top`      | `alwaysOnTop`     |
| `show_pill_widget`   | `showPill`        |
| `api_provider`       | `provider`        |
| `api_model`          | `apiModel`        |
| `output_mode`        | `outputMode`      |
| `model`              | `localModel`      |
| `target_language`    | `targetLanguage`  |
| `source_language`    | `sourceLanguage`  |
| `api_base_url`       | `customBaseUrl`   |
| `pill_monitor`       | `pillMonitor`     |
| `audio_retention_days` | `audioRetentionDays` |
| `auto_enter_mode`    | `autoEnterMode`     |
| `tray_click_action`  | `trayClickAction`   |
| `debug_logging`      | `debugLogging`      |

Fields not in this table (e.g., `mode`, `hotkey`, `theme`) pass through unchanged.

### IPC Pattern

Every frontend API call follows this chain:

```
V3 JS: callNativeApi('method', ...args)
  → window.pywebview.api.method(...args)
  → preload.js: ipcRenderer.invoke('ipc-channel', translatedArgs)
  → main.js: ipcMain.handle('ipc-channel', handler)
  → store / sidecar / Electron API
```

**Settings saves must merge, never replace:**
```js
// CORRECT — merge patch with existing
const prev = store.getSettings();
const settings = { ...prev, ...patch };
store.saveSettings(settings);

// WRONG — overwrites all settings
store.saveSettings(patch);
```

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| IPC channels | `kebab-case` | `save-settings`, `start-recording` |
| Preload API methods | `snake_case` | `get_settings()`, `set_api_key()` |
| Store fields | `camelCase` | `localModel`, `soundEnabled` |
| V3 frontend fields | `snake_case` | `auto_copy`, `api_provider` |
| JS functions | `camelCase` | `createMainWindow()`, `configureSidecar()` |
| Constants | `UPPER_SNAKE_CASE` | `PILL_WIDTH`, `MAX_HISTORY` |
| Files | `kebab-case` or `camelCase` | `preload-pill.js`, `store.js` |

## Error Handling

- **IPC handlers** return `{ success: true }` or `{ success: false, error: message }`. Never throw into the renderer.
- **Sidecar proxy handlers** (list-models, download-model, etc.) check `if (!sidecar || !sidecar.isRunning)` and return `{ error: 'Sidecar not running' }`.
- **Preload methods** catch errors and return safe defaults (empty arrays, `{ success: false }`). The V3 frontend expects this pattern.
- **Store reads** fall back to `.bak` file, then to defaults. Never throw on corrupt data.

## Forbidden Patterns

These must never appear in new code:

| Pattern | Reason |
|---------|--------|
| `nodeIntegration: true` | Security violation — enables full Node.js in renderer |
| `contextIsolation: false` | Security violation — exposes main process to renderer |
| Direct `require('electron')` in renderer | Must go through preload's `contextBridge` |
| `store.saveSettings(patch)` without merge | Wipes all existing settings — always merge with `getSettings()` first |
| `ipcRenderer.send()` for request/response | Use `ipcRenderer.invoke()` for bidirectional IPC |
| Modifying V3 `index.html` JS logic | Route through preload shim instead; keep V3 frontend portable |
| `pythonw.exe` for sidecar | Silently crashes with Qt/PySide6 |
| `--no-verify` on git commits | Never skip pre-commit hooks |
| Hardcoded config paths | Use `app.getPath('userData')` + `isDev` toggle |
| `app.quit()` without cleanup | Must set `isQuitting`, close windows, stop sidecar first |

## Testing

- **Electron suite:** `npm test` (412 Jest tests)
- **Unit only:** `npm run test:unit`
- **Integration:** `npm run test:integration`
- **E2E:** `npm run test:e2e` (spawns mock sidecar)
- **Coverage:** `npm test -- --coverage` (enforces 85% statements, 60% branches)
- **Tauri suite:** `cd platforms/tauri && cargo test` (518 Rust tests)
- After every code change, run both test suites and confirm no regressions.

### Coverage Thresholds (enforced)

| Scope | Statements | Branches |
|-------|-----------|----------|
| Global | 85% | 60% |
| `store.js` | 100% | 100% |
| `sidecar.js` | 100% | — |
| `preload.js` | 100% | — |

### Adding Tests

1. New IPC handlers → `tests/unit/main-ipc.test.js`, call via `ipcMain._invoke('channel', args)`
2. Sidecar events → `pushSidecarEvent(proc, 'event-name', data)` + `await tick(50)`
3. Sidecar command responses → `autoRespondSidecar(proc, { command: { result: 'ok' } })`
4. Order matters: sidecar-killing tests must stay at end of `main-ipc.test.js`

## Tooling

- **Runtime:** Electron (Node.js main + Chromium renderer)
- **Test runner:** Jest with custom Electron mock (`tests/mocks/electron.js`)
- **Build:** electron-builder (`npm run dist:win`, `dist:mac`, `dist:linux`)
- **Sidecar:** Python 3.12 (`shared/engine/engine.py`) — spawned as child process
- **No bundler:** V3 frontend loaded directly, no Vite/webpack build step

## Key Flows

### Recording Flow
1. V3 frontend calls `start_recording()` → preload → IPC → sidecar `start_rec`
2. V3 frontend calls `stop_recording()` → preload → IPC → sidecar `stop_rec`
3. `stop-recording` handler blocks, waiting for sidecar `transcription` event (120s timeout)
4. Sidecar `transcription` event → main.js adds history entry + auto-pastes
5. `stop-recording` resolves → frontend updates history UI

### Hotkey Flow
Global hotkey → `executeJavaScript('triggerTrustedHotkeyToggle()')` →
V3 frontend handles validation, mode checks, API key checks → calls
`start_recording()` or `stop_recording()`.

### Settings Save Flow
Frontend `save_settings(patch)` → preload `patchToElectron()` →
IPC `save-settings` → `{ ...prev, ...patch }` → `store.saveSettings()` →
atomic write (`.tmp` → rename) + encrypt API keys via `safeStorage`.

## Config Paths

| Environment | Config Directory |
|-------------|-----------------|
| Dev (`!app.isPackaged`) | `AppData/Roaming/Electron/whisperclick-dev/` |
| Beta (version contains "beta") | `AppData/Roaming/Electron/whisperclick-beta/` |
| Stable (production) | `AppData/Roaming/Electron/whisperclick/` |

Files: `settings.json`, `settings.json.bak`, `history.json`, `history.json.bak`

API keys in `settings.json` are encrypted as `enc:BASE64...` via Electron `safeStorage`.
Legacy plaintext keys auto-migrate on next save.

## Public/Private Repo Sync — CRITICAL
- **NEVER push directly to the `public` remote** — leaks private files (CLAUDE.md, HANDOFF.md, ROADMAP.md, etc.)
- Private: `origin` → `Zbrooklyn/whisperclick-dev` (has everything)
- Public: `public` → `Zbrooklyn/WhisperClick-Desktop-App` (stripped)
- **ALL branches must track `origin`** (private), NEVER `public`. Verify: `git branch -vv`
- **Push = `git push origin <branch>`** — always explicit remote, always `origin`
- After pushing to origin main: `bash tools/sync_public.sh`
- Sync script strips: CLAUDE.md, HANDOFF.md, ROADMAP.md, FEATURES.md, TESTING.md, VERIFICATION.md, tools/

## Version Bumps — MANDATORY
- Always bump version in `package.json` + add CHANGELOG entry with every code change
- Auto-updater needs new versions to deliver updates — without a bump, users never get the update

## Known Gaps

(None currently tracked)

## Files to Keep Updated

| File | Purpose | When to update |
|------|---------|----------------|
| `HANDOFF.md` | Current project state | After completing features or finding issues |
| `FEATURES.md` | Complete feature inventory | After adding/removing features |
| `CHANGELOG.md` | Version history and gap tracking | After each release or major change |
| `VERIFICATION.md` | Manual test checklist | After adding testable features |
| `TESTING.md` | Test architecture and coverage | After adding test files or changing patterns |
| `CLAUDE.md` | This file — conventions and rules | When conventions change |
