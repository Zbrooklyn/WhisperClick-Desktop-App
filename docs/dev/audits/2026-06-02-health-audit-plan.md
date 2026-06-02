# WhisperClick Health Audit — Campaign Plan

> Created 2026-06-02. Owner: Edward (CEO). Driver: Claude (cofounder-operator).
> Status: **Batch A fix campaign in progress (audit complete).**

## Why this exists

Edward reports three linked symptoms, all worse as the machine gets loaded:

1. **Recording is slow to start** — clicking the shortcut can take *up to a minute*
   before audio actually captures, especially when CPU/RAM are under pressure.
2. **The pill widget is unreliable** — set to ON (`showPill: true`), it sometimes
   vanishes; the only known recovery is toggling it OFF then ON.
3. **General "bog-down"** — as the system stresses, the whole app stresses with it,
   while *other* apps stay responsive.

The unifying question is **what degrades under load**, and the investigation method
is **start at the keypress and walk forward**, enumerating every point that can
inject lag or failure, until the culprit is found.

## Operating rules (applied to every audit phase)

- **Audit phases were 100% read-only.** Inspect, measure, document. Fixes are a
  separate, Edward-greenlit campaign (Batch A, then B).
- **Evidence over confidence.** Every finding cites `file:line` or a measured number.
- **One findings doc per phase**, severity-tagged: `S1` breaks/blocks · `S2` degrades
  · `S3` latent/structural · `S4` nit.

## Confirmed environment facts (measured 2026-06-01/02)

- Mode: **API / OpenAI**, `customBaseUrl: https://api.openai.com/v1`, `whisper-1`.
  Local models dir empty → model-load latency is NOT the cause.
- `debugLogging: false` → the built-in 25-point tracer is OFF; only error logs exist.
- `showPill: true` — pill is configured on, yet disappears (durability bug confirmed).
- The 6:04 PM 404 was a transient proxy misconfig (base URL briefly non-OpenAI,
  reverted at 6:48 PM). **Dismissed.**
- Process snapshot: 5 × WhisperClick + 1 × engine (normal Electron multi-process +
  one respawned renderer). ~0.3% avg CPU — not a hog.
- Disk: 195 audio recordings / 7.7 MB; `engine.log` 0 B but unrotated.
- Recurring log errors: PortAudio `-9996 "Invalid device"` / `-9999 "device out of
  range [MME error 2]"` — **stale microphone slot**.

## Phases (all complete)

| Phase | Status | Doc |
|---|---|---|
| 0 — Discovery baseline | ✅ | (this file) |
| 1 — Keypress journey | ✅ | `2026-06-02-phase1-keypress-journey.md` |
| 2 — Pill durability | ✅ | `2026-06-02-phase2-pill-durability.md` |
| 3 — Process health | ✅ | `2026-06-02-phase3-process-health.md` |
| 4 — Data lifecycle | ✅ | `2026-06-02-phase4-data-lifecycle.md` |
| 5 — Code health | ✅ | `2026-06-02-phase5-code-health.md` |
| 6 — Synthesis (gate) | ✅ | `2026-06-02-phase6-synthesis-register.md` |

## Fix campaign (post-audit)

- **Batch A** (localized, reversible): R1 stale-mic, R4 pill self-heal, R5 child reaping,
  R10 orphan sweep. Plan: `docs/dev/plans/2026-06-02-batch-a-reliability.md`.
- **Batch B** (structural): R2/R3 unblock the single-pipe engine + in-engine timeouts —
  follows a live under-load capture (debug logging on) that informs the design.
- Full ranked register: `2026-06-02-phase6-synthesis-register.md`.

> **Durability note (2026-06-02):** these docs were briefly lost to a Dropbox-sync
> interaction with the editor tool and recreated, then committed to git so git objects
> are the durable copy. Commit audit/fix outputs promptly.
