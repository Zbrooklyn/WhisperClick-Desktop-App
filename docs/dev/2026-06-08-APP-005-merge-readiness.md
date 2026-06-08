# APP-005 Truth & Safety Net — merge-readiness summary

**Branch:** `fix/batch-a-reliability` (private dev remote: `whisperclick-dev`)
**Status:** Code + automated proof complete and green. **Not** merged to main; **not** released. One gate open: live real-audio verification on Edward's machine.
**Date:** 2026-06-08

---

## One-line

WhisperClick's Electron path was hardened for production: API keys out of URLs + redaction, honest failure surfacing, a real renderer-driven e2e suite (mocked engine) covering every recording outcome, and a set of reliability fixes — all backed by tests, with the previously-flaky JS suite made deterministic.

## Test baseline (fresh, this commit)

| Suite | Result |
|---|---|
| Jest (unit + integration + stress) | **625 passed / 625**, 17 suites |
| Renderer e2e (real app, mocked engine) | **16/16 checks** |
| Engine pytest | **47 passed, 1 skipped** |

The Jest suite is now deterministic — previously it failed intermittently under full-suite load (torture/stress timing). Verified across 5 consecutive clean full runs after the fix.

## What changed, by packet

**(1) Security stop-ship**
- API keys moved out of the request URL into headers (`6fa3c79`) — no key in query strings/proxy logs.
- Single tested `redact_key()` helper scrubs keys from all three key-bearing HTTP error paths (`86345db`, `9ef3872`); mutation-verified.

**(2) Low-risk correctness**
- Collision-proof `audio_id` (`79c701a`).
- `verify-api-key` no longer reports false success on a backend error; hotkey registration failures now surface (log + notification) (`79c701a`, `e616987`).

**(3) Real renderer-driven e2e** (real main process + real 5,111-line renderer + real IPC/store; mocked Python engine)
- Critical flow: record → transcription → history (`b3d8435`).
- Persistence across a real process restart: history + settings (`07339af`).
- Error path via mock fault injection (`0431c2e`).
- Spontaneous-error path (`6edaa73`) and cancel path (`1e5638d`).
- Outcome matrix now complete: **success / error / spontaneous-error / cancel.**

**(4) Reliability**
- Sidecar per-request timeout timers cleared + unref'd (`f25e972`).
- Sidecar crash-loop recovery: bounded fast restarts → cooldown recovery → give-up (`bdf4a66`).
- Background updater timers unref'd + cleared on quit (`4311df6`).
- Silent store corruption / data-loss now logged (`241c5a5`).
- Stop-recording race: investigated, **verified a non-bug** (state gate is synchronous, single-threaded) — no fix fabricated.
- Listener-leak: already covered (50 start/cancel + 50 stop cycles assert no accumulation).
- Cross-platform-safe surfacing of spontaneous engine errors in the shared frontend, no Tauri code touched, no double-toast (`6edaa73`).

(Earlier engine-spine work R1–R10 — non-blocking dispatch, off-thread recording, log rotation, orphan-sweep safety, pill self-heal — also lives on this branch from APP-002/003.)

## Verified vs. needs live verification

**Verified (automated):** security (keys/redaction), correctness (audio_id/verify-key/hotkey), the full record→transcription→history *wiring*, persistence across restart, error/cancel handling, reliability timers/recovery, suite determinism. Plus a real-engine smoke test on Edward's hardware: engine boots, enumerates real mics, clean exit, no orphan.

**Needs live verification (Edward's machine — the open gate):** real microphone capture, real transcription accuracy, OS paste/Enter injection, the pill under real use, real hotkey under the global shortcut, and end-to-end lag. The e2e proves the plumbing with a mocked engine; it does not prove real speech→text on hardware.

## Risk assessment for merge

- **Scope:** Electron path + shared engine/frontend. Tauri (alpha) untouched. Public mirror untouched.
- **Reversibility:** all changes are additive hardening + tests; no destructive migrations.
- **Residual risk:** the live audio path is unproven by automation (inherent — needs hardware). Recommend the ~3-minute live checklist below before merge.

## Recommendation

Hold merge until the live real-audio run passes. After that, `fix/batch-a-reliability` → main is low-risk and well-evidenced. No release until Edward authorizes.

### Live checklist (Edward)
1. Quit installed WhisperClick (tray → Quit).
2. `git checkout fix/batch-a-reliability` → `npm start`.
3. Settings → API → paste OpenAI key → verify.
4. Focus a text box; hotkey, speak, hotkey to stop.
5. Confirm: hotkey / mic / record speed / stop / transcription / paste / history / pill / clean quit / no orphan / no lag.
