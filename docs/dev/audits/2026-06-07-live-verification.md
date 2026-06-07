# Live verification pass — 2026-06-07

> Authorized dev-copy run (installed app untouched). Engine exercised directly
> via its stdin/stdout protocol on Edward's real machine; unit suite run on the
> restored working tree. Evidence for "are the fixes real."

## Environment / safety

- Installed WhisperClick was running (5 processes) — **not touched**.
- Engine run from the repo's dev `.venv` (had to add `openai`, `soundfile` — venv
  was incomplete and the engine couldn't boot without them).
- Electron dev isolation confirmed required: a plain `npm start` would share the
  installed app's single-instance lock (data dir `…\WhisperClick` vs `…\whisperclick`
  collide on case-insensitive Windows) and focus the running window via the
  `second-instance` handler. A throwaway `--user-data-dir` is mandatory for the
  GUI step.

## Results

| Item | Method | Result |
|------|--------|--------|
| **R2 head-of-line freeze** | piped `verify_key`(unreachable host) then `ping` | **CONFIRMED, NOT FIXED.** Baseline `ping` = 0 ms. With one slow command in flight, the same `ping` was stalled **10.0 s** — the dispatch loop is frozen until the slow command returns. |
| **R1 stale-mic fallback** | `resolve_input_device` vs real device list | **PASS.** Invalid stored id `9999` → `None` (safe default), valid id passes through. The fix holds against real hardware. |
| **Batch A + store fixes** | `jest tests/unit/` on restored tree | **392/392 pass**, 13 suites. (1 teardown-leak warning — test hygiene, not a failure.) |
| **R9 unbounded engine log** | read `engine.py:26-29` | **CONFIRMED OPEN.** Engine redirects its own stderr to `~/.config/whisperclick/engine.log` as an unbounded `open(..,"a")` — no rotation. (Corrects an earlier mistaken "resolved" note; the Electron logger rotates, but the engine's own redirect does not.) |

## Read map: what's confirmed vs still bench-only

- **Confirmed live:** R2 (real, measured), R1 (real hardware), all unit logic (392).
- **Bench-tested only (need the GUI window):** R4 pill self-heal (visual), R5 engine
  actually reaped on quit (process-level). Their unit tests pass; not yet watched live.

## Reproduce

- R2: `shared/engine/.venv/Scripts/python.exe %TEMP%\wc-r2-probe.py`
- R1: `shared/engine/.venv/Scripts/python.exe %TEMP%\wc-r1-probe.py`
