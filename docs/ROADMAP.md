# WhisperClick V3 Roadmap

Last updated: 2026-02-20

## Immediate (Launch-Critical)

- [x] Persist API keys securely across relaunch (backend key storage).
- [x] Verify API key validity on paste/input for OpenAI and Gemini.
- [x] Keep footer hotkey hint synced to active hotkey setting.
- [x] Replace prompt-based hotkey edit with direct record-and-capture shortcut flow.
- [x] Enable local model selection from Settings Local Model Manager (for downloaded models).
- [x] Reset main recording timer to `00:00` after recording cycle completes.
- [x] Notification contract (P0):
  - [x] Define each toast/notification trigger, severity, and expected user action.
  - [x] Remove stale/outdated language and legacy wording.
  - [x] Ensure all failures include actionable next steps.
  - [x] Removed redundant toasts (recording started, processing, saved to history).
- [x] Wiring audit (P0):
  - [x] Prove each visible control is connected to active backend logic. (47/47 wired.)
  - [x] Identify UI elements backed by dead/legacy code paths. (None found.)
  - [x] Remove or explicitly document non-canonical wiring.
  - [x] Pill widget recording parity: ensure pill path uses the same provider/model/API-key pipeline as main UI.
- [x] Recording/transcription state-machine hardening (P0):
  - [x] Validate start, stop, cancel, retry, and error-recovery flows. (Automated test suite.)
  - [x] Validate behavior under rapid repeated toggles. (3x rapid start/cancel stress test.)
  - [x] Validate transitions between local and API modes. (Automated test suite.)
- [ ] Real-world hotkey validation matrix:
  - [ ] In-app toggle with custom hotkey.
  - [ ] Global hotkey after app restart.
  - [ ] Behavior with keyboard layouts and function keys.
- [x] API resilience and error semantics (P0):
  - [x] Validate user-facing handling for `401`, `403`, `429`, `5xx`, timeout, offline, and invalid base URL.
  - [x] Ensure provider-specific failures map to clear user guidance.
  - [x] Confirm verification and transcription error messages do not conflict.
- [x] History search wiring (P0):
  - [x] Fix History search input; it is currently not working.
  - [x] Add filter state tests for empty query, partial match, and clear/reset behavior.
- [ ] Microphone/device resilience (P0):
  - [ ] Permission denied and revoked scenarios.
  - [ ] Device unplug/switch during recording.
  - [ ] Default device reassignment and recovery behavior.

## Audio Storage

- [x] Save compressed recordings (OGG/Opus) alongside history entries.
- [x] Auto-delete recordings after 24 hours on app startup.
- [x] Playback button on history cards (hover to reveal).
- [x] Full audio player in detail modal.
- [ ] Configurable retention period (1 day, 3 days, 7 days, 30 days).
- [ ] Retention period selector in Settings UI.
- [ ] Storage usage indicator.

## Next

- [ ] Full production smoke checklist with manual pass/fail evidence.
- [ ] Installer and portable runtime validation on second Windows machine.
- [ ] Structured runtime logging and crash diagnostics.
- [x] Legacy cleanup and runtime path consolidation:
  - [x] Removed old Tk runtime path (`src/app.py`, `src/ui/`, duplicate top-level modules).
  - [ ] Remove unused/obsolete frontend artifacts or document why retained.
- [ ] Crash recovery hardening:
  - [ ] Crash-safe persistence verification.
  - [ ] Graceful restart behavior after unexpected failure.
- [ ] Release hardening:
  - [ ] Code signing plan for release binaries.
  - [ ] Installer upgrade/uninstall data migration checks.

## Program and Release Governance

- [ ] Versioned settings/data migrations:
  - [ ] Define schema versioning for settings/history.
  - [ ] Add forward migration and rollback-safe behavior.
  - [ ] Validate migration from older builds in installer and portable paths.
- [ ] Update strategy:
  - [ ] Decide auto-update vs manual update distribution model.
  - [ ] Define update verification and rollback behavior.
  - [ ] Document user-facing update flow and failure recovery.
- [ ] Privacy/legal readiness:
  - [ ] Publish privacy disclosure for OpenAI/Gemini request paths.
  - [ ] Define retention and data-handling policy for local/app logs.
  - [ ] Add consent and transparency copy in-app where needed.
- [ ] Accessibility pass:
  - [ ] Keyboard-only navigation for critical flows.
  - [ ] Focus-state and contrast validation.
  - [ ] Screen reader label coverage for interactive controls.
- [ ] CI release gate automation:
  - [ ] Add fail-fast CI checks (install, compile, smoke, packaging sanity).
  - [ ] Add blocking status checks for release branches.
  - [ ] Require evidence artifacts from CI for release approval.
- [ ] Dependency and supply-chain security:
  - [ ] Dependency pinning strategy for runtime/build dependencies.
  - [ ] Automated vulnerability scanning.
  - [ ] SBOM generation for release builds.
- [ ] Logging/support operations:
  - [ ] Define log schema and retention policy.
  - [ ] Define support bundle format with redaction rules.
  - [ ] Define safe troubleshooting workflow for user-shared diagnostics.
- [ ] Provider outage/rate-limit UX:
  - [ ] Define retry/backoff semantics for `429`/provider outages.
  - [ ] Define user messaging and fallback behavior.
  - [ ] Validate no duplicate/stale state in partial-failure scenarios.
- [ ] Launch governance:
  - [ ] Define explicit launch acceptance criteria.
  - [ ] Assign go/no-go owner and sign-off chain.
  - [ ] Document rollback trigger thresholds and decision process.
