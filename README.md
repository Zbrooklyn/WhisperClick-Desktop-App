<p align="center">
  <img src="assets/microphone_logo.png" alt="WhisperClick" width="80">
</p>

<h1 align="center">WhisperClick</h1>

<p align="center">
  <strong>Talk instead of type. Anywhere on your desktop.</strong><br>
  One hotkey. Instant transcription. Pasted right where your cursor is.
</p>

<p align="center">
  <a href="https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest">Download for Windows</a> · <a href="https://zbrooklyn.github.io/WhisperClick-Desktop-App/">Website</a>
</p>

---

You talk 3-4x faster than you type. That speed gap costs you hours every week — in emails, Slack messages, docs, code comments, and every other text field on your screen.

WhisperClick closes that gap. Press a hotkey, say what you're thinking, and the transcribed text appears at your cursor. Done. No copying, no pasting, no switching windows. It works in every app on your desktop.

<!-- Screenshots: uncomment when images are added
<p align="center">
  <img src="docs/reference/ui-captures/app-light.png" alt="WhisperClick light mode" width="500">
  <img src="docs/reference/ui-captures/app-dark.png" alt="WhisperClick dark mode" width="500">
</p>
-->

## How it works

1. Press `Ctrl+Shift+R` from any app
2. Talk
3. Press the hotkey again (or click stop)
4. Text appears at your cursor, already pasted

That's the whole workflow. There's no app to switch to, no text to copy. You talk, it types.

A small floating pill sits at the bottom of your screen while recording. It shows live audio bars so you know it's listening, and has cancel/stop controls if you need them. When you're not recording, it shows your hotkey as a reminder. That's the only UI you'll see during your day.

<!-- Pill screenshots: uncomment when images are added
<p align="center">
  <img src="docs/reference/ui-captures/pill-tooltip.png" alt="WhisperClick pill with hotkey tooltip" width="400">
  <img src="docs/reference/ui-captures/pill-recording.png" alt="WhisperClick pill recording with audio bars" width="400">
</p>
-->

## Fully offline. Your audio stays on your machine.

WhisperClick runs a Whisper AI model directly on your hardware. No internet connection. No cloud servers. No data leaving your computer. Ever.

This is the default mode. Download a model once, and from that point on the entire pipeline runs locally — recording, transcription, and paste. If you've been burned by voice tools that phone home with your audio, this is the answer.

Need cloud accuracy instead? Switch to API mode and use your own OpenAI or Google Gemini key. Audio only leaves your machine when you explicitly press the hotkey, and nothing is stored after transcription returns.

You pick the mode. You pick when it listens. There's no always-on microphone and no background recording.

## What you get

- **Global hotkey from any app.** Email, Slack, VS Code, Google Docs, a terminal — wherever your cursor is. One hotkey triggers recording and pastes the result.
- **Runs fully offline.** Local mode uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Your audio never touches a server.
- **Auto-paste at cursor.** No clipboard dance. Text lands exactly where you were typing.
- **Floating pill indicator.** A small, non-intrusive widget shows recording state and audio levels. Stays out of your way otherwise.
- **50+ languages.** Supports every language Whisper handles, including auto-detection.
- **Searchable history.** Every transcription is saved with the original audio for playback. Find what you said last Tuesday.
- **Dark mode.** Follows your system theme, or set it manually.
- **System tray app.** Lives in the tray. Right-click to switch microphones, change language, or open settings.

<!-- Tray menu screenshot: uncomment when image is added
<p align="center">
  <img src="docs/reference/ui-captures/tray-menu.png" alt="WhisperClick system tray menu" width="280">
</p>
-->

## Download

Grab the latest from the [releases page](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest):

| Package | Who it's for |
|---------|-------------|
| **WhisperClick-Setup-*.exe** | Most people. Installs to your system with Start Menu shortcut and optional auto-start. |
| **WhisperClick-portable-*.zip** | USB drives, shared machines. Unzip and run. |
| **WhisperClick-portable-onefile-*.exe** | Single file. Drop it anywhere and double-click. |

### Quick start

1. Run the installer (or the portable EXE)
2. WhisperClick appears in your system tray
3. Press `Ctrl+Shift+R` to start recording
4. Talk, then press `Ctrl+Shift+R` again to stop
5. Your words appear as text at your cursor

### Local mode setup

Open Settings, switch to Local mode, pick a model size, and hit Download. The "base" model (142 MB) is the sweet spot for most CPUs. After the download finishes, everything runs offline.

### API mode setup (optional)

Open Settings, switch to API mode, choose OpenAI or Gemini, and paste your API key. The key is verified on entry and stored in your OS keyring (Windows Credential Locker) — never in a plain-text file.

## Privacy

No telemetry. No analytics. No background network calls. No data collection of any kind.

- **Local mode**: Audio is processed on your machine and never sent anywhere.
- **API mode**: Audio goes to OpenAI or Google only when you press the hotkey. Nothing is stored after transcription.

Full details in [PRIVACY.md](PRIVACY.md).

## Platform support

| Platform | Status |
|----------|--------|
| Windows 10/11 | Available now |
| macOS | Coming soon |
| Linux | Not planned |

## Build from source

```bash
git clone https://github.com/Zbrooklyn/WhisperClick-Desktop-App.git
cd WhisperClick-Desktop-App

python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

python src/main.py
```

Build scripts for distribution:

```powershell
# Folder portable (PyInstaller)
.\release_windows.ps1

# Single-file portable
.\build_windows_onefile.ps1

# Windows installer (requires Inno Setup 6)
.\build_windows_installer.ps1
```

Full build guide: [docs/WINDOWS_BUILD.md](docs/WINDOWS_BUILD.md)

## Project structure

```
src/
  main.py              # App entry (pywebview + pystray + hotkey + system tray)
  pill_manager.py      # Floating pill lifecycle (PySide6)
  pill_widget.py       # Pill UI widget
  backend/
    api.py             # Desktop bridge API (JS <-> Python)
    audio_recorder.py  # Audio capture (sounddevice)
    config.py          # Settings and history persistence
    transcription.py   # Transcription engine (OpenAI, Gemini, local Whisper)
  frontend/
    index.html         # Main UI (single-page, Tailwind CSS)
```

## License

Source-available under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Free for personal and non-commercial use. Commercial use requires a separate license. See [LICENSE](LICENSE).

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md) for responsible disclosure.
