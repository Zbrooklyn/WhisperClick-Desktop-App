# Post-Mortem: WhisperClick State Machine Refactor

> Period: 2026-03-17 through 2026-03-20
> Branch: `feature/state-machine` (Phases 1-5) + `main` (v2.1.0-v2.1.2 hotfixes)
> Author: Claude Opus 4.6 + Edward Shamosh

---

## Context

The v2.1.0 release shipped Auto-Enter mode (3 modes: Off, Button, Auto), pill widget
stability fixes, website updates (og:url, support section), and documentation (Getting
Started guide, FAQ, marketing content). The Auto-Enter feature exposed deep state
management issues that cascaded into 6 patches and motivated a full state machine refactor.

---

## Timeline

| Date | Time | Event | Type |
|------|------|-------|------|
| 03-17 | 20:52 | v2.1.0 shipped: Auto-Enter, pill fixes, website, docs | Release |
| 03-17 | 22:43 | Fix: recording allowed from success state, reset on failure | Bug → Fix |
| 03-17 | 22:47 | v2.1.1: "Already recording" hotfix | Release |
| 03-18 | 01:17 | Docs updated to v2.1.1 across all files | Docs |
| 03-18 | 15:52 | v2.1.2: Cancel button unblocked during processing | Release |
| 03-18 | 16:25 | Design doc created, refactor planned (5 phases) | Planning |
| 03-18 | 17:22 | Phase 1: State machine module (48 tests) | Refactor |
| 03-19 | 20:02 | Double-start root cause found via debug logs | Debugging |
| 03-20 | 00:48 | Phase 2: Single input gate (first attempt — claimed done) | AI Failure |
| 03-20 | 00:55 | User: "is phase 2 100%?" — found 3 layers untouched | User Correction |
| 03-20 | 01:05 | Phase 2: Frontend debounces + sidecar auto-recovery | Refactor |
| 03-20 | 01:31 | Phase 2: stop-recording added to gate | Refactor |
| 03-20 | ~09:00 | GSD + BMAD frameworks installed | Tooling |
| 03-20 | 10:14 | GSD codebase mapping (4 agents, 7 docs, 2863 lines) | Tooling |
| 03-20 | 10:25 | GSD project init + requirements + roadmap | Tooling |
| 03-20 | 10:47 | Phase 3 plan created, verified, revised by GSD agents | Planning |
| 03-20 | 11:19 | Phase 3 executed by GSD agents (4 commits, pill refactored) | Refactor |
| 03-20 | ~11:30 | AI falsely claimed Phase 3 "was already done" | AI Failure |
| 03-20 | 12:10 | Phase 4: Frontend state simplification (direct, no GSD) | Refactor |
| 03-20 | ~13:00 | Phase 5: ack-state IPC + timer guards (39 test failures initially) | Refactor |
| 03-20 | ~13:30 | afterEach ack-state made failures worse (28 failures) | AI Failure |
| 03-20 | 13:48 | Phase 5: Reverted stress test changes, all 460 pass | Refactor |
| 03-20 | 14:49 | Post-mortem v1 committed (incomplete, errors found on review) | AI Failure |
| 03-20 | ~15:00 | Post-mortem v2 — verified against git history | Docs |

---

## Bugs Encountered

### B1: Pill widget disappearing (v2.1.0)
- **Symptom:** Pill vanished after extended use
- **Root cause:** `broadcastState()` and `broadcastLevel()` sent messages to destroyed pill window without `isDestroyed()` guards. Settings toggle didn't check `isDestroyed()`. Pill created with `show: true` (flash on creation).
- **Fix:** Added isDestroyed guards, `show: false` on creation, repositioning on every show.
- **Category:** Missing null checks on window lifecycle

### B2: Phantom clock running on window reopen (v2.1.0)
- **Symptom:** Timer showed counting up when app reopened, even though nothing was recording
- **Root cause:** No `broadcastState()` fired on window `show`/`restore` events. Frontend kept stale timer from previous session.
- **Fix:** `broadcastState()` on show/restore, dormant handler always clears timer, `clearInterval` before every `setInterval`.
- **Category:** Missing state sync on window visibility changes

### B3: EPIPE crash dialog in dev mode (v2.1.0)
- **Symptom:** Crash dialog from auto-updater's `console.info` when parent terminal closed
- **Root cause:** Broken pipe on stdout/stderr when parent process closes — unhandled EPIPE error
- **Fix:** `process.stdout?.on('error', ...)` suppresses EPIPE
- **Category:** Unhandled error in dev environment

### B4: Tooltip lingering after interactions (v2.1.0)
- **Symptom:** CSS `:hover` tooltip stayed visible after clicking the pill
- **Root cause:** `:hover` persists even after capsule resizes/transitions
- **Fix:** Force `display: none` on tooltip during all non-dormant states
- **Category:** CSS hover state not cleared by DOM changes

### B5: App state stuck on success in button mode (v2.1.0)
- **Symptom:** `appState` stayed `'success'` forever in Auto-Enter button mode
- **Root cause:** Dormant transition timer was skipped entirely in button mode to keep enter button visible. State never transitioned back.
- **Fix:** Dormant transition always happens, just delayed to 6s in button mode
- **Category:** Timer-skip logic breaking state lifecycle

### B6: "Already recording" error after transcription (v2.1.1)
- **Symptom:** Couldn't start new recording for 1.5-6 seconds after transcription
- **Root cause:** `appState === 'success'` during the post-transcription window. `validateRecordingReadiness()` treated anything non-dormant as "already recording."
- **Fix:** Allowed recording from `success` state. Reset state to dormant on start_rec failure.
- **Category:** State transition gap — success not treated as idle-equivalent

### B7: Cancel button (X) not working during processing (v2.1.2)
- **Symptom:** Clicking X during processing did nothing
- **Root cause:** 900ms `nextAllowedToggleAt` debounce after stopping blocked all clicks, including cancel. The debounce didn't distinguish between start/stop/cancel.
- **Fix:** Bypass debounce when `isProcessing` is true.
- **Category:** Overly broad debounce

### B8: "Already recording" from double-click — permanent stuck state (found 03-19)
- **Symptom:** App permanently stuck — every recording attempt fails
- **Root cause:** 3-5 second delay between `pill-toggle-recording` IPC and actual `start-recording` IPC. User clicks pill twice during delay. First click starts sidecar recording. Second `start-recording` arrives → sidecar says "Already recording" → main resets to dormant → but sidecar is still recording. Permanent desync.
- **Fix (Phase 2):** `canAcceptAction('start')` rejects if already recording. Sidecar auto-recovers stale recording instead of erroring.
- **Category:** Race condition from async IPC delay + independent state tracking

### B9: Phase 1 force-reset made state desync worse
- **Symptom:** State machine compatibility wrapper forced `recording → recording` by bouncing through dormant
- **Root cause:** `sm.reset()` + `sm.transition()` hack created visible state bounce that confused the sidecar
- **Fix (Phase 2):** Removed force-reset. Invalid transitions rejected. `canAcceptAction` prevents them.
- **Category:** Compatibility hack creating worse behavior

### B10: `isVisible()` missing from Electron mock
- **Symptom:** Tests failed after adding `mainWindow.isVisible()` call in pill creation
- **Root cause:** The test mock (`tests/mocks/electron.js`) didn't have `isVisible` method
- **Fix:** Added `this.isVisible = jest.fn(() => !this._destroyed)` to mock
- **Category:** Test mock incomplete

---

## AI Failures

### AF1: Claimed Phase 2 done with 3 of 5 debounce layers untouched
- **What happened:** Reported Phase 2 as 100% complete after building `canAcceptAction()` and tightening transitions. User asked "is phase 2 100%?" — found 3 frontend debounce layers plus sidecar `_recording` flag not addressed.
- **Why:** Validated against what I built, not against the spec. The design doc said "replace 5 debounce layers" — I replaced 2 and declared done.
- **Impact:** User had to push twice to actually finish.
- **Lesson:** Validate against the spec line by line before claiming done.

### AF2: Restarting app as "fix" for stuck state
- **What happened:** When user reported "already recording" error, my first response was to kill and relaunch instead of investigating root cause.
- **User correction:** "Relaunching doesn't solve the problem if you're not fixing the edge case within the code."
- **Impact:** Delayed finding the actual root cause.
- **Lesson:** Restart is not a fix. Investigate root causes. Add logging first if needed.

### AF3: GSD framework overhead for known work
- **What happened:** Installed GSD, ran codebase mapping (4 agents, 7 docs), project init, requirements, roadmap, phase planning, plan verification, plan revision. User asked "why is this taking so long?"
- **Nuance:** GSD's Phase 3 agents DID execute useful work (4 commits refactoring pill.html). The framework wasn't entirely wasteful — but the setup ceremony (mapping, init, requirements, roadmap) was overhead since we already had a design doc and deep context.
- **Lesson:** Frameworks solve specific problems. Evaluate whether the problem exists before applying the framework. For mid-session refactors with deep context, direct execution beats ceremony.

### AF4: Falsely claimed Phase 3 "was already done"
- **What happened:** When I read `pill.html` after the GSD agents ran, I said "Phase 3 is already done — the pill is already stateless. The GSD framework planned existing work." In reality, the GSD executor agents had just refactored it (4 commits: `44bb093`, `57d0553`, `938e6b2`, `7a63c8d`).
- **Why:** I didn't check git history. I read the current file state and assumed it was pre-existing.
- **Impact:** Took credit for work I didn't do. Unfairly blamed GSD for planning "existing work."
- **Lesson:** Check `git log` before claiming something was already done. Current state ≠ original state.

### AF5: Tried to delegate test fixes to agent — user rejected
- **What happened:** Phase 2 had 50 test failures. I tried to spawn a sub-agent to fix them all. User rejected the agent call.
- **Why:** Wanted to parallelize work. But the test fixes needed understanding of each test's purpose — not a bulk delegation.
- **Lesson:** Understand the work before delegating. Complex test fixes need contextual understanding.

### AF6: Installed app blocking dev instance (recurring)
- **What happened:** Multiple times, `npm start` silently failed because the installed production WhisperClick had the single-instance lock.
- **Impact:** Each occurrence required manual investigation + kill production app.
- **Lesson:** Check for running WhisperClick/electron processes before every launch.

### AF7: Phase 5 afterEach ack-state made test failures worse
- **What happened:** Added `afterEach` that called `ack-state` to clean up transient states between tests. This disrupted test state for tests that relied on specific state ordering, increasing failures from 13 to 28.
- **Why:** Applied a broad fix without understanding how individual tests used state.
- **Lesson:** Global test hooks that modify state are dangerous. Fix individual tests instead.

### AF8: Bulk test find-and-replace broke stress tests
- **What happened:** Replaced all `tick(3500)` in stress tests with `ack-state` calls. Some tests were testing the timer fallback itself, not just waiting for it. Had to revert all changes.
- **Impact:** 30+ minutes debugging self-inflicted test failures.
- **Lesson:** Understand what each test is testing before changing it.

### AF9: False confidence on test count across docs
- **What happened:** Multiple documents claimed different test counts (294, 261, 412, 460). The plan checker caught the mismatch.
- **Lesson:** Use "all tests pass (npm test exits 0)" instead of hardcoding numbers.

### AF10: Post-mortem v1 committed without verification
- **What happened:** Wrote post-mortem and committed it without verifying content against git history. User asked "did you test it?" — I hadn't. Then asked "is the postmortem 100%?" — it wasn't. Found multiple errors including AF4 (Phase 3 attribution), missing bugs, missing AI failures.
- **Lesson:** The post-mortem about verification failures was itself not verified. Apply the same rigor to documentation as to code.

---

## User Corrections That Changed Approach

### UC1: "Is Phase 2 100%?"
- **Effect:** Forced validation against actual spec. Led to completing remaining 3 debounce layers + sidecar auto-recovery.

### UC2: "Relaunching doesn't solve the problem if you're not fixing the edge case"
- **Effect:** Forced root cause investigation. Led to debug logging system + discovery of double-start race condition.

### UC3: "Why is this taking so long?" (re: GSD)
- **Effect:** Honest assessment that GSD was adding overhead. Led to direct execution for Phases 4-5.

### UC4: "Don't you already have everything you need?" (re: GSD discuss-phase)
- **Effect:** Skipped unnecessary discussion phase. Deep context made it redundant.

### UC5: "This is an existing project" (re: GSD questioning)
- **Effect:** Short-circuited GSD's greenfield questioning flow.

### UC6: "Just do it" (re: GSD execute-phase)
- **Effect:** Rejected GSD executor agent spawn. Led to direct Phase 4 implementation in ~15 minutes.

### UC7: Rejected agent call for test fixes
- **Effect:** I fixed the 50 test failures myself instead of delegating, which required understanding each test's purpose.

### UC8: "Did you test it?" + "Is the postmortem 100%?" (re: this document)
- **Effect:** Found the post-mortem itself had errors — Phase 3 attribution wrong, missing bugs, missing AI failures. Meta-lesson: apply verification to everything.

### UC9: Sharing AI Coding Frameworks guide
- **Effect:** Introduced GSD/BMAD/Task Master frameworks. Led to adopting GSD for structured execution. Even though GSD added overhead this session, the framework knowledge is valuable for future multi-session projects.

---

## What Worked Well

1. **Debug logging** — Adding file + console logging in dev mode immediately revealed the double-start root cause. `debug.log` showed the exact sequence: two `start-recording` IPCs 1 second apart.
2. **State machine module** — Clean separation with defined transitions. Every state change logged with from/to. Invalid transitions rejected and logged as errors.
3. **Single input gate** — `canAcceptAction()` eliminated an entire category of bugs. 7 entry points go through one check.
4. **Sidecar auto-recovery** — Changing `_recording` from hard error to cancel-and-restart eliminated the permanent stuck state.
5. **Incremental phases** — Each phase independently verifiable. When Phase 5 broke tests, `git stash` confirmed Phase 4 was clean.
6. **460 tests as safety net** — Caught every regression immediately.
7. **User skepticism** — "Is it 100%?" caught incomplete Phase 2. "Did you test it?" caught unverified post-mortem.
8. **GSD Phase 3 execution** — The GSD agents successfully refactored pill.html (4 commits, -105 lines). Despite overhead criticism, the actual execution worked.
9. **Plan checker** — Caught 3 critical issues in Phase 3 plan (cancel behavior divergence, wrong payload contract, wrong test count).

## What Didn't Work

1. **Claiming done without spec validation** — Phase 2 false completion was the biggest process failure.
2. **Force-reset compatibility wrapper** — Phase 1 hack that made Phase 2 bugs worse.
3. **GSD ceremony for mid-session work** — Codebase mapping + project init + requirements + roadmap was overhead when we had deep context. The execution was fine; the setup was wasteful.
4. **Bulk test find-and-replace** — Broke more than it fixed. Each test needs individual understanding.
5. **Timer-based state transitions as primary mechanism** — The original 1.5s/3s/6s timers created windows where state was wrong. Every timing window was a bug waiting to happen.
6. **Post-mortem without verification** — Committed a document with factual errors (Phase 3 attribution, missing items).
7. **Restart-as-debugging** — Relaunch hides root causes instead of fixing them.

---

## Metrics

| Metric | Value |
|--------|-------|
| Releases shipped | 3 (v2.1.0, v2.1.1, v2.1.2) |
| Bugs found and fixed | 10 |
| Refactor phases completed | 5 |
| Tests at start | 412 |
| Tests at end | 460 (+48 state machine tests) |
| Total commits (feature branch) | 17 |
| Total commits (main hotfixes) | 6 |
| AI failures documented | 10 |
| User corrections that changed approach | 9 |
| Post-mortem revisions needed | 2 (v1 had factual errors) |
| Files modified | 12+ (main.js, state-machine.js, logger.js, preload.js, preload-pill.js, index.html, pill.html, engine.py, + test files + docs) |

---

## Lessons for Future Refactors

1. **Validate against the spec, not your mental model.** Read the spec line by line before claiming done.
2. **Check current state before planning changes.** `git log` and `grep` before spawning planners.
3. **Frameworks are tools, not processes.** Evaluate whether the problem they solve exists in your context.
4. **Restart is not a fix.** Add logging, investigate root causes.
5. **Understand tests before changing them.** Each test tests something specific. Global hooks that modify state are dangerous.
6. **Timer-based state transitions are fragile.** Event-driven with timer fallback is strictly better.
7. **Single source of truth eliminates a category of bugs.** Multiple state trackers will always desync.
8. **User skepticism is a feature.** "Is it really done?" is the most valuable question anyone can ask.
9. **Verify documentation the same way you verify code.** Check against git history, not memory.
10. **Check `git log` before claiming something was pre-existing.** Current state ≠ original state.

---

*Document created: 2026-03-20 (v1)*
*Revised: 2026-03-20 (v2) — verified against git history, corrected Phase 3 attribution, added missing bugs/failures*
*Project status: All 5 phases complete, 460/460 tests passing, ready to merge*
