# Hacker News — Show HN

## Title

> Show HN: WhisperClick -- Open-source desktop voice-to-text with one-hotkey paste

## First Comment (Maker)

I built WhisperClick because I wanted a single hotkey that would let me talk instead of type in any app on my desktop.

The problem: you talk 3-4x faster than you type, but existing dictation tools either only work in specific apps, require switching windows, or send your audio to someone else's server with no alternative. I wanted something that works everywhere, lets me choose my transcription backend, and stays out of the way.

**How it works:**
1. Press Ctrl+Alt+R (customizable) from any application
2. Talk
3. Press the hotkey again
4. Text appears at your cursor

That's it. No app switching, no clipboard. A small floating pill shows recording state -- otherwise it's invisible.

**Transcription backends:**
- OpenAI (GPT-4o Transcribe, Whisper)
- Google Gemini (2.5 Flash, Pro)
- Local faster-whisper models (fully offline, no API key needed)

**Tech decisions:**

*Electron + Python sidecar.* The frontend is a single HTML file with Tailwind CSS -- no React, no bundler. The Python sidecar handles audio capture and transcription via JSON over stdin/stdout. Electron manages windows, IPC, hotkeys, tray, and auto-updates.

I originally built this with pywebview (Python-native WebView2 wrapper), but hit walls with cross-platform support, frameless window quirks, and distribution. Electron was the pragmatic choice -- it handles the hard parts (global hotkeys, system tray, auto-updates, code signing) so the sidecar can focus on audio and AI.

*Why a Python sidecar?* The transcription ecosystem lives in Python -- faster-whisper, OpenAI SDK, audio capture libraries. Rather than porting all of that to Node, I keep Python doing what it's good at and communicate over a simple JSON protocol. The sidecar starts with the app, restarts on crash (max 3 retries with backoff), and shuts down cleanly on quit.

*No framework overhead.* The V3 frontend (from the previous pywebview version) is loaded directly. The Electron preload script acts as a compatibility shim -- V3 code calls `window.pywebview.api.method()` and the preload routes it to IPC. This gave me pixel-perfect parity with the previous version without a rewrite.

**Privacy:** Zero telemetry, zero analytics, zero data collection. No background network calls. In local mode, audio never leaves your machine. API keys are encrypted at rest via Electron safeStorage.

**Stats:** 301 tests (Jest unit + integration + E2E), 85%+ statement coverage. Runs on Windows (stable), macOS and Linux (early access).

**Links:**
- Website: https://whisperclick.com
- GitHub: https://github.com/Zbrooklyn/WhisperClick-Desktop-App
- Download: https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest

Licensed CC BY-NC-SA 4.0 -- free for personal/non-commercial use.

Happy to talk architecture, the pywebview-to-Electron migration, or anything else.
