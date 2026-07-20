# WhisperClick Electron — Project Writeup

## Overview

**WhisperClick** is a desktop voice-to-text application that lets users record speech and get instant transcriptions via a global hotkey, system tray icon, or floating pill widget. It supports both cloud APIs (OpenAI, Gemini) and local models (faster-whisper) for transcription, with features like auto-paste, translation, and audio playback.

**WhisperClick Electron** is the active version of the product — an Electron port of the original pywebview-based V3 app. It runs on Windows, macOS, and Linux.

- **Author**: Edward Shamosh
- **Repository (private)**: `Zbrooklyn/whisperclick-dev`
- **Repository (public)**: `Zbrooklyn/WhisperClick-Desktop-App`
- **Current version**: v2.0.13-beta
- **Latest stable release**: v2.0.5
- **Development period**: March 1–12, 2026 (58 commits over 12 days)

---

## What It Does

WhisperClick sits in the system tray and provides three ways to record:

1. **Global hotkey** (default `Ctrl+Alt+R`) — works from any application
2. **System tray click** — configurable: either opens the window or toggles recording directly
3. **Floating pill widget** — small always-on-top capsule that shows recording state

When recording stops, the audio is sent to a transcription provider. The resulting text is automatically copied to the clipboard and pasted into whatever app the user was in before recording. Transcription history is stored locally with audio playback support.

### Key Capabilities

- **Cloud transcription**: OpenAI (whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe) and Gemini (2.5 Flash, 2.5 Pro, 3 Flash/Pro Preview)
- **Local transcription**: faster-whisper models (tiny through large-v3), runs fully offline
- **Translation mode**: Transcribe in one language, output in another
- **Auto-paste**: Transcription automatically typed into the user's active application
- **8 visualizer styles** with 3 motion presets and 4 density levels
- **Dark/light theme** with custom accent colors
- **Encrypted API key storage** via Electron safeStorage (DPAPI on Windows)
- **Auto-updater** with beta/stable channels, release notes, and silent installs

---

## Architecture

### Design Philosophy

Instead of rewriting the V3 frontend in React, the Electron version loads V3's original `index.html` (4,900+ lines of inline HTML/CSS/JS) directly. A preload script acts as a compatibility shim — V3 code calls `window.pywebview.api.method(...)`, and the shim routes those to Electron IPC handlers. This guarantees pixel-perfect visual parity with V3 and means only 2 lines of the original frontend were changed.

### Component Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    Main Process (main.js)                │
│                                                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌────────┐  │
│  │ IPC      │  │ Sidecar   │  │ Store    │  │ Tray   │  │
│  │ Handlers │  │ Manager   │  │ (JSON)   │  │ Menu   │  │
│  │ (34)     │  │ (stdin/   │  │ Atomic   │  │ Rich   │  │
│  │          │  │  stdout)  │  │ Writes   │  │ Context│  │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └───┬────┘  │
│       │              │             │             │        │
│  ┌────┴──────────────┴─────────────┴─────────────┴────┐  │
│  │              State Machine                         │  │
│  │    dormant → recording → processing → success      │  │
│  │                                    → error         │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │ Updater  │  │ Logger   │  │ Hotkey   │  │ Window  │  │
│  │ (e-u)    │  │ (file)   │  │ (global) │  │ Mgmt    │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└──────────────────────────────────────────────────────────┘
         │                    │
    ┌────┴─────┐        ┌────┴──────┐
    │ Renderer │        │ Pill      │
    │ Window   │        │ Window    │
    │          │        │           │
    │ preload  │        │ preload   │
    │ .js      │        │ -pill.js  │
    │  ↓       │        │  ↓        │
    │ V3       │        │ pill.html │
    │ index    │        │ (floating │
    │ .html    │        │  capsule) │
    └──────────┘        └───────────┘
         │
    ┌────┴──────────────────┐
    │ Python Sidecar        │
    │ (engine.py)           │
    │                       │
    │ - Audio recording     │
    │ - Transcription       │
    │ - Model management    │
    │ - API key verification│
    │ - Mic enumeration     │
    │ - Auto-paste (Win32)  │
    └───────────────────────┘
```

### File Structure

```
electron/
  main.js           1,117 lines  Main process: windows, IPC, sidecar, tray, hotkey
  preload.js          322 lines  pywebview API shim (window.pywebview.api → IPC)
  preload-pill.js      21 lines  Pill window preload (window.electronAPI)
  sidecar.js          131 lines  Python sidecar manager (stdin/stdout JSON)
  store.js            185 lines  JSON file persistence with encryption
  tray.js             297 lines  System tray icon and context menu
  updater.js          167 lines  Auto-updater (electron-updater)
  logger.js           109 lines  Debug file logger (5MB rotation)

src/frontend/
  index.html        4,903 lines  V3 frontend (inline JS, minimal changes)
  css/tailwind.css              Pre-built Tailwind CSS
  js/lucide.min.js              Lucide icon library

src/pill/
  pill.html           393 lines  Floating pill widget (self-contained)

engine/
  engine.py           591 lines  Python sidecar (recording, transcription, models)

tests/                          412 tests total
  unit/               7 files   324 unit tests (store, preload, sidecar, tray, updater, main-ipc, logger)
  integration/        1 file    Recording flow tests
  e2e/                1 file    Mock sidecar end-to-end tests
  stress/             1 file    Stress tests
  mocks/              1 file    Comprehensive Electron API mock

Total codebase:     ~8,200 lines of application code
```

### Process Communication

```
V3 Frontend JS
  → callNativeApi('method', ...args)
  → window.pywebview.api.method(...args)        [preload.js shim]
  → ipcRenderer.invoke('ipc-channel', args)     [Electron IPC]
  → ipcMain.handle('ipc-channel', handler)      [main.js]
  → store / sidecar / Electron API
```

The sidecar communicates via JSON-over-stdin/stdout — one JSON message per line, no HTTP or sockets. Commands are sent as `{"command": "start_rec", ...}` and responses/events come back as `{"event": "transcription", "data": {...}}`.

### Settings Translation Layer

V3 uses `snake_case` field names; the Electron store uses `camelCase`. The preload translates automatically in both directions:

| V3 (frontend)          | Electron (store)     |
|------------------------|----------------------|
| `auto_copy`            | `autoPaste`          |
| `start_with_windows`   | `autoStart`          |
| `close_behavior`       | `closeBehavior`      |
| `sound_enabled`        | `soundEnabled`       |
| `always_on_top`        | `alwaysOnTop`        |
| `show_pill_widget`     | `showPill`           |
| `api_provider`         | `provider`           |
| `api_model`            | `apiModel`           |
| `output_mode`          | `outputMode`         |
| `model`                | `localModel`         |
| `target_language`      | `targetLanguage`     |
| `source_language`      | `sourceLanguage`     |
| `api_base_url`         | `customBaseUrl`      |
| `pill_monitor`         | `pillMonitor`        |
| `audio_retention_days` | `audioRetentionDays` |
| `tray_click_action`    | `trayClickAction`    |
| `debug_logging`        | `debugLogging`       |

---

## Security Model

- **`contextIsolation: true`** — renderer process is sandboxed from Node.js
- **`nodeIntegration: false`** — no `require()` in renderer code
- **All IPC via `contextBridge`** — preload scripts are the only bridge
- **API keys encrypted at rest** via `safeStorage` (DPAPI on Windows, Keychain on macOS)
- **Legacy plaintext keys auto-migrate** to encrypted format on next settings save
- **Atomic writes** for settings and history (`.tmp` → rename, `.bak` fallback)
- **No external CDN dependencies** — Tailwind CSS and Lucide icons bundled locally

---

## Data Persistence

| File | Location | Purpose |
|------|----------|---------|
| `settings.json` | `%AppData%/Electron/whisperclick-{env}/` | All user preferences |
| `settings.json.bak` | Same | Crash-safe backup |
| `history.json` | Same | Transcription history (capped at 500) |
| `history.json.bak` | Same | Crash-safe backup |
| `debug.log` | Same | Diagnostic log (when enabled) |

Environment directories:
- **Dev** (`npm start`): `whisperclick-dev/`
- **Beta** (version contains "beta"): `whisperclick-beta/`
- **Stable** (production): `whisperclick/`

---

## CI/CD Pipeline

**Workflow**: `.github/workflows/build.yml`
**Trigger**: Push to `main` branch of the public repo

| Job | Platform | Output |
|-----|----------|--------|
| test | Ubuntu | 412 tests, coverage thresholds |
| build-windows | Windows | NSIS installer + portable exe |
| build-macos-x64 | macOS | DMG (Intel) |
| build-macos-arm64 | macOS | DMG (Apple Silicon) |
| build-linux | Ubuntu | AppImage |
| release | Ubuntu | GitHub pre-release with all artifacts |

**Public/private repo sync**: Development happens in the private repo (`whisperclick-dev`). A sync script (`tools/sync_public.sh`) strips private files (CLAUDE.md, HANDOFF.md, ROADMAP.md, FEATURES.md, tools/) and force-pushes to the public repo, which triggers the CI build.

**Auto-updater**: electron-updater reads `latest.yml` from GitHub releases. Supports beta/stable channels. Users can switch channels in settings. Downloads happen in the background with progress shown in the settings UI.

---

## Testing

| Suite | Tests | Runner | Coverage |
|-------|-------|--------|----------|
| Unit | 324 | Jest | 85%+ statements, 60%+ branches |
| Integration | ~12 | Jest | Recording flow scenarios |
| E2E | ~13 | Custom | Mock sidecar, full IPC chain |
| Stress | ~63 | Jest | Rapid state transitions, concurrency |
| **Total** | **412** | | |

**Coverage thresholds (enforced)**:
- Global: 85% statements, 60% branches
- `store.js`: 100% statements, 100% branches
- `sidecar.js`: 100% statements
- `preload.js`: 100% statements

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| 1.0.0 | Feb 2026 | Initial React/Vite prototype (superseded) |
| 2.0.0 | Feb 28 | V3 frontend integration, pywebview API shim, 34 IPC handlers |
| 2.0.1 | Feb 28 | Atomic writes, API key encryption, sidecar auto-restart, native pill menu |
| 2.0.5 | Mar 6 | Stable release, instant version display, premium directory structure |
| 2.0.6-beta | Mar 8 | Pill click-through fix |
| 2.0.7-beta | Mar 10 | Recording state machine race fixes, hotkey debounce, pill reconciliation |
| 2.0.10-beta | Mar 11 | Store caching (0ms reads), audio level throttle (20fps cap) |
| 2.0.11-beta | Mar 12 | Tray click recording mode, tray-native error feedback, dynamic tooltips |
| 2.0.12-beta | Mar 12 | Debug file logger (25 instrumentation points, 5MB rotation) |
| 2.0.13-beta | Mar 12 | Update UI polish (spinners, install lock, cleaner copy) |

---

## Technical Highlights

### Pywebview API Compatibility Shim
The preload script exposes `window.pywebview.api` with all 34 methods the V3 frontend expects. This means the V3 frontend runs unmodified in Electron — only 2 lines were changed (title bar drag CSS). The shim handles settings translation, API key filtering, and response format normalization.

### State Machine
Five states: `dormant → recording → processing → success/error → dormant`. All state transitions are logged (when debug logging is enabled). Race conditions in the state machine were a major source of bugs — fixed via listener ordering (register before sending commands), cancel idempotency, and hotkey debounce.

### Sidecar Protocol
The Python engine communicates via JSON-over-stdin/stdout. Commands: `configure`, `start_rec`, `stop_rec`, `cancel`, `list_models`, `download_model`, `delete_model`, `list_mics`, `set_mic`, `verify_key`, `capture_fg`, `paste`. Events: `ready`, `transcription`, `translation`, `error`, `cancelled`, `level`, `model_download_progress`, `exit`.

### Tray Click Recording Mode
Users can set the tray click action to "Toggle Recording" for a completely windowless workflow. Single-click starts/stops recording. Double-click during recording cancels without opening the window. Double-click when dormant opens the main window. Errors show as native Windows balloon notifications with tray icon flash — no main window popup.

### Debug File Logger
Writes timestamped diagnostic entries to `debug.log` in the config directory. Rotates at 5MB. 25 instrumentation points cover state transitions, IPC handlers, tray actions, sidecar lifecycle, and hotkey events. Toggleable at runtime from Settings → Advanced without restart. Built specifically to diagnose issues in the packaged exe that can't be debugged with console.log.

### Store Caching
Settings and history are cached in memory after first read. All subsequent reads return from cache (0ms) instead of hitting disk (15-70ms). Cache is updated on every write. Disk writes remain synchronous for crash safety. This eliminated UI freezes when multiple components called `getSettings()` in rapid succession.

---

## Known Issues

1. **No code signing** — Windows SmartScreen and macOS Gatekeeper show warnings on install. Requires EV certificate ($200+/yr for Windows) and Apple Developer certificate ($99/yr for macOS).

2. **3 Linux CI test failures** — Worked around with `continue-on-error: true`. Need investigation.

3. **Installer issues** — v2.0.12 and v2.0.13 NSIS installers reported as failing during install wizard. Under investigation — may be related to locked files from a running instance, or NSIS silent mode incompatibility with `oneClick: false`.

4. **Recording flow needs live testing** — Start → stop → transcription → history → auto-paste → audio playback flow requires a real microphone and API key. Not tested end-to-end in the Electron build.

5. **No free tier enforcement** — No usage tracking, no feature gating, no max recording length. Edge cases documented in `docs/dev/free-version-edge-case-audit.md`.

---

## Roadmap Summary

### Free Version (Next)
- Fix installer issues
- Code signing (Windows + macOS)
- Landing page for downloads
- Quick Actions toast (post-transcription Copy/Paste/Edit)

### Premium Version (Future)
- Custom vocabulary / proper nouns
- Speaker diarization display
- Custom post-processing prompts ("Fix grammar", "Summarize")
- Voice commands ("New line", "period", "delete that")
- Drag-and-drop audio file transcription
- Live streaming transcription
- Meeting mode (30-90 min recordings with summaries)
- App integrations (Notion, Obsidian, Google Docs)
- Pricing: estimated $8-15/month or $69-150/year, one-time $25-80

---

## Dependencies

### Runtime
| Package | Version | Purpose |
|---------|---------|---------|
| electron | ^40.6.1 | Application framework |
| electron-updater | ^6.6.2 | Auto-update mechanism |

### Dev
| Package | Version | Purpose |
|---------|---------|---------|
| electron-builder | ^26.0.12 | Packaging and distribution |
| jest | ^30.2.0 | Test runner |
| tailwindcss | ^3.4.19 | CSS framework (pre-built) |

### External
| Component | Purpose |
|-----------|---------|
| Python 3.12 | Sidecar runtime (engine.py) |
| faster-whisper | Local transcription models |
| Silero VAD | Voice activity detection |

---

## Build Commands

| Command | Purpose |
|---------|---------|
| `npm start` | Launch in dev mode |
| `npm test` | Run all 412 tests |
| `npm run dist:win` | Build Windows installer + portable |
| `npm run dist:mac` | Build macOS DMGs (Intel + ARM) |
| `npm run dist:linux` | Build Linux AppImage |

---

*Document generated 2026-03-12. Source: WhisperClick Electron v2.0.13-beta.*
