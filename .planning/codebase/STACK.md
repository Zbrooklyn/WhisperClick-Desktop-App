# WhisperClick Electron — Technology Stack

## Runtime Versions

| Component | Version |
|-----------|---------|
| **Node.js** | 22.21.1 |
| **Electron** | 40.6.1 |
| **Python** | 3.12.10 |
| **npm** | (bundled with Node.js) |

## Languages & Frameworks

| Layer | Language | Technology |
|-------|----------|-----------|
| **Main Process** | JavaScript (CJS) | Node.js + Electron APIs |
| **Renderer Process** | HTML + inline JavaScript | V3 frontend (no framework) |
| **Pill Widget** | HTML + inline JavaScript | Self-contained floating window |
| **Sidecar (Backend)** | Python 3.12 | Child process (stdio JSON protocol) |
| **Styling** | CSS | Tailwind CSS (pre-built) |
| **Icons** | SVG/CSS** | Lucide Icons (lucide.min.js) |

## Core Dependencies

### Production Runtime (`package.json`)

| Package | Version | Purpose |
|---------|---------|---------|
| `electron-updater` | ^6.6.2 | Auto-updater (GitHub releases, stable/beta channels) |

### Development Dependencies (`package.json`)

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^40.6.1 | Electron framework (main + renderer) |
| `electron-builder` | ^26.0.12 | Build tool (NSIS installer, portable exe, DMG, AppImage) |
| `jest` | ^30.2.0 | Unit & integration test runner |
| `autoprefixer` | ^10.4.20 | PostCSS vendor prefixing |
| `postcss` | ^8.5.3 | CSS processing pipeline |
| `tailwindcss` | ^3.4.19 | CSS framework (build-time, pre-built included) |

### Python Sidecar (`engine/requirements.txt`)

| Package | Purpose |
|---------|---------|
| `numpy` | Numerical computing (audio processing) |
| `sounddevice` | Audio device enumeration & recording |
| `soundfile` | WAV/audio file I/O |
| `openai` | OpenAI API client (Whisper API) |
| `faster-whisper` | Local Whisper model (via CTransformers) |
| `huggingface_hub` | Model downloading (HuggingFace) |
| `onnxruntime` | ML inference (faster-whisper dependency) |

## Build & Configuration Files

| File | Purpose | Location |
|------|---------|----------|
| **package.json** | Project metadata, scripts, dependencies | `C:\...\WhisperClick Electron\package.json` |
| **electron-builder config** | Embedded in `package.json` `"build"` key | Lines 19–97 |
| **babel.config.js** | Babel parser config (allows `return` at top-level for Jest) | `C:\...\WhisperClick Electron\babel.config.js` |
| **jest.config.js** | Jest test config, mocks, coverage thresholds | `C:\...\WhisperClick Electron\jest.config.js` |
| **tailwind.config.js** | Tailwind CSS configuration | `C:\...\WhisperClick Electron\tailwind.config.js` |
| **engine/requirements.txt** | Python sidecar dependencies (pinned or ranges) | `C:\...\WhisperClick Electron\engine\requirements.txt` |
| **.github/workflows/build.yml** | CI/CD pipeline (runs on push/PR to main) | `C:\...\WhisperClick Electron\.github\workflows\build.yml` |

## Build Output

### Build Targets (from `package.json` `build.win/mac/linux`)

| Target | Platform | Output |
|--------|----------|--------|
| **NSIS Installer** | Windows x64 | `WhisperClick-Setup-{version}.exe` |
| **Portable EXE** | Windows x64 | `WhisperClick-Portable-{version}.exe` |
| **DMG** | macOS x64 + arm64 | `WhisperClick-{version}.dmg` |
| **AppImage** | Linux x64 | `WhisperClick-{version}.AppImage` |

Output directory: `release/` (configured in `build.directories.output`)

### Application Metadata

| Field | Value |
|-------|-------|
| **App ID** | `com.whisperclick.app` |
| **Product Name** | `WhisperClick` |
| **Current Version** | `2.1.2` (from `package.json` `version`) |
| **Author** | Edward Shamosh |

## Main Process Entry Point

| File | Purpose | Lines |
|------|---------|-------|
| **`electron/main.js`** | Main process (windows, IPC, sidecar, tray, hotkey) | ~1200 |
| **`electron/sidecar.js`** | Sidecar manager (Python process spawning, JSON protocol) | ~150 |
| **`electron/store.js`** | Settings/history persistence (atomic JSON, encryption) | ~250 |
| **`electron/updater.js`** | Auto-updater integration (electron-updater events, IPC) | ~200 |
| **`electron/preload.js`** | Renderer preload (security bridge, pywebview API shim) | ~500 |
| **`electron/preload-pill.js`** | Pill window preload (electronAPI bridge) | ~100 |
| **`electron/tray.js`** | System tray icon & menu | ~250 |
| **`electron/state-machine.js`** | Recording state machine (dormant → recording) | ~100 |
| **`electron/logger.js`** | Structured logging (file + console) | ~100 |

## Renderer (Frontend) Structure

| File | Purpose | Notes |
|------|---------|-------|
| **`src/frontend/index.html`** | Main UI | 4800+ lines, V3 frontend, inline JS/CSS |
| **`src/frontend/css/tailwind.css`** | Pre-built Tailwind CSS | Output from Tailwind build (no dynamic scanning) |
| **`src/frontend/js/lucide.min.js`** | Lucide icon library (SVG) | Bundled, no npm import |
| **`src/pill/pill.html`** | Floating pill widget | Self-contained, minimal inline JS |

## Test Configuration

### Test Runner Setup

| Config | Value |
|--------|-------|
| **Test Environment** | Node.js (not jsdom) |
| **Test Timeout** | 10 seconds |
| **Primary Suite** | `npm test` (runs all 412 tests) |
| **Coverage Thresholds** | 85% statements, 60% branches (global); 100% store.js/sidecar.js/preload.js |

### Mock Configuration

| Module | Mock Path |
|--------|-----------|
| `electron` | `C:\...\WhisperClick Electron\tests\mocks\electron.js` |
| `electron-updater` | `C:\...\WhisperClick Electron\tests\mocks\electron-updater.js` |

## TypeScript

**Not used.** Project is pure JavaScript (CJS in main process, inline JS in renderer).

## External Tools & CLI

| Tool | Version | Purpose |
|------|---------|---------|
| **electron-builder** | ^26.0.12 | Packaging & code signing |
| **git** | 2.51.2 | Version control |
| **GitHub CLI** | (for CI/CD) | Release publishing |

## Configuration Directories (Runtime)

| Environment | Config Path |
|-------------|-------------|
| **Development** | `%APPDATA%\Electron\whisperclick-dev\` |
| **Beta** | `%APPDATA%\Electron\whisperclick-beta\` |
| **Production** | `%APPDATA%\Electron\whisperclick\` |

Files: `settings.json`, `history.json` (+ `.bak` backups for crash recovery)

## Asset Pipeline

| Input | Tool | Output | Location |
|-------|------|--------|----------|
| Tailwind source | `tailwindcss CLI` | `src/frontend/css/tailwind.css` | Pre-built, checked into repo |
| Lucide icons | Manual export | `src/frontend/js/lucide.min.js` | Bundled JS file |
| PNG icons | None | `icons/icon.png` | Source image |
| ICO icons | None | `icons/icon.ico` | Windows installer icon |

No build step for frontend — `index.html` is served directly by Electron.
