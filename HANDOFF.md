# WhisperClick V3 - Handoff

## Current State

- Status: In progress
- Date context: 2026-02-20
- Summary: Desktop app is running with the IndexV3-based UI, secure API key persistence, API key verification, runtime hotkey rebinding, updated icon pipeline, and Windows build scripts for folder portable, one-file portable, and installer outputs.

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
  - `whisperclick.spec`, `whisperclick_onefile.spec`
  - `installer/WhisperClick.iss`
  - launcher CMD files (`Build_Folder_Portable.cmd`, `Build_OneFile_Portable.cmd`, `Build_Installer_Only.cmd`, `Build_Release_All.cmd`)
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

## Known Issues / Open Gaps

- ~~History search input is currently not working.~~ (Fixed — substring filter implemented)
- Pill widget recording parity is incomplete:
  - pill recording path is not yet fully aligned with main UI provider/model/API-key pipeline behavior.
- Full manual release validation is still pending:
  - tray/menu behavior matrix
  - pill behavior matrix
  - local/API recording quality and edge-case checks
  - second-machine packaging validation

## Verification Snapshot

- V3 comprehensive test suite: `python tools/v3_full_test.py`
  - Result: pass (`89 passed`, `0 failed`, `0 warnings`)
  - Coverage: settings, models, mics, languages, history CRUD, clipboard, recording cycles,
    API key management, transcription service, audio recorder, config persistence,
    model manager, edge cases/stress, pywinauto UI window check
- Legacy smoke test: `python tools/full_smoke_test.py --timeout 20`
  - Result: pass (`automated_passed: 9`, `automated_failed: 0`)
- Python compile checks: all 22 `.py` files compile cleanly
- Latest relaunch: process started successfully (2026-02-19)

## V3 Fixes Applied (This Session)

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

1. ~~Implement and verify history search filtering.~~ (Done)
2. Complete pill recording parity with main UI transcription pipeline.
3. Run full manual production audit matrix (hotkey, tray, pill, local/API modes, device edge cases).
4. Rebuild release artifacts and validate on a second Windows machine.
5. Prepare release decision using `docs/ROADMAP.md` + `docs/PRODUCTION_AUDIT_CHECKLIST.md` evidence.
6. macOS port is planned and fully documented in `docs/ROADMAP.md` (platform abstraction via `src/platform/`, pyobjc dependencies, execution phases).

## Documentation Map

- Launch roadmap: `docs/ROADMAP.md`
- Production audit checklist: `docs/PRODUCTION_AUDIT_CHECKLIST.md`
- Additional production checklist: `docs/PRODUCTION_CHECKLIST.md`
- Build/release instructions: `docs/WINDOWS_BUILD.md`
- UI design guardrails: `docs/UI_DESIGN_PLAYBOOK.md`
- Testing strategy: `docs/TESTING.md`
- Developer questions (V3): `docs/DEVELOPER_QUESTIONS.md`

## Last Updated

- Date: 2026-02-23
- Updated by: Claude Opus 4.6
