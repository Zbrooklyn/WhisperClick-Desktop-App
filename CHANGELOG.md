# Changelog

## [2.1.0] — 2026-03-17

### Feature — Auto-Enter Mode

#### Added

- **Auto-Enter setting**: Three modes (Off, Button, Auto) — after transcription pastes,
  optionally press Enter automatically or show a clickable Enter button.
- **Button mode**: Record button transforms to red Enter (↵) icon after transcription.
  Click to send. Auto-dismisses after 2–5 seconds based on recording length.
- **Auto mode**: Enter fires automatically after paste with smart delay
  (300ms + 5ms per character, max 3 seconds).
- **Pill widget Enter support**: Stop button shows ↵ icon in Auto mode.
  Button mode shows enter-ready state on the pill with click-to-send.
- **Sidecar `press_enter` command**: Simulates Enter keypress via `keybd_event`.

### Stability & Bug Fixes

#### Fixed

- **Pill widget disappearing**: Added `isDestroyed()` guards to all broadcast functions.
  Fixed settings toggle race condition. Pill now repositions to primary display center
  on every show. Added `show: false` to prevent flash on creation.
- **Phantom clock**: Timer no longer runs when reopening the app in dormant state.
  `broadcastState()` fires on window show/restore. Dormant handler always clears timer.
- **Tooltip lingering**: Force-hidden during active states (recording, processing,
  success, enter-ready) to prevent stale `:hover` tooltip display.
- **EPIPE crash dialog**: Suppressed broken pipe errors on stdout/stderr from
  auto-updater console.info calls in dev mode.
- **App state stuck on success**: Dormant transition timer was being skipped in
  button mode. Now always transitions to dormant (6s delay in button mode).
- **Double-timer prevention**: `clearInterval` before every `setInterval` call
  prevents overlapping timers from state transitions.

### Website & Documentation

#### Added

- **Getting Started guide** (`docs/GETTING-STARTED.md`): Download, setup, usage, tips.
- **FAQ & Troubleshooting** (`docs/FAQ.md`): 23 Q&As covering common issues.
- **Website support section**: 4-card grid with docs, FAQ, bug reports, source links.
- **Marketing content**: Product Hunt, Reddit, Show HN, AlternativeTo, dev.to, Twitter drafts.

#### Fixed

- **Open Graph URLs**: Updated `og:url` and `og:image` from old GitHub Pages URL to `whisperclick.com`.

## [2.0.22-beta] — 2026-03-13

### UX — Collapsible Settings Sections

#### Added

- **Collapsible settings sections**: All 8 settings sections now have toggle headers
  with animated chevrons. Click any section header to expand/collapse it.
- **Default state**: Quick Settings and Provider & API Keys open by default. All other
  sections (Language & Output, Advanced, Updates, Planned Features, Debug, Danger Zone)
  start collapsed to reduce visual clutter.
- **Smooth transitions**: Chevron rotates 90° on collapse with CSS transition.

#### Fixed

- **DOM nesting validated**: Sections with pre-existing inner wrappers (Advanced,
  Planned Features) reuse those wrappers instead of adding new ones, preventing
  the nesting breakage from the earlier attempt (2.0.20/2.0.21).

## [2.0.19-beta] — 2026-03-13

### Bugfix — Recording State Desync Across Tray/Pill/Hotkey + Tray Auto-Paste

#### Fixed

- **"Already recording" error**: Starting a recording from the tray and then clicking the
  pill to stop it would trigger "Already recording" instead of stopping. Root cause: the
  `state-update` event was never forwarded through the preload to the frontend, so the
  frontend's `isRecording` variable stayed `false` after tray-initiated recordings. The pill
  routed through the frontend which tried to start a second recording.
- **Frontend state sync**: `state-update` is now forwarded via preload → CustomEvent. The
  frontend syncs `isRecording`, the timer, and UI (listening/processing/idle) with externally-
  triggered state changes from tray, pill, or hotkey.
- **Pill direct stop**: `pill-toggle-recording` now calls `toggleRecording()` directly when
  `appState` is already `recording`, bypassing the frontend routing that caused the desync.
- **Tray auto-paste not working**: `capture_fg` (foreground window capture) was called 300ms
  after the tray click (inside the double-click delay). By then, Windows had shifted focus to
  the tray area. Now captured immediately on tray click, before the delay.

## [2.0.18-beta] — 2026-03-13

### UX — Polished Notification Ribbon

#### Changed

- **No colored borders**: Removed green/blue/red left border accents. Notifications now use
  the stone/accent palette consistently with the rest of the app.
- **6-second auto-dismiss**: Success and info toasts dismiss after 6 seconds (was 3 seconds).
- **Manual dismiss for errors**: Error toasts stay until the user clicks the X button.
  Previously all toasts auto-dismissed, including errors.
- **Slide animation**: Banners slide down from the header and slide back up on dismiss
  (bannerIn/bannerOut keyframes added to Tailwind config).

## [2.0.17-beta] — 2026-03-13

### Bugfix — Pill Widget Not Always Showing

#### Fixed

- **Pill auto-recreate**: If the pill window was destroyed (display change, crash, etc.),
  it is now automatically recreated when the main window is hidden or minimized.
  Previously, the pill would stay gone until manually toggled off and on.
- **State sync on recreation**: Recreated pill immediately receives the current app state
  so it shows the correct recording/processing/dormant UI.

## [2.0.16-beta] — 2026-03-13

### UX — Install Update Confirmation & Post-Update Notification

#### Added

- **Install confirmation modal**: Clicking "Install & Restart" now shows a confirmation
  dialog explaining the app will close and restart. Cancel or confirm before proceeding.
- **Post-update system notification**: After a successful update, a Windows notification
  shows "WhisperClick Updated — Successfully updated to vX.Y.Z". Clicking the
  notification opens the main window. Also shows an in-app toast if the window is visible.
- **Update marker**: Writes a marker file before quitting so the app detects a post-update
  launch and shows the success notification exactly once.

## [2.0.15-beta] — 2026-03-13

### Improvement — Audio Cleanup on History Delete

#### Fixed

- **Delete history now deletes audio**: Deleting a single history entry or clearing
  all history now also removes the associated `.ogg` audio files from disk. Previously
  only the JSON metadata was removed, leaving orphaned audio files.

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
