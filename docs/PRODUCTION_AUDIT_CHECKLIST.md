# WhisperClick V3 Production Audit Checklist

Date: 2026-02-20
Scope: `projects/WhisperClick V3`

## 1. Release Blockers (Must Pass)

- [x] App starts without immediate crash (`python .\src\main.py` smoke launch)
- [x] Frontend script parses cleanly (`node --check` on extracted `<script>` blocks)
- [x] Python entry points compile (`py_compile` on `src/main.py`, `src/backend/api.py`)
- [x] No explicit placeholder markers in source (`TODO`, `FIXME`, `Coming Soon`, `live_placeholder`)
- [x] Hardcoded fake model status removed from UI

## 2. Core Functional Paths

- [x] Local mode uses native backend recording/transcription path (`start_recording`/`stop_recording`)
- [x] Settings toggles persist via backend (`save_settings`)
- [x] Microphone picker loads native devices (`get_microphones`) and applies selection (`set_microphone`)
- [x] History hydrates from backend (`get_history`)
- [x] History delete/clear use backend (`delete_history`, `clear_history`)
- [x] Clipboard actions use backend (`copy_to_clipboard`)
- [x] Close button uses native app close behavior (`api.close`)

## 3. UI/Data Integrity

- [x] Settings model card reflects real model status (no demo values)
- [x] Runtime mode no longer exposes non-functional placeholder option
- [x] Onboarding local model status text is dynamic (not fixed "no download")
- [x] Tray icon assets align to Claude orange microphone branding
- [x] API keys persist across relaunch via backend storage (not session-only UI memory)
- [x] API key paste/input triggers provider verification feedback (OpenAI/Gemini)
- [x] Footer hotkey hint syncs with active hotkey setting
- [x] Hotkey settings uses record-and-capture flow (no prompt/macro detour)
- [x] Local Model Manager supports selecting downloaded local models
- [x] Main recording timer resets to `00:00` after processing returns to idle

## 4. Manual Validation Required Before Release

- [ ] Local transcription quality check with real microphone input
- [ ] API transcription/translation check with valid OpenAI key
- [ ] API transcription/translation check with valid Gemini key
- [ ] API key verification UX check:
  - [ ] Paste valid key -> shows verified.
  - [ ] Paste invalid key -> shows invalid with clear message.
- [ ] API key verification network-path check:
  - [ ] Network timeout/offline -> clear retry guidance.
  - [ ] Invalid base URL -> clear remediation guidance.
- [ ] Tray actions check: Show, Record, Settings, Quit
- [ ] Pill widget behavior check (show/hide/open settings from pill)
- [ ] Minimize/close behavior check (`tray` vs `quit`)
- [ ] Start-with-Windows toggle check after reboot/login
- [ ] Always-on-top toggle behavior check
- [ ] Model switch behavior check when selected model is not downloaded
- [x] Notification copy audit:
  - [x] Toast text matches actual runtime behavior.
  - [x] No stale/legacy wording remains.
  - [x] Removed redundant toasts (recording started, processing, saved to history).
- [x] Wiring integrity audit:
  - [x] Each visible control is mapped to real backend behavior. (47/47 controls wired.)
  - [x] No dead buttons, no misleading labels, no disconnected toggles.
  - [x] History search input returns filtered results.
- [ ] Hotkey contract audit:
  - [ ] Footer hotkey hint equals saved setting.
  - [ ] In-window listener uses saved setting.
  - [ ] Global hotkey matches saved setting after restart.
- [ ] Microphone/device resilience:
  - [ ] Permission denied path.
  - [ ] Device unplug path during recording.
  - [ ] Recovery after device/default switch.

## 5. Packaging/Distribution

- [ ] Folder portable build smoke run
- [ ] One-file portable build smoke run
- [ ] Installer install/uninstall smoke run
- [ ] Verify tray icon and app icon in packaged outputs

## 6. Security and Privacy

- [x] API keys never persist in browser localStorage/sessionStorage. (Confirmed: zero references.)
- [x] API keys are not written to logs or diagnostics. (Confirmed: no print/log of keys.)
- [x] API keys are not leaked via get_settings() to frontend. (Fixed: filtered out `*_api_key` fields.)
- [x] API keys are not exposed in error messages. (Fixed: sanitized Gemini error body and verification detail.)
- [x] Secure storage backend is verified on target OS, with fallback behavior documented.
- [ ] API keys in plaintext settings.json fallback: accepted trade-off when keyring is unavailable. Keyring clears fallback on migration.

## 7. Reliability and Performance

- [ ] Long-recording stress test (memory/CPU remains within acceptable bounds).
- [x] Rapid-toggle stress test (no stuck recording/processing state). (Automated: 3x rapid start/cancel in test suite.)
- [x] Repeated API transcription runs (no state drift or notification spam). (Redundant toasts removed.)
- [ ] Idle soak test (no leak-like growth over time).

## 8. Release Gate Evidence

- [ ] Clean-machine installer verification evidence captured (install, launch, uninstall).
- [ ] Clean-machine portable verification evidence captured.
- [ ] Upgrade-path evidence captured (old version -> new version).
- [ ] Rollback/recovery procedure documented and tested.

## 9. Data Migration and Upgrade Safety

- [ ] Settings/history schema version is explicitly tracked.
- [ ] Migration path from previous releases is tested.
- [ ] Migration rollback behavior is validated (no data corruption/loss).
- [ ] Installer upgrade path preserves required user data.

## 10. Update and Distribution Strategy

- [ ] Update model is defined (auto-update vs manual).
- [ ] Update package authenticity verification is defined and tested.
- [ ] Failed update recovery path is documented and tested.
- [ ] Release channel policy (stable/beta/internal) is documented.

## 11. Accessibility and UX Compliance

- [ ] Keyboard-only navigation works across onboarding/settings/record/history.
- [ ] Visible focus indicators pass usability review.
- [ ] Color contrast meets accessibility targets.
- [ ] Screen reader labels exist for key controls and states.

## 12. DevSecOps and Supply Chain

- [ ] CI runs install/compile/smoke gates on release branches.
- [ ] CI packaging sanity checks run for installer + portable artifacts.
- [ ] Dependency vulnerability scan is executed and reviewed.
- [ ] SBOM is generated and attached to release artifacts.
- [ ] Signing/identity checks are verified for EXE/installer outputs.

## 13. Supportability and Incident Readiness

- [ ] Logging schema is documented (events, levels, correlation/session IDs).
- [ ] Log redaction policy is verified (no secrets/PII leakage).
- [ ] Support bundle format is defined and tested for safe sharing.
- [ ] Incident response playbook exists for provider outage/rate-limit scenarios.
- [ ] User-facing outage/retry messaging is validated during simulated failures.

## 14. Governance and Launch Decision

- [ ] Launch acceptance criteria are explicit and measurable.
- [ ] Go/no-go owner and sign-off chain are documented.
- [ ] Blocker severity thresholds are defined.
- [ ] Rollback trigger thresholds and decision policy are documented.

## Evidence Snapshot

- Frontend integration file: `src/frontend/index.html`
- Pill context menu cleanup: `src/frontend/pill.html`
- Icon runtime usage: `src/main.py`, `assets/microphone_logo.svg`, `assets/microphone_logo.ico`, `assets/microphone_logo.png`
