# WhisperClick

Voice-to-text for your desktop. One hotkey, instant paste — works with any app on Windows, macOS, and Linux.

WhisperClick records your voice, transcribes it using OpenAI or Google Gemini, and pastes the result into whatever app you were using. No browser tab, no copy-paste — just talk and it types.

## Download (Beta)

| Platform | Download | Notes |
|----------|----------|-------|
| **Windows** | [Setup Installer (.exe)](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest/download/WhisperClick-Setup-2.1.0-beta.9.exe) | Recommended — installs + auto-updates |
| **Windows** | [Portable (.exe)](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest/download/WhisperClick-Portable-2.1.0-beta.9.exe) | No install needed, runs anywhere |
| **macOS** | [DMG (Apple Silicon)](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest/download/WhisperClick-2.1.0-beta.9-arm64.dmg) | M1/M2/M3/M4 Macs |
| **Linux** | [AppImage](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest/download/WhisperClick-2.1.0-beta.9.AppImage) | Works on most distributions |

> All downloads are on the [Releases page](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases).
> The app auto-updates after install — you only need to download once.

## How It Works

1. Press **Ctrl+Alt+R** (configurable) to start recording
2. Speak naturally
3. Press the hotkey again to stop
4. Your transcription is pasted into the focused app

That's it. WhisperClick runs in the background with a system tray icon and an optional floating pill widget for quick access.

## Features

- **Global hotkey** — record from any app without switching windows
- **Auto-paste** — transcription goes straight into your active text field
- **Floating pill widget** — tiny always-on-top capsule for click-to-record
- **Multiple providers** — OpenAI (GPT-4o Transcribe, Whisper) or Google Gemini
- **Translation mode** — transcribe in one language, output in another
- **History** — searchable log of all transcriptions with audio playback
- **Audio visualizer** — 8 styles, 3 motion presets, 4 density levels
- **Dark and light themes**
- **Auto-updater** — background download with one-click restart
- **Cross-platform** — Windows, macOS (Apple Silicon), Linux

## Transcription Providers

WhisperClick uses cloud APIs for transcription. You'll need an API key from one of these providers:

| Provider | Models | Get a Key |
|----------|--------|-----------|
| **OpenAI** | gpt-4o-transcribe, gpt-4o-mini-transcribe, whisper-1 | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Google Gemini** | Gemini 2.5 Flash, 2.5 Pro, 3 Flash Preview, 3 Pro Preview | [aistudio.google.com](https://aistudio.google.com/apikey) |

API keys are encrypted at rest using your OS keychain (Electron `safeStorage`).

## Screenshots

*Coming soon*

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Python](https://www.python.org/) 3.12+ (for the recording/transcription engine)

### Setup

```bash
git clone https://github.com/Zbrooklyn/WhisperClick-Desktop-App.git
cd WhisperClick-Desktop-App
npm install
pip install -r engine/requirements.txt
```

### Run in Development

```bash
npm start
```

### Build Installers

```bash
# Windows (NSIS installer + portable)
npm run dist:win

# macOS (DMG)
npm run dist:mac

# Linux (AppImage)
npm run dist:linux
```

### Run Tests

```bash
npm test              # All tests (294)
npm run test:unit     # Unit tests only
npm run test:e2e      # End-to-end tests
```

## Architecture

WhisperClick is an Electron app with a Python sidecar for audio recording and transcription.

```
electron/          Main process (Node.js)
  main.js          Window management, IPC, hotkey, tray
  sidecar.js       Python engine manager (JSON over stdin/stdout)
  store.js         Settings and history persistence
  updater.js       Auto-update (GitHub releases)

src/frontend/      Renderer (Chromium)
  index.html       Full UI (HTML + Tailwind CSS + inline JS)

src/pill/          Floating widget
  pill.html        Always-on-top recording capsule

engine/            Python sidecar
  engine.py        Audio capture, transcription, model management
```

## Beta Channel

WhisperClick is currently in beta. The app checks for updates automatically and will notify you when a new version is available. You can also check manually in Settings > Updates.

All beta releases are [pre-releases on GitHub](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases).

## Feedback

Found a bug or have a feature request? [Open an issue](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/issues).

## License

MIT
