# HANDOFF — WhisperClick Electron

> Last updated: 2026-02-28

## Current State

**Status**: Production-hardened — all known port gaps resolved, ready for live testing.

The Electron port uses V3's original `index.html`/`tailwind.css`/`lucide.min.js`
frontend directly, with a pywebview API compatibility shim in `preload.js` that
translates all `window.pywebview.api` calls to Electron IPC.

### What Works

- V3 frontend loads and renders correctly in Electron
- Title bar drag (via `-webkit-app-region: drag` CSS)
- Window controls (minimize, maximize, close)
- Settings drawer (opens/closes, persists settings)
- Theme switching (dark/light)
- Pill widget (dormant/recording/processing states, native context menu, drag)
- Pill tooltip visible above capsule (bottom-anchored in 220x140 window)
- Pill cancel button discards audio (sends `cancel` to sidecar, not `stop_rec`)
- Pill right-click shows native OS context menu (not clipped HTML)
- Hotkey registration (normalized V3 → Electron format)
- Tray icon with context menu
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

### What Needs Live Testing (requires mic + API key or local model)

- Recording flow (start → stop → transcription → history)
- Audio playback from history
- Auto-paste after transcription
- Visualizer animation during recording

### Known Gaps

- Auto-updater not yet integrated (electron-updater dep installed)

## Architecture

```
electron/
  main.js          — Main process: windows, IPC, sidecar, tray, hotkey
  preload.js       — pywebview API shim (window.pywebview.api → IPC)
  preload-pill.js  — Pill window preload (window.electronAPI)
  sidecar.js       — Python sidecar manager (stdin/stdout JSON protocol)
  store.js         — JSON file settings/history persistence
  tray.js          — System tray icon and menu

src/frontend/      — V3 frontend (copied verbatim, 2 lines changed)
  index.html       — Main UI (4350+ lines, inline JS)
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

### Recording Flow

1. V3 frontend calls `start_recording()` → preload → IPC → sidecar `start_rec`
2. V3 frontend calls `stop_recording()` → preload → IPC → sidecar `stop_rec`
3. `stop-recording` handler blocks, waiting for sidecar `transcription` event
4. Sidecar `transcription` event → main.js adds history + auto-pastes
5. `stop-recording` resolves → frontend calls `hydrateHistoryFromBackend()`

### Hotkey Flow

Global hotkey → `executeJavaScript('triggerTrustedHotkeyToggle()')` →
V3 frontend handles validation, mode checks, API key checks → calls
`start_recording()` or `stop_recording()`.

## Files Changed from V3

Only 2 changes to the V3 frontend:

1. **`index.html` inline `<style>`**: Added `-webkit-app-region: drag` CSS for
   Electron title bar drag (replaces V3's WndProc approach)
2. **`index.html` inline `<script>`**: Replaced `initTitleBarDrag` IIFE with a
   comment (drag handled by CSS)

## Completed Cleanup

- Deleted abandoned React files (`src/App.jsx`, `src/main.jsx`, `src/index.css`, `src/components/*.jsx`)
- Deleted unused build configs (`index.html`, `vite.config.js`, `postcss.config.js`)
- Removed `react`, `react-dom`, `lucide-react` from `package.json` dependencies
- Removed `@vitejs/plugin-react`, `vite` from devDependencies
- Installed missing Python deps (`faster-whisper`, `huggingface_hub`)
- Added `get-displays` and `move-pill-to-display` IPC handlers

## Next Steps

1. Live-test full recording/transcription flow with mic + API key
2. Test electron-builder packaging (`npm run dist:win`)
3. Integrate auto-updater (electron-updater)
