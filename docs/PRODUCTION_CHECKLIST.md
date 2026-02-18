# WhisperClick v2 Production Checklist

Last updated: 2026-02-18
Scope: `projects/whisper-stt-v2`

## Release Blockers (P0)

- [ ] Dependencies are reproducible from `requirements.txt`
  - Current status: FAIL
  - Evidence: app imports PySide6 (`src/pill_manager.py`, `src/pill_widget.py`, `run_pill.py`) but `requirements.txt` does not include `PySide6`.
  - Exit criteria: fresh `setup.ps1` environment runs `python src/main.py` without missing-module errors.

- [ ] Toolbar model selector is fully wired
  - Current status: FAIL
  - Evidence: model dropdown is created but never populated in frontend (`src/frontend/js/app.js:612`), while only mic dropdown is populated (`src/frontend/js/app.js:644`).
  - Exit criteria: model options render in toolbar, selection updates backend model, persists after restart.

- [ ] Hotkey setting is actually applied (not only saved)
  - Current status: FAIL
  - Evidence: UI saves custom hotkey (`src/frontend/js/app.js:1157`) but listener is hardcoded to `<ctrl>+<shift>+r` (`src/main.py:139`).
  - Exit criteria: chosen hotkey in settings is the active global hotkey after apply/restart.

- [ ] Recording start/stop failure handling is robust
  - Current status: FAIL
  - Evidence: UI sets recording state before checking `start_recording` result (`src/frontend/js/app.js:475`, `src/frontend/js/app.js:488`).
  - Exit criteria: if microphone start fails, UI returns to idle and shows actionable error.

- [ ] "Cancel processing" cancels backend work or is relabeled honestly
  - Current status: FAIL
  - Evidence: cancel only sets UI flag (`src/frontend/js/app.js:536`) while `stop_recording` call already runs (`src/frontend/js/app.js:501`).
  - Exit criteria: either real cancel support exists in backend worker path, or UI text changes to "Hide result when ready" style behavior.

- [ ] Close button behavior matches setting contract
  - Current status: FAIL
  - Evidence: header close button calls `api.close()` (`src/frontend/js/app.js:784`), and backend `close()` destroys window (`src/backend/api.py:48`) instead of using `close_behavior`.
  - Exit criteria: close action follows selected behavior (`tray` vs `quit`) across title-bar and custom close button.

- [ ] Startup registration launches the app reliably
  - Current status: FAIL
  - Evidence: autostart writes only `sys.executable` to registry (`src/backend/api.py:337`), which is not sufficient for script-mode startup.
  - Exit criteria: restart Windows and app launches correctly when setting is enabled.

- [ ] App icon and tray icon assets are production-ready
  - Current status: FAIL
  - Evidence: no project `.ico` asset present; tray icon is generated in code (`src/main.py:44`) and not branded/stateful.
  - Exit criteria: branded `.ico` exists, app/taskbar/tray all use it, and tray state changes for recording/idle.

## High Priority (P1)

- [ ] Replace fake model download progress with real progress reporting
  - Current status: PARTIAL
  - Evidence: backend only emits 0% then 100% around `snapshot_download` (`src/backend/models.py:64`, `src/backend/models.py:75`).
  - Exit criteria: progress bar increments meaningfully during download.

- [ ] Persist and restore selected microphone
  - Current status: PARTIAL
  - Evidence: microphone can be set via API, but no persisted mic setting in defaults/config path.
  - Exit criteria: selected mic survives app restart.

- [ ] Remove or isolate legacy/dead paths
  - Current status: FAIL
  - Evidence: old Tk app stack still present (`src/app.py`) and web pill artifact has TODOs (`src/frontend/pill.html:398`) not used by main flow.
  - Exit criteria: one canonical runtime path remains; stale paths are removed or explicitly documented as legacy.

- [ ] Add structured logging and crash diagnostics
  - Current status: FAIL
  - Exit criteria: key flows (record start/stop, transcription errors, model downloads) emit structured logs to file.

## Release Readiness (P2)

- [ ] CI checks for lint/type/smoke
  - Current status: FAIL
  - Exit criteria: at least one CI pipeline validates install + syntax + smoke startup.

- [ ] Packaging and installer
  - Current status: FAIL
  - Exit criteria: reproducible Windows build (`.exe`/installer), signed if needed, with icon and startup behavior verified.

- [ ] Documentation completeness
  - Current status: PARTIAL
  - Exit criteria: README includes install, run modes (local/API), model download behavior, troubleshooting, and privacy notes.

## Quick Validation Matrix (run before release)

- [ ] Fresh machine install via `setup.ps1`
- [ ] First run onboarding and model download
- [ ] Local mode transcription
- [ ] API mode transcription with valid key and missing-key error path
- [ ] Tray close/minimize/restore behavior
- [ ] Global hotkey toggle from background app state
- [ ] Pill widget show/hide/record/cancel/paste flows
- [ ] Export (`txt`, `srt`, `json`) and clipboard
- [ ] Start-with-Windows behavior after reboot
