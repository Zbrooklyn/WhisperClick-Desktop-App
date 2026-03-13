# Changelog

## [2.0.14-beta] — 2026-03-12

### Bugfix — Installer Fails When App Is Running

#### Fixed

- **Close-to-tray blocking quit during updates**: When `closeBehavior` was set to
  "tray", `app.quit()` (called by `quitAndInstall()`) would trigger the window close
  handler, which intercepted it and hid the window instead of closing it. The app never
  fully exited, leaving files locked, causing the NSIS installer to fail silently.
- **Added `before-quit` handler**: Sets `isQuitting = true` before Electron tries to
  close windows, so the close-to-tray handler allows the close to proceed during
  quit/update flows.
- This fixes both the auto-update install path and explains manual installer failures
  when WhisperClick was still running in the system tray.

## [2.0.13-beta] — 2026-03-12

### UX — Update Install Feedback

#### Fixed

- **"Restart & Install" button** now shows a spinner and "Installing — app will restart…"
  immediately on click, with the button disabled to prevent double-clicks. Previously
  there was no feedback during the few seconds NSIS takes to extract and relaunch.

## [2.0.12-beta] — 2026-03-12

### Feature — Debug File Logger

#### Added

- **Debug logging** (`debugLogging`): New toggle in Settings → Advanced enables
  diagnostic file logging to `debug.log` in the app's config directory. Captures
  state transitions, IPC calls, tray actions, sidecar events, and errors.
- **Log rotation**: Automatically rotates at 5MB (renames to `debug.log.1`).
- **25 instrumentation points** across `main.js`: state machine transitions, hotkey
  fires/debounces, tray toggle/cancel, all recording IPC handlers, sidecar lifecycle
  (ready/exit/restart/error), and settings saves.
- **Runtime toggle**: Enable/disable logging from settings without restarting the app.
- **13 unit tests** for the logger module (write, rotate, toggle, all log levels).

## [2.0.11-beta] — 2026-03-12

### Feature — Tray Click Recording Mode

#### Added

- **Tray click action setting** (`trayClickAction`): New dropdown in Quick Settings
  lets users choose between "Open Window" (default) and "Toggle Recording". In record
  mode, single-click the tray icon to start/stop recording with zero UI footprint.
- **Double-click behavior**: In record mode, double-click opens the main window when
  dormant, or cancels an active recording without opening the window.
- **Tray-native error feedback**: When recording can't start (no API key, sidecar down),
  shows a native Windows balloon notification and flashes the tray icon red for 2 seconds
  instead of popping up the main window. Clicking the balloon opens settings.
- **Dynamic tray tooltips**: Tooltip updates to reflect current state ("Recording...",
  "Processing...") for at-a-glance status.

#### Fixed

- **Settings drawer persists after window hide/show**: Closing the window with settings
  open and reopening it no longer shows stale settings drawer — resets to main view.

## [2.0.10-beta] — 2026-03-11

### Performance — Store Caching & Level Throttle

#### Fixed

- **Store reads blocked event loop on every call** (`store.js`): Added in-memory
  cache for settings and history. `getSettings()` and `getHistory()` now return
  from cache (0ms) instead of hitting disk (15-70ms per call). Cache is lazy-loaded
  on first access and updated on every mutation. Disk writes still happen
  synchronously for crash safety, but reads are instant. This eliminates the
  primary cause of UI freezing when the settings drawer, tray menu, pill visibility
  checks, and recording handlers all call `getSettings()` in rapid succession.

- **Audio level IPC spam during recording** (`main.js`): `broadcastLevel()` now
  throttled to 20fps (50ms interval). The sidecar fires level events as fast as
  the audio stream produces them (~100-200/sec). Each event triggered two IPC sends
  (main window + pill), flooding the event loop. 20fps is still visually smooth for
  the visualizer animation.

## [2.0.7-beta] — 2026-03-10

### Recording State Machine Fixes

#### Fixed

- **Stop-recording listener race condition** (`main.js`): Sidecar event listeners
  are now registered BEFORE sending `stop_rec`, preventing missed transcription
  events that caused the UI to hang for 120 seconds until timeout.

- **Cancel-after-success bug** (`main.js`): `cancel-processing` is now idempotent —
  returns early if state is already `success` or `dormant`, preventing a false
  `cancelled` event from overriding a successful transcription.

- **Pill cancel button guard** (`pill.html`): Cancel click handler now checks
  `currentState` and only fires during `recording` or `processing`, preventing
  accidental cancels when the pill is in success/error/dormant state.

- **Hotkey debounce** (`main.js`): Added 300ms debounce guard in the main process
  hotkey handler. The frontend already had its own debounce, but the main process
  `toggleRecording()` fallback path (used when main window is hidden) had none.

#### Added

- **Pill state reconciliation** (`pill.html`): Polls `get-state` every 5 seconds
  to detect and correct missed state broadcasts. Only corrects if pill is stuck
  in `recording` or `processing` while the main process has moved on. Skips
  `success`/`error` to avoid cutting short the visual feedback flash.

## [2.0.6-beta] — 2026-03-08

### Pill Click-Through Fix

#### Fixed

- **Pill invisible border blocking clicks** (`main.js`, `pill.html`): The 220x140
  pill window was capturing all mouse events even though the visible capsule is
  only 72x14. Applied Electron's `setIgnoreMouseEvents(true, { forward: true })`
  pattern so transparent areas pass clicks to apps behind the pill. Pill uses
  `mouseenter`/`mouseleave` + JS `.hovered` class (CSS `:hover` doesn't work in
  click-through mode) to re-enable interactivity when the cursor is over the
  capsule.

## [2.0.1] — 2026-02-28

### Production Hardening — 7 Port Gap Fixes

#### Added

- **Atomic writes** (`store.js`): Settings and history now write to `.tmp`,
  back up to `.bak`, then `fs.renameSync` — crash-safe on same volume. On read,
  tries primary file, falls back to `.bak`, then defaults.

- **History size cap**: `MAX_HISTORY = 500` — prevents unbounded JSON growth.
  Oldest entries truncated after each `addHistory()`.

- **API key encryption** (`store.js`): Keys encrypted at rest via Electron
  `safeStorage`. Stored as `enc:BASE64...` in `settings.json`. Legacy plaintext
  keys auto-migrate on next save. Falls back to plaintext if OS encryption
  unavailable.

- **Sidecar auto-restart** (`main.js`): On non-zero exit, sidecar restarts up
  to 3 times with increasing backoff (1s, 2s, 3s). Counter resets on successful
  `ready` event. No restart during app quit (`isQuitting` flag).

- **Native pill context menu** (`main.js` + `preload-pill.js`): Replaced
  HTML-based context menu (clipped by 80px window) with Electron `Menu.popup()`.
  Items: Start/Stop Recording (dynamic, disabled during processing), Show
  WhisperClick, Settings, Hide Pill.

#### Changed

- **Pill window dimensions** (`main.js`): Increased from 220x80 to 220x140.
  Extra 60px is transparent — invisible to the user but gives tooltip room.
  Constants `PILL_WIDTH`/`PILL_HEIGHT` used in both `createPillWindow()` and
  `move-pill-to-display`.

- **Pill capsule positioning** (`pill.html`): Bottom-anchored (`bottom: 10px`)
  instead of vertically centered. Tooltip repositioned to `bottom: 34px`
  (absolute within window bounds) so it renders above the capsule without
  clipping.

- **Pill cancel button** (`pill.html` + `preload-pill.js`): Now calls
  `cancelRecording()` (→ `cancel-processing` IPC → sidecar `cancel` command)
  instead of `toggleRecording()`. Audio is discarded, not transcribed.

#### Removed

- HTML context menu from pill (`pill.html`): `.ctx-menu` CSS, HTML div, and
  all associated JavaScript event handlers deleted. Replaced by native menu.

- Unused preload-pill methods: `showMainWindow()`, `showSettings()`,
  `hidePill()` removed from `preload-pill.js` — now handled by native menu
  click callbacks in `main.js`.

## [2.0.0] — 2026-02-28

### Architecture: V3 Frontend Direct Integration

Replaced the React/Vite rewrite approach with direct use of V3's original
`index.html`, `tailwind.css`, and `lucide.min.js` frontend files. Since
Electron is a webview, this gives pixel-perfect parity with V3's pywebview UI.

#### Added

- **pywebview API compatibility shim** (`electron/preload.js`):
  Exposes `window.pywebview.api` with all 34 methods the V3 frontend expects,
  routing each call through Electron IPC. Handles snake_case ↔ camelCase
  settings field translation automatically.

- **New IPC handlers** in `electron/main.js`:
  - `start-recording` — starts recording via sidecar, returns `{success}`
  - `stop-recording` — stops and blocks until transcription completes
  - `cancel-processing` — cancels in-flight transcription
  - `get-recording-state` — returns `{is_recording, cancel_requested}`
  - `copy-to-clipboard` — writes text to clipboard
  - `paste-last-transcript` — copies last transcript and simulates Ctrl+V
  - `get-audio` — reads audio file from disk, returns base64
  - `export-transcription` — opens save dialog and writes text to file
  - `get-displays` — returns monitor list via `screen.getAllDisplays()`
  - `move-pill-to-display` — repositions pill window to specified display

- **Pill widget** (`src/pill/pill.html`):
  Custom floating capsule with dormant/recording/processing/success/error
  states, voice bars, context menu, and drag support.

- **Project documentation**: CHANGELOG.md, HANDOFF.md

#### Changed

- **Main window loading**: Loads `src/frontend/index.html` directly instead of
  Vite-built `dist/index.html`. No build step required.

- **Hotkey routing**: Global hotkey now calls V3 frontend's
  `triggerTrustedHotkeyToggle()` via `executeJavaScript()`, so the frontend
  handles all validation, mode checks, and API key checks — same as V3.

- **Tray menu**: "Start Recording" routes through frontend. "Settings" calls
  `openSettingsDrawer()` instead of sending a `navigate` IPC event.

- **Settings save**: Now merges patches (`{ ...prev, ...patch }`) instead of
  replacing the entire settings object. Prevents data loss from partial updates.

- **Hotkey format**: `registerHotkey()` normalizes V3 format ("Ctrl + Alt + R")
  to Electron format ("Ctrl+Alt+R") automatically.

- **Title bar drag**: Replaced V3's WndProc-based drag with Electron's
  `-webkit-app-region: drag` CSS. Double-click maximize works natively.

- **Package scripts**: Removed Vite build step from all npm scripts. Build files
  now include `src/frontend/**` instead of `dist/**`.

- **Tray icon**: Replaced broken SVG-in-buffer approach with programmatic PNG
  generation (CRC32 + zlib). Renders anti-aliased colored circle per state.

- **FEATURES.md**: Added comprehensive feature inventory (13 categories,
  34 API methods, 8 visualizer styles, all settings documented).

#### Removed

- React frontend files (`src/App.jsx`, `src/components/*.jsx`, `src/main.jsx`,
  `src/index.css`) — superseded by V3's original HTML/CSS/JS frontend.
- Unused build configs (`index.html`, `vite.config.js`, `postcss.config.js`).
- Dependencies: `react`, `react-dom`, `lucide-react` from dependencies;
  `@vitejs/plugin-react`, `vite` from devDependencies.

- **11 orphaned IPC handlers** removed from `electron/main.js` — none were
  called by any preload file (`preload.js` or `preload-pill.js`):

  | Handler | Why Removed |
  |---------|-------------|
  | `reset-settings` | V3 frontend never calls reset; no preload method for it |
  | `add-history` | History entries added internally by the `transcription` event handler in main.js, never from renderer |
  | `update-history` | History entries updated internally by the `translation` event handler in main.js, never from renderer |
  | `set-state` | App state managed internally by main.js; renderers read state via `get-state` but never set it directly |
  | `toggle-recording` | Superseded by the `start-recording` / `stop-recording` pair that the V3 frontend uses; internal `toggleRecording()` function kept |
  | `sidecar-send` | Generic passthrough to sidecar; all renderer calls use specific handlers (`list-models`, `download-model`, `list-mics`, etc.) instead |
  | `sidecar-status` | Sidecar health never queried from renderer; errors surface via `sidecar-error` push event |
  | `restart-sidecar` | Never exposed in preload; no UI element triggers a sidecar restart |
  | `set-api-credentials` | Credentials pushed to sidecar via `configureSidecar()` on settings change; direct credential push from renderer unused |
  | `get-recording-state` | Preload's `get_recording_state()` uses `get-state` handler and maps the result; this duplicate was never called |
  | `is-pill-visible` | Pill visibility tracked by settings (`showPill`); never queried as a separate IPC call from renderer |

## [1.0.0] — Initial React/Vite prototype (superseded)

Initial Electron port using React components. Not visually complete.
