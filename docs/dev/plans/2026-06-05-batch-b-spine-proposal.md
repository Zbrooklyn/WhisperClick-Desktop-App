# Batch B — Fix the Spine (R2/R3/R7/R8) — Readiness Proposal

> Static design homework for Batch B, the structural reliability lever from the
> Phase-6 register. **Implementation is gated** — see "Two gates" below. This doc
> is design + evidence only; no engine behavior is changed by landing it.

## Why this exists

Batch A (R1 device resilience, R4 pill self-heal, R5 child reaping, R10 startup
orphan sweep) is complete and verified at the unit level, plus extensions
(R6 audio-on-rollover, history duplicate-id data-loss fix, main-window crash
recovery, restored encryption-at-rest + cache-resilience coverage). The next
lever in the register is Batch B — the *spine*: the single serialized engine
pipe whose synchronous commands block each other (R2), with no in-engine
timeout (R3). Per the Phase-6 decision, Batch B follows a **live under-load
capture** to quantify head-of-line blocking first.

## The defect, with evidence

`shared/engine/engine.py:main()` (line 587) reads stdin line-by-line and calls
`handle_command(msg)` **synchronously on the same thread** (line 591–597). One
thread both *reads* commands and *executes* most of them. Any handler that does
blocking I/O freezes every later command until it returns.

The heavy transcription path is already correctly off-thread (good): `stop_rec`
spawns `_do_transcribe` (engine.py:419), `download_model` spawns a worker
(engine.py:465), and `start_rec` spawns the level-poll thread (engine.py:389).
The threading pattern exists — it was just applied ad-hoc to the handlers
someone noticed were slow.

**Handlers that still block the dispatch thread:**

| Command | Blocking call | Worst-case | Evidence |
|---------|---------------|-----------|----------|
| `start_rec` | `recorder.start()` → PortAudio stream open | **unbounded** (stale device) | engine.py:387 |
| `translate` | `transcriber.translate()` (HTTP) | up to ~30 s | engine.py:444 (timeout in transcription.py:410) |
| `verify_key` | `urlopen(..., timeout=10)` | up to 10 s | engine.py:542 |
| `list_mics` | `AudioRecorder.list_devices()` device enum | can stall | engine.py:360 |
| `stop_rec` | `_level_thread.join(timeout=2)` | up to 2 s | engine.py:409 |
| `configure` | `_cleanup_expired_audio()` disk scan (R7) | grows with audio dir | engine.py:312 |

**Felt impact:** while any of these runs, the engine processes *nothing else* —
not a new recording, not `cancel`, not `stop`. Verifying a key or translating
freezes the app for up to 10–30 s; a stale-device `start_rec` can freeze it
indefinitely (the "minute to record"). This is R2 head-of-line blocking, and the
network timeouts (R3, present in `transcription.py`) don't help because the block
is on the one dispatch thread, not inside the call.

## Design options

**Option 1 — Reader/worker split with a control lane.** The stdin reader only
parses + enqueues. A worker drains the queue and runs handlers; a fast control
lane (`cancel`/`stop_rec`/`ping`/`quit`) is processed immediately so it preempts
a long-running work command. Requires a lock around the `recorder` / `_recording`
shared state. Cleanest, fully fixes R2. Effort **L**.

**Option 2 — Thread-per-blocking-handler (extend the existing pattern).** Wrap
each blocking handler (`translate`, `verify_key`, `list_mics`) in a daemon thread
like `_do_transcribe`/`_do_download_model` already are, so the reader returns
immediately. Add a watchdog/timeout on `recorder.start()`'s device open (the one
*unbounded* call, R3). Needs a lock so a threaded `translate` can't race the
transcriber against an active transcribe. Simpler, reversible, removes the felt
stalls; no ordered control-lane preemption. Effort **M**.

**Option 3 — asyncio rewrite of the dispatch loop.** Best long-term concurrency
model, biggest blast radius — rewrites the engine's whole I/O spine. Effort
**L+**. Not recommended now.

Cross-cutting regardless of option: **R3** — guard `recorder.start()`'s device
open with a timeout/watchdog (currently the only unbounded call). **R7** — move
`_cleanup_expired_audio()` off the dispatch path. **R8** (Electron-side, separate
from engine concurrency) — have the main process call the engine `start_rec`
directly after the input gate approves, instead of bouncing through the renderer.

## Recommendation

**Option 2** as the pragmatic first structural cut: lowest risk, reversible,
directly removes the felt network/device stalls, and reuses a pattern already in
the codebase — with a recorder/transcriber lock to make the new concurrency safe,
plus the `start_rec` device-open watchdog (R3). Reserve Option 1's full
control-lane preemption only if the live capture shows ordering still hurts under
load. This honors simple-first + reversible execution.

**This recommendation is conditional on the live under-load capture** Edward
sequenced — that capture will show which blocker actually dominates (almost
certainly the R1 `start_rec` device stall = the "minute"), which determines
whether Option 2 alone suffices.

## Two gates (why this is not autonomous)

1. **Edward's pre-condition (recorded, Phase-6 register line 66):** a live
   under-load capture with debug logging *before* Batch B. That requires running
   the app under load. I am explicitly instructed not to touch / drive the
   installed running app without approval, so this step needs either Edward to
   run it, or his authorization for me to drive a *dev* instance.
2. **Architecture decision:** Batch B is L-effort and changes the engine's
   concurrency model (multiple valid directions above). That crosses the
   escalation boundary for "major architecture decision."

## Asks

1. Pick the capture path: **(a)** you run the app under load with debug logging
   and share `whisperclick.log`, or **(b)** authorize me to drive a dev instance
   under load to capture it (the installed app stays untouched).
2. Pick a direction (Option 1 / 2 / 3) — or defer until the capture is in.
