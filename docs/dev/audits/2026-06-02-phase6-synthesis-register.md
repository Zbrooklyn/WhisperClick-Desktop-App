# Phase 6 — Synthesis & Ranked Issue Register

> Audit complete (Phases 0–5, read-only, evidence-cited). Consolidated register +
> fix roadmap. Severity: S1 breaks/blocks · S2 degrades · S3 latent/structural · S4 nit.
> Effort: S small · M medium · L large.

## State of the app

Functional and reasonably built (modular Electron orchestrator, single input gate,
extracted state machine, 586 tests). Not broken/emergency. The three felt problems —
slow-to-record under load, vanishing pill, "everything stresses as the system bogs down"
— converge on one spine: **a single serialized engine pipe whose synchronous commands
block each other.** Fix the spine + the device handling and the top two complaints
largely disappear.

## Causal map

```
stale mic device (R1) ─┬─► PortAudio open stalls ─► "minute to record"
                       └─► engine wedged mid-stall ─► child can't be reaped ─► orphan (R5)
single serialized blocking pipe (R2) ─► one slow command freezes all ─► amplified under load
no in-engine timeout (R3) ──────────► stalls can't self-abort (only the 60s outer cap)
transparent always-on-top pill ─► GPU/renderer drop ─► pill vanishes (R4) ─► respawned PID
history delete/rollover ─► audio file left behind ─► orphaned recordings (R6)
```

## Ranked register

| ID | Finding | Sev | Effort | Symptom | Source |
|----|---------|-----|--------|---------|--------|
| R1 | Stored mic is a bare index, no validation/fallback; PortAudio MME open stalls on a stale device | **S1** | S–M | **minute-to-record** | P1 |
| R2 | Single serialized engine pipe; blocking ops run on the one loop → head-of-line blocking | **S2** | L | under-load stress; wedged child | P5,P1 |
| R3 | No in-engine timeout; only the 60 s outer cap; a stall can't self-abort | **S2** | M | the minute; cascade | P5 |
| R4 | Pill has no self-heal in tray, no crash recovery, no reconciler | **S2** | S–M | **vanishing pill** | P2 |
| R5 | Engine child can orphan on ungraceful exit / mid-stall (2 s kill timer skippable) | **S2** | S | duplicate processes | P3 |
| R6 | Orphaned audio: delete/clear/500-rollover never remove the `.ogg`; cleanup incidental; `retention=0` never deletes | **S3** | S–M | disk growth | P4 |
| R7 | Cleanup + device enumeration run synchronously on the config/hot path | **S3** | S | latency spikes | P1,P4 |
| R8 | Hotkey-start bounces through the renderer even after the gate approved it | **S3** | S | start latency under load | P1 |
| R9 | `engine.log` raw stderr redirect is unbounded (no rotation) | **S3** | S | latent disk leak | P4 |
| R10 | No startup orphan sweep; Electron+Tauri have independent locks (both can run) | **S3** | S | duplicate processes | P3 |
| R11 | Engine state = 8 shared module globals in one 318-line `handle_command`; some unlocked across threads | **S3** | M | fragility/testability | P5 |
| R12 | Large orchestrators (`main.js` ~1,360 / `lib.rs` ~2,015) concentrate coupling | **S3** | M | maintainability | P5 |
| R13 | Dual JS/Rust reimplementation drifts (pill reconciler, audio-on-delete differ) | **S3** | L | correctness drift | P5 |

## Healthy (no action)
Rotated logs (`whisperclick.log`, debug log), 500-entry history cap, atomic writes with
`.bak`, the centralized input gate, the extracted state machine, 586 tests, genuine
Electron module separation. CPU ~0.3% avg at idle — not a hog.

## Fix roadmap

**Batch A — stop the pain (localized, reversible).** R1 device resilience, R4 pill
self-heal, R5 + R10 child reaping + startup orphan sweep. Highest value per effort.
Plan: `docs/dev/plans/2026-06-02-batch-a-reliability.md`.

**Batch B — fix the spine (structural).** R2 move blocking ops off the dispatch loop, R3
in-engine timeouts, R7 decouple cleanup, R8 skip the renderer bounce. Follows a live
under-load capture (debug logging on) to quantify head-of-line blocking first.

**Batch C — hygiene/longer-term.** R6 audio lifecycle, R9 `engine.log` cap, R11 state
encapsulation, R12 orchestrator decomposition, R13 platform convergence.

**Quick-win first cut (all S-effort):** R1 + R4 + R5 + R9.

## Decision (recorded)
Edward chose **full Batch A then B**, with a **live under-load capture before Batch B**.
Batch A is being executed from the plan above (test-first, subagent-driven, no push
without approval).
