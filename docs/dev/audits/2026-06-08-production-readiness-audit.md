# WhisperClick — Production-Readiness Audit (APP-004)

> Read-only senior-engineer audit at commit `fb7f103`. Evidence-cited (file:line).
> Based on the actual repo + 5 parallel deep reads, with the top S1/S2 claims
> personally re-verified against source. No fixes executed.

## 1. Executive summary (plain English)

The **engine is genuinely fixed** — the freeze that caused "everything bogs down"
is gone and measured (10,000 ms → ~1 ms), the dispatch loop is non-blocking, slow
work is off-thread with proper locks, and the god-function is decomposed. That work
is real and well-tested.

But "is the engine fixed?" was the wrong question to stop on. The bigger truth the
repo reveals: **nobody has proven the whole app works end-to-end, and the part
users actually touch is the least tested thing in the codebase.** The UI is a
single 5,111-line `index.html` (4,666 lines of inline, module-less, *untested* JS)
that secretly owns the most important logic in the app (pre-recording credential/
model gating). The test suite looks impressive (589 blocks, green) but it mocks the
entire record→transcribe→paste pipeline, tests API-key encryption against a fake
reversible cipher, and **excludes the only e2e test from `npm test`**. So green
means "the wiring diagram is intact," not "the product works."

Layer on: a security issue I'd refuse to ship (Gemini API key in the URL query
string, plus tracebacks that can write it to disk), plaintext voice/transcript
retention with a "keep forever" option, three non-shipping platform
implementations (~11k lines) rotting alongside the one that ships, and an
unresolved Dropbox-clobber hazard, and the picture is: **structurally much
healthier than a month ago, but not yet trustworthy as a shippable beta.** The gap
is no longer the engine — it's verification, the frontend, security, and lifecycle.

**Minimum bar for "production-ready enough" (beta):** one real end-to-end proof
that record→transcribe→paste works on a clean machine; the Gemini-key leak fixed;
the frontend gating covered by at least one regression test; sidecar crash-loop and
timer-lifecycle hardened; a privacy decision on stored audio/transcripts.

## 2. Top 10 risks (ranked)

1. **No proof the app works end-to-end.** Every JS test mocks the sidecar at the
   process boundary (`tests/mocks/electron.js`, `main-ipc.test.js:16-35`); the e2e
   is excluded from `npm test` (`jest.config.js:7`) and even when run only checks
   stderr for "FATAL" (`app.e2e.test.js:306-322`). Green ≠ working. **S1.**
2. **The frontend is a 5,111-line untested monolith holding load-bearing logic.**
   `shared/frontend/index.html` (~4,666 JS lines, ~150 functions). `toggleRecording`
   (`:3702-3799`) solely owns pre-record settings-sync + no-key/no-model gating; a
   regression ships invisibly. Zero renderer tests. **S1.**
3. **Security: Gemini API key travels in the URL** (`transcription.py:303`,
   `engine.py` verify_key) and `exc_info=True` logging (`engine.py:231,242`) can
   write the key-bearing URL into `whisperclick.log`. **S2 — refuse to ship.**
4. **Sidecar crash-loop bricks voice for the session.** After 3 non-zero exits the
   app gives up (`main.js:1387-1390`); the counter only resets on a successful
   `ready` (`:1278`), so a startup crash-loop (mic locked, AV scan) permanently
   disables recording until full app restart. **S1.**
5. **Privacy: plaintext voice + transcripts retained indefinitely.** `.ogg` audio
   (`engine.py:191-203`) and full transcripts (`store.js:198`, `history.json`, 500
   entries) are unencrypted at rest; `audioRetentionDays:0` = keep forever
   (`store.js:38`). No disclosure, no encryption. **S2.**
6. **Timer lifecycle leaks + phantom keystrokes.** Many `setTimeout`/`setInterval`
   are never stored/cleared/unref'd: updater interval (`main.js:1249-1250`),
   3 independent "revert to dormant" timers (`:290,1327,1330`), auto-paste/enter
   timers (`:1309-1316`), per-request sidecar timers (`sidecar.js:98-104`). A late
   paste/Enter can fire into another app; a 600s `download_model` timer stalls quit
   up to 10 min. **S2/S3.**
7. **Silent failure surface.** `verify-api-key` swallows backend failure and tells
   the user "valid (offline check)" (`main.js:693-705`); `registerHotkey` swallows
   failure and the caller ignores it (`:414-416,1195`) → headline feature can be
   dead on arrival. Plus 29 empty JS catches / 52 bare Python excepts / 8 empty
   frontend catches, with **zero** `console.*` in the frontend = no diagnostic
   trail. **S2/S3.**
8. **`stop-recording` race + listener leak.** Per-call `sidecar.once(...)`
   listeners (`main.js:738-794`); two overlapping stops leak 4 listeners and the
   second hangs to its 120 s timeout. Broader: check-then-act TOCTOU across awaits;
   the state machine validates transitions but can't serialize concurrent intents.
   **S2/S3.**
9. **JS↔Rust drift is already real.** Tauri `store.rs:108-110` never got the R6
   audio-cleanup that Electron `store.js:162-169` has; encryption is implemented two
   incompatible ways (Electron `safeStorage` vs Tauri `keyring`) — keys saved by one
   can't be read by the other. "Shared" is partly fiction. **S2.**
10. **Dropbox clobber.** The working tree was silently reverted mid-session again
    this run (1,238 deletions); git recovered it each time, but it's an unresolved
    data-integrity hazard for active work. **S2 (needs your decision).**

## 3. Top 10 recommended fixes/refactors (ranked by leverage)

| # | Fix | Why / evidence | Risk·Effort |
|---|-----|----------------|-------------|
| 1 | **Real e2e** that launches the app, drives the renderer, and asserts record→transcribe→paste; un-exclude e2e from the default run | converts most "suspected" to "proven" (`jest.config.js:7`) | M·M |
| 2 | **Gemini key → header**, redact `url` from logged tracebacks | `transcription.py:303`, `engine.py:231` | low·S |
| 3 | **Timer lifecycle**: store every timer, clear on `will-quit`, `.unref()` live ones | `main.js:1249,1309`, `sidecar.js:98` | low·M |
| 4 | **Sidecar crash-loop**: reset counter on a clean window of uptime; surface a real "backend down" state with manual retry | `main.js:1379-1390` | low·S |
| 5 | **Surface silent failures**: `verify-api-key`, `registerHotkey`, the worst empty catches | `main.js:693,414` | low·S |
| 6 | **Extract frontend gating** (`toggleRecording` pre-flight, history, settings) into a testable module + add renderer tests | `index.html:3702` | M·L |
| 7 | **`stop-recording`**: single in-flight guard + shared listener cleanup | `main.js:738-794` | M·M |
| 8 | **Data-at-rest**: fsync on atomic write, multi-generation backup, encrypt or disclose transcript/audio retention | `store.js:71-77`, `engine.py:191` | M·M |
| 9 | **Platform decision**: archive `v3-pywebview` + `frameless-test`; decide Tauri (parity tests or freeze); delete dup `shared/frontend/pill/pill.html` | dates + diffs | low·M |
| 10 | **audio_id collision**: mirror `makeHistoryId` random suffix | `engine.py:199` (low probability — recordings are sequential — but trivial) | low·S |

## 4. Healthy — do NOT touch
- **The engine** (just hardened: non-blocking dispatch, locks, watchdog, decomposed handlers, log cap). 36 tests.
- **`sidecar.js`** — real JSON-protocol tests over real streams; strongest file.
- **`state-machine.js`** — pure-logic, fully tested, and Electron/Tauri copies are in sync today.
- **`store.js` core** — atomic tmp+rename+`.bak` with self-healing read; collision-proof history id.
- **`preload.js` contextBridge** — least-privilege; no raw `invoke`/`fs`/`shell`; keys stripped from `get_settings`.
- **Frontend security** — transcript rendering is XSS-safe (`textContent`/`escapeHtml`), keys scrubbed from localStorage and never logged.
- **git hygiene** — user data lives outside the repo; logs/venv/build ignored.

## 5. Proven by evidence
- Engine freeze fixed: 10,000 ms → ~1 ms (pytest + raw trace).
- e2e excluded from `npm test`; `--forceExit` on (`jest.config.js:7`, `package.json:14`).
- Gemini key in URL (`transcription.py:303`).
- audio_id uses bare ms timestamp (`engine.py:199`).
- Sidecar gives up after 3 restarts (`main.js:1387`).
- Tauri R6 drift + incompatible encryption (`tauri/src/store.rs:108`, `encryption.rs`).
- `v3-pywebview`/`frameless-test` = single-commit dead spikes (git log).
- Frontend has zero automated coverage (no test references its functions).
- safeStorage tested only against a reversible mock cipher (`tests/mocks/electron.js:12-22`).

## 6. Suspected but unproven (needs measurement)
- **Cold-start time** and **hotkey→recording latency** and **stop→text latency** — never measured. The renderer monolith on the UI thread likely adds perceptible jank independent of the engine.
- Real `safeStorage` behavior on a fresh machine (and the Linux no-keyring plaintext fallback, `store.js:91-97`).
- Whether the auto-paste/Enter timers actually misfire into other apps in practice.
- Whether the stop-recording race is hit in real double-click/hotkey use.

## 7. Needs live verification (blocked in this RDP session)
- Real record→transcribe→paste on a clean, local (non-RDP) machine — input streams won't open here (`PaErrorCode -9996`).
- Pill self-heal (R4) and clean-quit / no-orphan (R5) watched on a live window.
- safeStorage encrypt/decrypt against the real OS keychain.

## 8. Electron production-readiness roadmap (phases, not microtasks)

- **Phase 0 — Truth & safety (do first).** Stand up a real e2e (launch app, drive
  renderer, assert the pipeline); un-exclude e2e + drop blind `--forceExit` in CI;
  fix the Gemini-key leak + traceback redaction; fix audio_id. *Exit: we can prove
  the app works and no key hits the wire/disk.*
- **Phase 1 — Reliability hardening.** Timer lifecycle; sidecar crash-loop
  recovery; stop-recording race/listener cleanup; surface verify-key/hotkey
  failures; `get-audio` path containment. *Exit: no silent failures, no leaked
  timers, backend recovers or tells the user clearly.*
- **Phase 2 — Frontend de-risking.** Extract the load-bearing gating + history +
  settings logic from `index.html` into testable modules; add renderer tests; begin
  splitting the monolith. *Exit: the logic users depend on has regression coverage.*
- **Phase 3 — Data & privacy.** fsync + multi-gen backup; encrypt-at-rest or
  disclose audio/transcript retention; retention UX. *Exit: a privacy posture you'd
  put in writing.*
- **Phase 4 — Platform & cleanup.** Archive dead spikes; commit Tauri to parity
  (shared tests) or freeze it; delete the duplicate pill. *Exit: every line carried
  is a line that ships or is intentionally frozen.*
- **Phase 5 — Durability (cross-cutting, your call).** Resolve Dropbox clobber
  (pause-during-session, or move the build artifact step) without violating the
  Dropbox-canonical policy.

## 9. Recommended next autonomous execution packet — "Truth & Safety Net" (APP-005 candidate)

Highest leverage, mostly safe/reversible, converts suspected→proven:
1. **Real renderer-level e2e** driving `index.html` (record flow gating, history
   render, settings) headlessly via CDP with a mocked engine; + a thin real-pipeline
   smoke that needs one local run. Un-exclude e2e from CI.
2. **Gemini key → header + traceback redaction** (security, refuse-to-ship).
3. **audio_id** random-suffix fix (mirror `makeHistoryId`).
4. **Surface** `verify-api-key` and `registerHotkey` failures.
Escalation gates inside this packet: real-audio e2e needs a local session; the
privacy/encryption and platform-archival decisions need your sign-off.

## 10. Unknown unknowns / the better questions

- **What you should have asked:** *"Has anyone proven the whole pipeline works on a
  clean machine recently?"* — No. All confidence is in mocked plumbing. That, not
  the engine, is the real risk.
- **What we're assuming that may be false:** that "tests green" = "app works." It
  means the wiring is intact. And that the frontend is "shared/stable" — it's stable
  but *untested* and owns critical logic.
- **Hidden assumption likely wrong:** that Electron and Tauri "share" everything.
  Secrets and storage already diverge; a user migrating between builds loses keys.
- **What scares me most:** the untested 5,111-line frontend owning `toggleRecording`
  gating with silent catches and no logging — regressions there are invisible.
- **Overbuilt:** three non-shipping platforms (~11k lines: Tauri ~9k + pywebview +
  frameless-test) and the 2,800-line stress/torture suite that mostly proves "the
  mock survived a loop."
- **Underbuilt:** real end-to-end testing, any frontend testing, performance
  measurement, and privacy controls.
- **One more day for quality:** build the real e2e — it would reclassify most of
  this audit from "suspected" to "known."
- **Refuse to ship until fixed:** Gemini key in URL/traceback; and at least one real
  proof the pipeline works on a clean machine.
- **Safe to leave alone:** the engine, sidecar, state machine, store core, preload,
  and the frontend's security posture.
