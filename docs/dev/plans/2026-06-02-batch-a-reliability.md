# Batch A — Reliability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Fix the localized causes of WhisperClick's three reported symptoms — stale-mic
recording stall (R1), vanishing pill (R4), orphaned/duplicate engine processes (R5, R10)
— without the structural engine rewrite (Batch B).

**Architecture:** Targeted, reversible, test-first fixes. R1 adds a pure
device-resolution function in the Python engine (validate the stored mic vs the live
device list; fall back to the system default instead of a stale index that hangs
PortAudio). R4/R5/R10 add a pill reconciler + crash recovery and guaranteed child reaping
+ a startup orphan sweep in the Electron main process.

**Tech Stack:** Python 3.12 + `sounddevice` (engine, new `pytest` harness), Node/Electron
+ Jest (desktop). Source of truth: `docs/dev/audits/2026-06-02-phase6-synthesis-register.md`.

---

## File structure

| File | Change |
|------|--------|
| `shared/engine/backend/audio_recorder.py` | add `resolve_input_device()`, call it in `start()` |
| `shared/engine/tests/test_audio_recorder.py` | create |
| `shared/engine/requirements-dev.txt` | create (`pytest`) |
| `platforms/electron/sidecar.js` | synchronous force-reap; expose `pid` |
| `platforms/electron/orphan-sweep.js` | create (startup sweep) |
| `platforms/electron/main.js` | pill reconciler + crash recovery; call orphan sweep; force-stop on quit |
| `tests/unit/sidecar.test.js`, `tests/unit/main-ipc.test.js`, `tests/unit/orphan-sweep.test.js` | tests |

---

## Task 0 — Establish version control (DONE 2026-06-02)
Moved validated `.git` into the Dropbox working copy (non-destructive), committed the
audit deliverables, branched `fix/batch-a-reliability`. No push.

## Task 1 — Python test harness (prereq for R1)
`requirements-dev.txt` (`pytest>=8.0`); install into the engine venv; add a smoke test;
`python -m pytest tests/test_smoke.py -v` → 1 passed; commit.

## Task 2 — R1 pure device-resolution function (test-first)
`resolve_input_device(stored_id, devices)` returns a known-valid input index or `None`
(system default). Tests cover: None→default, valid index kept, output-only index→default,
out-of-range→default, negative→default, empty list→default. Implementation:
```python
def resolve_input_device(stored_id, devices):
    if stored_id is None:
        return None
    if not isinstance(stored_id, int) or stored_id < 0 or stored_id >= len(devices):
        return None
    if devices[stored_id].get("max_input_channels", 0) < 1:
        return None
    return stored_id
```

## Task 3 — R1 wire into AudioRecorder.start()
Resolve before opening; if invalid, log a warning and use the default (never pass a stale
index). Tests: stale stored id → `InputStream(device=None)`; valid id → `device=id`.
Follow-up (Batch C): also store the device *name* to re-resolve a reordered mic by name.

## Task 4 — R5 guarantee child reaping
`Sidecar.stop({force})` synchronous kill + `pid` getter; `main.js` quit path uses
`stop({force:true})`. Tests via the existing `fakeProc`/`spawn` harness.

## Task 5 — R10 startup orphan sweep
New `orphan-sweep.js` `sweepStaleEngines({keepPid, platform})` — Windows: `tasklist` for
`engine.exe`, `taskkill /F` all but `keepPid`; no-op elsewhere. Call before
`sidecar.start()`. Tests mock `child_process.execFile`.

## Task 6 — R4 pill self-heal
Extract `ensurePill()` (showPill = enforced source of truth); reconciler `setInterval`
(~4 s) + `render-process-gone` recovery on the pill window. Test recreation when missing
while `showPill` is true. **REQUIRED: UI-readiness proof** — run the app, force a pill
loss (kill pill renderer / display change), confirm it reappears within ~5 s without
toggling; screenshot before/after.

## Final
Full Jest suite (allow the 2 known-flaky), full pytest suite, summarize for Edward with
the R4 screenshot. **No push without his OK.**

> **Durability note:** recreated after a Dropbox-sync glitch lost the original; committed
> to git immediately. Commit fix outputs promptly so eviction can't lose them.
