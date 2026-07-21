# WhisperClick Electron — State Machine Refactor

## What This Is

WhisperClick is a desktop voice-to-text app that turns speech into text anywhere on screen via a global hotkey. This milestone focuses on refactoring the implicit state management into a formal state machine with a single source of truth, eliminating the category of state desync bugs that caused 6 patches in v2.1.0–v2.1.2.

## Core Value

Every recording action flows through one gate, one state machine, one source of truth — so state desync bugs cannot happen.

## Requirements

### Validated

- ✓ State machine module with defined states, transitions, guards — Phase 1
- ✓ Single input gate (canAcceptAction) replaces 5 debounce layers — Phase 2
- ✓ Frontend debounces consolidated to single 200ms click guard — Phase 2
- ✓ Sidecar _recording flag auto-recovers instead of erroring — Phase 2
- ✓ Tightened transition table (invalid transitions rejected) — Phase 2
- ✓ Dev file logging (debug.log + console) — Phase 2

### Active

- [ ] Pill as dumb terminal — zero local state, render payloads from main
- [ ] Frontend state simplification — remove isRecording/isProcessing, derive from state-update events
- [ ] Event-driven transitions — replace timer-based with event acknowledgment + fallback

### Out of Scope

- React/framework rewrite of frontend — too much risk for a state refactor
- Sidecar protocol changes — JSON stdin/stdout works, don't touch it
- New features (streaming, premium) — this is pure refactor, no behavior changes
- V3 frontend JS logic changes beyond state management — keep V3 portable

## Context

- **Branch:** `feature/state-machine` off main (v2.1.2)
- **Tests:** 460 passing (48 state machine + 412 existing)
- **Design doc:** `docs/dev/state-machine-refactor.md`
- **Codebase map:** `.planning/codebase/` (7 docs, 2,863 lines)
- **Bug history:** 6 state bugs in v2.1.0–v2.1.2 (pill disappearing, phantom clock, already recording, cancel blocked, state stuck on success, dormant overriding enter)
- **Current state:** Phases 1-2 complete. State machine module exists, single input gate works, transitions tightened. Remaining work is making pill and frontend use the state machine as sole authority.

## Constraints

- **No behavior changes**: User experience must be identical before and after refactor
- **Test coverage**: All 460 tests must pass after every phase, no regressions
- **Incremental**: Each phase is independently mergeable to main
- **V3 compatibility**: Frontend still uses `window.pywebview.api` pattern through preload shim

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Permissive transitions in Phase 1 | Avoid breaking existing code during migration | ✓ Good — tightened in Phase 2 |
| recording→success allowed | Sidecar can send transcription before stop_rec completes | ✓ Good — matches real-world edge case |
| Force-reset wrapper removed | Invalid transitions should fail, not silently recover | ✓ Good — exposed 50 test failures that revealed real assumptions |
| canAcceptAction checks state before sidecar | "Not recording" is more accurate than "backend not ready" when state is wrong | ✓ Good — clearer error messages |
| Stop gate doesn't check sidecar | Sidecar crash during recording must allow stop for cleanup | ✓ Good — prevents stuck state |
| Frontend canRecordNow() kept | UI affordance (shows settings drawer), not a state guard | — Pending |

---
*Last updated: 2026-03-20 after Phase 2 completion*
