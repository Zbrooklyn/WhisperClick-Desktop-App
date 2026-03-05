# HANDOFF — WhisperClick Electron

> Last updated: 2026-03-05

## Current State

**Status**: Production — stable release, auto-updater functional.

**Latest release**: v2.0.0 (GitHub release)

The Electron port uses V3's original `index.html`/`tailwind.css`/`lucide.min.js`
frontend directly, with a pywebview API compatibility shim in `preload.js` that
translates all `window.pywebview.api` calls to Electron IPC.

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
electron/
  main.js          — Main process: windows, IPC, sidecar, tray, hotkey
  preload.js       — pywebview API shim (window.pywebview.api → IPC)
  preload-pill.js  — Pill window preload (window.electronAPI)
  sidecar.js       — Python sidecar manager (stdin/stdout JSON protocol)
  store.js         — JSON file settings/history persistence
  updater.js       — Auto-updater (electron-updater, beta/stable channels)
  tray.js          — System tray icon and menu

src/frontend/      — V3 frontend (copied verbatim, 2 lines changed)
  index.html       — Main UI (4800+ lines, inline JS)
  css/tailwind.css — Pre-built Tailwind CSS
  js/lucide.min.js — Lucide icon library

src/pill/
  pill.html        — Floating pill widget (self-contained)

engine/
  engine.py        — Python sidecar (recording, transcription, models)
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

## Next Steps

1. Fix 3 cross-platform test failures (Linux CI, `continue-on-error: true`)
2. Code signing for Windows/macOS (removes SmartScreen/Gatekeeper warnings)
3. Live streaming runtime (partial transcription during recording)
4. See ROADMAP.md for full feature backlog
