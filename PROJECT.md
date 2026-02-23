# WhisperClick V3

## Purpose

Desktop Windows transcription app with:
- local Whisper-based capture/transcription mode,
- API-backed transcription/translation mode (OpenAI/Gemini),
- tray + optional pill widget workflows,
- portable and installer packaging paths.

## Current Status

- Delivery stage: pre-release hardening (not launch-complete yet)
- Primary tracking docs:
  - `HANDOFF.md`
  - `docs/ROADMAP.md`
  - `docs/PRODUCTION_AUDIT_CHECKLIST.md`
  - `docs/PRODUCTION_CHECKLIST.md`

## Runtime Entry Points

- Main desktop runtime: `src/main.py`

## Build and Packaging

- Build/release docs: `docs/WINDOWS_BUILD.md`
- Core scripts:
  - `release_windows.ps1`
  - `build_windows_onefile.ps1`
  - `build_windows_installer.ps1`

## Known Launch Blockers

- Pill widget recording parity with main UI pipeline is incomplete.
