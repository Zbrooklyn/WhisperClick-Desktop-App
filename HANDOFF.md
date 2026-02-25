# WhisperClick V3 - Handoff

## Current State

- Status: v1.2.0 released (private + public), all features complete
- Date context: 2026-02-24
- Summary: Desktop app released as v1.2.0 with maximize/snap, WndProc guard, complete dev/prod isolation, onboarding fix, and website launch page.

## Canonical Runtime Paths

- Main entrypoint: `src/main.py`
- Desktop bridge API: `src/backend/api.py`
- Primary UI: `src/frontend/index.html`
- Pill runtime: `src/pill_manager.py`, `src/pill_widget.py`

## Completed (Current Reality)

- Release/build pipeline is in place:
  - `release_windows.ps1`
  - `build_windows_onefile.ps1`
  - `build_windows_installer.ps1`
  - `whisperclick.spec`, `whisperclick_onefile.spec` (includes faster-whisper/ctranslate2/tokenizers/huggingface_hub hidden imports + native DLLs)
  - `installer/WhisperClick.iss` (desktop, Start Menu, taskbar pin, Start with Windows options)
  - launcher CMD files (`Build_Folder_Portable.cmd`, `Build_OneFile_Portable.cmd`, `Build_Installer_Only.cmd`, `Build_Release_All.cmd`)
  - GitHub Actions `release.yml` builds all 3 artifacts on tag push
- UI integration and bridge wiring:
  - local recording path via native bridge (`start_recording`, `stop_recording`)
  - settings persistence (`save_settings`) for system toggles and mode/model
  - microphone list/select wiring (`get_microphones`, `set_microphone`)
  - history hydration and actions (`get_history`, `delete_history`, `clear_history`, `copy_to_clipboard`)
- API-mode history persistence:
  - backend `append_history_item` is used by frontend when saving API-mode outputs
- API key persistence and verification:
  - secure key storage endpoints in `src/backend/api.py`
  - startup key hydration in frontend
  - provider verification endpoint + settings status feedback
- Hotkey behavior improvements:
  - hotkey capture flow is now `Record -> press combo -> save`
  - old macro-MVP hotkey detour was removed
  - backend runtime hotkey rebind callback applies hotkey changes without restart (when possible)
  - desktop hotkey path now avoids duplicate trigger race by using native bridge path as canonical in desktop mode
- Local model manager UX improvements:
  - settings model manager now supports selecting downloaded models (`Use` action)
- Timer behavior:
  - main recording timer resets to `00:00` after processing returns to idle
- Icon pipeline:
  - source of truth: `assets/microphone_logo.svg`
  - generated runtime/build assets: `assets/microphone_logo.png`, `assets/microphone_logo.ico`

## v1.2.0 Changes (2026-02-24)

- Maximize button + toggle_maximize()/is_maximized() API
- Windows snap support: drag-to-edge, Win+Arrow, Snap Layouts (Win+Z)
- Native title bar drag via WM_APP_DRAGSTART → ReleaseCapture + SendMessage(WM_NCLBUTTONDOWN, HTCAPTION)
- WndProc hook in main.py: WM_NCHITTEST (top-edge resize), WM_NCCALCSIZE (accent border removal), WM_APP_DRAGSTART (drag), WM_APP_NCRESIZE (top resize)
- Double-click title bar to maximize (mousedown timing, 300ms threshold)
- Maximize icon swap using is_maximized() API + Lucide `[data-lucide]` selector
- Onboarding overlay and settings drawer now use `top-10` so title bar stays visible
- WndProc guard loop: detects and reinstalls hook if WebView2 overwrites WndProc during late init
- Complete dev/prod isolation: AppUserModelID, registry autostart key, hotkey ID now separated
- Onboarding fix: skip onboarding when backend settings indicate prior configuration; show toast instead
- Onboarding UI fix: progress bar starts at 0% (was 100%), shows "Checking..." instead of "Ready"
- Website: product launch page with SEO keywords, direct download via GitHub API, download notification
- README: rewritten as product launch page
- Detailed changelog: `docs/maximize-snap-changelog.md`

## Known Issues / Open Gaps

- ~~History search input is currently not working.~~ (Fixed — substring filter implemented)
- ~~Local models not working in installed EXE.~~ (Fixed in v1.1.0 — PyInstaller hidden imports + DLLs)
- ~~Pill widget recording parity is incomplete.~~ (Resolved — `_inject_api_credentials()` in `stop_recording()` reads fresh `self._settings` + keyring for all paths: pill, tray, main UI. Frontend pushes every setting change to backend immediately.)
- Full manual release validation is still pending:
  - tray/menu behavior matrix
  - pill behavior matrix
  - local/API recording quality and edge-case checks
  - second-machine packaging validation

## Verification Snapshot

- V3 comprehensive test suite: `python tools/v3_full_test.py`
  - Result: pass (`280 passed`, `0 failed`, `0 warnings`)
  - 1 intermittent flake: `_save_audio creates OGG file` (recorder state-dependent, not a real bug)
  - Coverage: settings, models, mics, languages, history CRUD, clipboard, recording cycles,
    API key management, transcription service, audio recorder, config persistence,
    model manager, edge cases/stress, pywinauto UI window check
- Legacy smoke test: `python tools/full_smoke_test.py --timeout 20`
  - Result: pass (`automated_passed: 9`, `automated_failed: 0`)
- Python compile checks: all 22 `.py` files compile cleanly
- Latest release: v1.2.0 (2026-02-24)

## v1.1.0 Changes (2026-02-23)

- Fixed local model transcription in frozen EXE (PyInstaller hidden imports + native DLLs)
- Explicit `download_root` for WhisperModel so model lookup works in frozen builds
- Dev/prod config isolation (`~/.config/whisperclick-dev/` vs `~/.config/whisperclick/`)
- Dev ribbon overlay on tray icon + `[DEV]` in window title when running from source
- Installer options: Start Menu shortcut, Pin to taskbar, Start with Windows
- macOS port roadmap with full platform abstraction design
- Platform support table in README

## Prior Fixes (v1.0.0 cycle)

- Deleted legacy dead code: `src/app.py`, `src/ui/`, duplicate top-level modules
- Implemented history search (substring filter on text + title)
- Implemented TXT export (Blob + download)
- Fixed recording timer not resetting on error paths
- Fixed XSS in toast messages (innerHTML -> textContent)
- Fixed audio stream resource leak on start failure
- Fixed pill timer accumulation on rapid record toggles
- Fixed pill menu showing hardcoded hotkey (now reads from settings)
- Fixed clipboard copy silent failure (try/finally)
- Fixed temp file cleanup masking real transcription errors
- Removed stale `run_pill.pyw` duplicate
- Cleaned stale release artifacts
- Updated all doc references from V2 to V3

## Next Actions

1. Run full manual production audit matrix (hotkey, tray, pill, local/API modes, device edge cases).
2. Validate on a second Windows machine.
3. macOS port — planned and documented in `docs/ROADMAP.md`.

## Documentation Map

- Launch roadmap: `docs/ROADMAP.md`
- Production audit checklist: `docs/PRODUCTION_AUDIT_CHECKLIST.md`
- Additional production checklist: `docs/PRODUCTION_CHECKLIST.md`
- Build/release instructions: `docs/WINDOWS_BUILD.md`
- UI design guardrails: `docs/UI_DESIGN_PLAYBOOK.md`
- Testing strategy: `docs/TESTING.md`
- Developer questions (V3): `docs/DEVELOPER_QUESTIONS.md`
- Maximize/snap changelog + lessons learned: `docs/maximize-snap-changelog.md`
- DPI drag fix spec (superseded): `docs/dpi-drag-fix-spec.md`

## Last Updated

- Date: 2026-02-24
- Updated by: Claude Opus 4.6
