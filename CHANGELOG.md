# Changelog

All notable changes to WhisperClick will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-02-23

### Fixed

- Local model transcription in installed EXE (missing PyInstaller hidden imports and native DLLs for faster-whisper, ctranslate2, tokenizers, huggingface_hub)
- Explicit model cache path (`download_root`) for reliable model lookup in frozen builds
- Installer now closes running WhisperClick before upgrading (prevents locked file errors)
- Stale files from previous version cleaned before installing new files
- Downgrade warning when installing an older version over a newer one
- Window position tests now skip gracefully when config directory is fresh

### Added

- Installer options: Start Menu shortcut, Pin to taskbar, Start with Windows (auto-removed on uninstall)
- Version shown in Windows Add/Remove Programs, Windows 10 minimum enforced
- Dev/production config isolation — running from source uses `~/.config/whisperclick-dev/`, installed EXE uses `~/.config/whisperclick/`
- Dev ribbon overlay on tray icon and `[DEV]` in window title when running from source
- macOS port roadmap with full platform abstraction design (Coming Soon)
- Platform support table in README

## [1.0.0] - 2026-02-20

### Added

- Global hotkey recording toggle (customizable, default `Ctrl+Shift+R`)
- Local transcription via faster-whisper (tiny, base, small, medium, large models)
- API transcription via OpenAI Whisper API
- API transcription via Google Gemini
- Secure API key storage via OS keyring with on-paste verification
- Floating pill widget — always-on-top recording indicator with timer
- Transcription history with search, copy, export (TXT), and delete
- Audio playback in history (24-hour retention, OGG/Opus compressed)
- Sound feedback system (start, stop, success, error, cancel tones)
- System tray integration with menu (Settings, Pill toggle, Quit)
- Multi-monitor DPI-aware window positioning (Per-Monitor V2)
- Physical-pixel window drag for correct multi-DPI behavior
- Auto-paste transcribed text to cursor position
- 50+ language support (all Whisper-supported languages)
- Local model manager with download, delete, and selection UI
- Settings panel: provider, model, hotkey, language, microphone, sound toggles
- Windows build pipeline: folder portable, single-file portable, installer (Inno Setup)
- Pre-commit hooks for black + ruff formatting/linting
- Comprehensive test suite (269 test cases)
