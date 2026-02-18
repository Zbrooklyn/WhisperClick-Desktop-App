# WhisperClick v2 Production Checklist

Last updated: 2026-02-18
Scope: `projects/whisper-stt-v2`

## Release Blockers (P0)

- [ ] Dependencies are reproducible from `requirements.txt`
  - Current status: PARTIAL
  - Evidence: `PySide6` was added to `requirements.txt`, but a clean-machine install test is still pending.
  - Exit criteria: fresh `setup.ps1` environment runs `python src/main.py` without missing-module errors.

- [ ] Toolbar model selector is fully wired
  - Current status: PARTIAL
  - Evidence: toolbar model options now load from `get_models` in frontend bootstrap, but full manual UI regression is still pending.
  - Exit criteria: model options render in toolbar, selection updates backend model, persists after restart.

- [ ] Hotkey setting is actually applied (not only saved)
  - Current status: PARTIAL
  - Evidence: startup now maps saved hotkey string to `pynput` binding, but cross-layout/edge-key combinations still need validation.
  - Exit criteria: chosen hotkey in settings is the active global hotkey after apply/restart.

- [ ] Recording start/stop failure handling is robust
  - Current status: PARTIAL
  - Evidence: frontend now checks `start_recording` result before entering recording state, but broader fault-injection coverage is still pending.
  - Exit criteria: if microphone start fails, UI returns to idle and shows actionable error.

- [ ] "Cancel processing" cancels backend work or is relabeled honestly
  - Current status: PARTIAL
  - Evidence: frontend now calls backend `cancel_processing`; local transcription checks cancellation and aborts, while API-mode cancellation remains best-effort.
  - Exit criteria: either real cancel support exists in backend worker path, or UI text changes to "Hide result when ready" style behavior.

- [ ] Close button behavior matches setting contract
  - Current status: PARTIAL
  - Evidence: `api.close()` now respects configured close behavior (`tray` vs `quit`), but manual behavior verification matrix is still pending.
  - Exit criteria: close action follows selected behavior (`tray` vs `quit`) across title-bar and custom close button.

- [ ] Startup registration launches the app reliably
  - Current status: PARTIAL
  - Evidence: autostart now writes a full launch command for script mode (`pythonw + src/main.py`) and frozen mode, but reboot verification is pending.
  - Exit criteria: restart Windows and app launches correctly when setting is enabled.

- [ ] App icon and tray icon assets are production-ready
  - Current status: PARTIAL
  - Evidence: branded tray icon assets were added and wired (`assets/tray_icon.ico`, `assets/tray_icon.png`), but taskbar/app executable icon still depends on packaging.
  - Exit criteria: branded `.ico` exists, app/taskbar/tray all use it, and tray state changes for recording/idle.

## High Priority (P1)

- [ ] Replace fake model download progress with real progress reporting
  - Current status: PARTIAL
  - Evidence: backend now reports incremental per-file progress via `hf_hub_download`, but UX behavior with very small models still needs confirmation.
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
