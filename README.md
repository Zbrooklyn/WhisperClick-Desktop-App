# WhisperClick

**Local-first AI speech-to-text for Windows.** Press a hotkey, speak, and your words appear as text — instantly pasted wherever your cursor is.

WhisperClick runs a local Whisper model for fully offline transcription, or connects to OpenAI/Gemini APIs for cloud-powered accuracy. No always-on microphone. No background listening. You control when it records.

## Features

- **Global hotkey** — toggle recording from any app with a customizable keyboard shortcut
- **Local mode** — fully offline transcription using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (tiny → large models)
- **API mode** — cloud transcription via OpenAI Whisper API or Google Gemini
- **Auto-paste** — transcribed text is copied to clipboard and pasted at your cursor
- **Floating pill** — minimal always-on-top recording indicator with timer
- **History** — searchable transcription history with audio playback (24h retention)
- **Sound feedback** — distinct audio cues for start, stop, success, error, and cancel
- **System tray** — runs quietly in the background with tray icon and menu
- **Multi-monitor DPI** — correct window positioning across mixed-DPI displays
- **50+ languages** — supports all languages available in Whisper

## Quick Start

### Download (Windows)

1. Go to [Releases](https://github.com/Zbrooklyn/whisper-click-public/releases)
2. Download one of:
   - **`WhisperClick-Setup-*.exe`** — installer (recommended)
   - **`WhisperClick-portable-*.zip`** — portable folder, no install needed
   - **`WhisperClick-portable-onefile-*.exe`** — single-file portable EXE
3. Run WhisperClick. It starts in the system tray.
4. Press `Ctrl+Shift+R` (default) to start/stop recording.

### Run from Source

```bash
# Clone the repo
git clone https://github.com/Zbrooklyn/whisper-click-public.git
cd whisper-click-public

# Create virtual environment
python -m venv venv
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run
python src/main.py
```

### API Mode Setup

1. Open Settings (right-click tray icon → Settings)
2. Select **API** mode and choose a provider (OpenAI or Gemini)
3. Paste your API key — it's verified on entry and stored securely via OS keyring

### Local Mode Setup

1. Open Settings → select **Local** mode
2. Choose a model size (tiny → large) — smaller = faster, larger = more accurate
3. Click **Download** — the model downloads once and runs fully offline

## Building from Source

See [docs/WINDOWS_BUILD.md](docs/WINDOWS_BUILD.md) for detailed build instructions.

```powershell
# Folder portable (PyInstaller)
.\release_windows.ps1

# Single-file portable
.\build_windows_onefile.ps1

# Windows installer (requires Inno Setup)
.\build_windows_installer.ps1
```

## Architecture

```
src/
  main.py              # Entrypoint: pywebview + pystray + hotkey + tray
  pill_manager.py      # Floating pill lifecycle (PySide6)
  pill_widget.py       # Floating pill UI widget
  backend/
    api.py             # Desktop bridge API (webview ↔ Python)
    audio_recorder.py  # Native audio capture (sounddevice)
    config.py          # Settings/history persistence
    transcription.py   # Transcription service (OpenAI, Gemini, local Whisper)
  frontend/
    index.html         # Main UI (HTML/CSS/JS via pywebview)
```

## Privacy

WhisperClick respects your privacy. See [PRIVACY.md](PRIVACY.md) for details.

- **Local mode**: Audio is processed entirely on your machine. Nothing leaves your computer.
- **API mode**: Audio is sent to OpenAI or Google for transcription. No audio is stored by WhisperClick after transcription completes.

## License

Copyright (c) 2025-2026 WhisperClick. All Rights Reserved. See [LICENSE](LICENSE).

## Security

To report a security vulnerability, see [SECURITY.md](SECURITY.md).
