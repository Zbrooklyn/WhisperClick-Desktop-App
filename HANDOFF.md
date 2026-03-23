# HANDOFF — WhisperClick

> Last updated: 2026-03-23

## Current State

**Status**: Stable — v2.1.1 (Electron) | Tauri migration complete

**Latest stable release**: v2.1.1
**Latest beta release**: v2.0.22-beta (superseded by v2.1.0 stable)

The repo now supports **two platforms**: Electron and Tauri. Both share the same
frontend (`shared/frontend/`), pill widget (`shared/pill/`), and Python sidecar
(`shared/engine/`). The Electron platform uses a pywebview API compatibility shim
in `preload.js` that translates all `window.pywebview.api` calls to Electron IPC.
The Tauri platform uses Rust commands to bridge the same frontend API.

### What Works

- V3 frontend loads and renders correctly in Electron
- Title bar drag (via `-webkit-app-region: drag` CSS)
- Window controls (minimize, maximize, close)
- Settings drawer (opens/closes, persists settings)
- Theme switching (dark/light)
- Pill widget (dormant/recording/processing/success/error states, native context menu, drag)
- Pill tooltip shows error messages (API key missing, sidecar down, timeout, crash)
- Pill cancel button immediately resets state to dormant
- Pill context menu includes History shortcut
- Hotkey registration (normalized V3 → Electron format)
- Pre-validation: checks sidecar + API keys before routing to V3
- Tray icon with context menu (rich menu with microphone, mode, recent transcriptions)
- Single-instance lock
- Close-to-tray behavior
- Python sidecar launches and connects (stdin/stdout JSON protocol)
- Sidecar auto-restarts on crash (max 3 attempts, backoff delay)
- Monitor/display enumeration (`get-displays` IPC handler)
- Move pill to display (`move-pill-to-display` IPC handler)
- All 34 preload API methods have matching IPC handlers
- API keys encrypted at rest via Electron `safeStorage` (auto-migrates plaintext)
- Crash-safe atomic writes for settings and history (`.tmp` + `.bak` pattern)
- History capped at 500 entries (prevents unbounded growth)
- Auto-updater with beta/stable channel support
- Silent update install (no NSIS wizard on update)
- Configurable auto-download updates
- Release notes shown in update UI
- Update UI shows immediate feedback with checking spinner and "Checked just now"
- CI/CD: GitHub Actions builds Windows/macOS/Linux, creates pre-release

### What Needs Live Testing (requires mic + API key or local model)

- Recording flow (start → stop → transcription → history)
- Audio playback from history
- Auto-paste after transcription
- Visualizer animation during recording

## Architecture

```
platforms/electron/          — Electron main process (Node.js)
  main.js                    — Windows, IPC, sidecar, tray, hotkey
  preload.js                 — pywebview API shim (window.pywebview.api → IPC)
  preload-pill.js            — Pill window preload (window.electronAPI)
  sidecar.js                 — Python sidecar manager (stdin/stdout JSON protocol)
  store.js                   — JSON file settings/history persistence
  updater.js                 — Auto-updater (electron-updater, beta/stable channels)
  tray.js                    — System tray icon and menu
  logger.js                  — Debug file logger (5MB rotation, toggled via settings)

platforms/tauri/             — Tauri platform (Rust + system WebView)
  src-tauri/                 — Rust backend (commands, sidecar bridge, tray)
  src/                       — Tauri-specific frontend wiring

shared/frontend/             — V3 frontend (shared across platforms, 2 lines changed from V3)
  index.html                 — Main UI (4800+ lines, inline JS)
  css/tailwind.css           — Pre-built Tailwind CSS
  js/lucide.min.js           — Lucide icon library

shared/pill/
  pill.html                  — Floating pill widget (self-contained)

shared/engine/
  engine.py                  — Python sidecar (recording, transcription, models)
```

### Key Design Decision

Instead of rewriting V3's UI in React, we use V3's original HTML/CSS/JS directly.
The `preload.js` acts as a compatibility layer: V3 code calls
`window.pywebview.api.method(...)`, and the preload routes those to Electron IPC
handlers. This guarantees pixel-perfect visual parity with V3.

### Settings Translation

V3 uses snake_case settings names; Electron store uses camelCase. The preload
translates automatically:

| V3 (frontend)     | Electron (store)  |
|--------------------|-------------------|
| `auto_copy`        | `autoPaste`       |
| `start_with_windows` | `autoStart`    |
| `close_behavior`   | `closeBehavior`   |
| `sound_enabled`    | `soundEnabled`    |
| `always_on_top`    | `alwaysOnTop`     |
| `show_pill_widget` | `showPill`        |
| `api_provider`     | `provider`        |
| `api_model`        | `apiModel`        |
| `output_mode`      | `outputMode`      |
| `model`            | `localModel`      |
| `audio_retention_days` | `audioRetentionDays` |
| `auto_download_updates` | `autoDownloadUpdates` |
| `auto_enter_mode` | `autoEnterMode` |
| `tray_click_action` | `trayClickAction` |
| `debug_logging` | `debugLogging` |

### Recording Flow

1. V3 frontend calls `start_recording()` → preload → IPC → sidecar `start_rec`
2. V3 frontend calls `stop_recording()` → preload → IPC → sidecar `stop_rec`
3. `stop-recording` handler blocks, waiting for sidecar `transcription` event
4. Sidecar `transcription` event → main.js adds history + auto-pastes
5. `stop-recording` resolves → frontend calls `hydrateHistoryFromBackend()`

### Hotkey Flow

Global hotkey → `validateRecordingReadiness()` pre-check → if OK,
`executeJavaScript('triggerTrustedHotkeyToggle()')` → V3 frontend handles
validation, mode checks → calls `start_recording()` or `stop_recording()`.
If pre-check fails, `broadcastError(message)` shows error on pill tooltip.

## Files Changed from V3

Only 2 changes to the V3 frontend:

1. **`index.html` inline `<style>`**: Added `-webkit-app-region: drag` CSS for
   Electron title bar drag (replaces V3's WndProc approach)
2. **`index.html` inline `<script>`**: Replaced `initTitleBarDrag` IIFE with a
   comment (drag handled by CSS)

## CI/CD

- **Workflow**: `.github/workflows/build.yml`
- **Trigger**: Push to `main` branch
- **Builds**: Windows (NSIS + portable), macOS (DMG, arm64), Linux (AppImage)
- **Release**: Auto-creates GitHub pre-release with all artifacts
- **Update manifest**: `latest.yml` (used by electron-updater with `allowPrerelease`)
- `generateUpdatesFilesForAllChannels` is set in `package.json` build config

## Known Issues

- 3 cross-platform test failures on Linux CI (`continue-on-error: true` as workaround)
- No code signing for Windows/macOS (SmartScreen/Gatekeeper warnings on install)
- Recording flow, audio playback, auto-paste, and visualizer need live testing with mic + API key
- No free tier enforcement (no usage tracking, no feature gating) — see `docs/dev/free-version-edge-case-audit.md`

## Next Steps

1. **State machine refactor** — 5-phase refactor to eliminate recurring state bugs.
   Design doc: `docs/dev/state-machine-refactor.md`. Branch: `feature/state-machine`.
   - Phase 1: Extract state machine module (`electron/state-machine.js`) ← IN PROGRESS
   - Phase 2: Single input gate (replace 5 debounce layers)
   - Phase 3: Pill as dumb terminal (zero local state)
   - Phase 4: Frontend state simplification (remove isRecording/isProcessing)
   - Phase 5: Event-driven transitions (replace timer-based)
2. Fix 3 cross-platform test failures (Linux CI, `continue-on-error: true`)
3. Code signing for Windows/macOS (removes SmartScreen/Gatekeeper warnings)
4. Live streaming runtime (partial transcription during recording)
5. Address edge cases from free version audit (max recording length, orphaned audio cleanup, min recording guard)
6. Create GitHub Organization (e.g., `WhisperClickApp`) and transfer public repo to it — auto-redirects all URLs. Do this when ready to go official, not before.
7. See ROADMAP.md for full feature backlog

## Completed

- Full Electron port of V3 frontend with pywebview API shim
- 34 IPC handlers matching all preload API methods
- Python sidecar with auto-restart and JSON protocol
- API key encryption via Electron safeStorage
- Crash-safe atomic writes for settings and history
- Auto-updater with beta/stable channel support
- CI/CD: GitHub Actions builds Windows/macOS/Linux
- 412 Electron Jest tests + 518 Tauri Rust tests with coverage thresholds
- v2.0.0 stable release published
- Pill click-through fix — transparent areas pass clicks to apps behind (v2.0.6-beta)
- Recording state machine race conditions fixed — listener ordering, cancel idempotency (v2.0.7-beta)
- Pill state reconciliation — 5s poll self-corrects missed broadcasts (v2.0.7-beta)
- Hotkey debounce in main process — 300ms guard prevents double-fires (v2.0.7-beta)
- Store in-memory caching — eliminates 15-70ms sync disk reads on every getSettings/getHistory call (v2.0.10-beta)
- Audio level IPC throttle — capped at 20fps, reduces event loop flooding during recording (v2.0.10-beta)
- Debug file logger — 25 instrumentation points across main.js, 5MB rotation, runtime toggle in settings (v2.0.12-beta)
- Update UI polish — spinners, install lock, cleaner copy (v2.0.13-beta)
- Installer quit fix — close-to-tray was blocking app.quit() during updates, leaving files locked (v2.0.14-beta)
- v2.1.0: Auto-Enter feature (3 modes: Off, Button, Auto) with pill widget integration
- v2.1.0: Pill widget stability fixes (isDestroyed guards, repositioning, show:false)
- v2.1.0: Phantom clock fix (broadcastState on show/restore, dormant handler always clears timer)
- v2.1.0: EPIPE crash suppression, tooltip force-hide, og:url fix
- v2.1.0: Getting Started guide, FAQ, website support section, marketing content
- v2.1.1: Fix "already recording" when appState stuck on success
