# Developer Questions — WhisperClick V3

Compiled during V2→V3 handoff review. Each item includes the question, what the code confirms, and whether a decision is needed for V3.

---

## 1. API Mode Key Routing Mismatch

**Question:** API mode uses env var in `transcription.py`, not the keyring-persisted key from `api.py`. Is this intentional?

**Confirmed Answer:**
- Main UI API mode does NOT depend on env var — it uses the key from settings memory and calls provider APIs directly from frontend JS (`index.html:2978`, `index.html:3017`, `index.html:2872`, `index.html:2922`).
- Backend transcription IS OpenAI-only via env var (`transcription.py:98`, `transcription.py:100`), while keyring persistence lives in `api.py:446`.
- This is an **architecture mismatch**, not a simple wiring gap.

**Decision Needed for V3:** Unify transcription routing so both frontend and backend paths use the same key source and support the same providers.

---

## 2. Synchronous Transcription

**Question:** `stop_recording()` blocks until transcription completes. Was async considered?

**Confirmed Answer:**
- Canonical path is synchronous: `api.stop_recording()` blocks on `self._transcription.transcribe(...)` (`api.py:186`, `api.py:198`).
- Legacy runtime in `app.py` had a worker thread (`app.py:185`, `app.py:197`), suggesting async was explored but not carried forward.

**Decision Needed for V3:** Decide whether synchronous is acceptable or if async transcription should be restored (impacts UX for long recordings and slow networks).

---

## 3. No Structured Logging

**Question:** No structured logging in runtime code — is there a diagnostics/log-export plan?

**Confirmed Answer:**
- Correct: no structured logging in runtime code.
- Docs explicitly track this as pending (`ROADMAP.md:46`, `PRODUCTION_AUDIT_CHECKLIST.md:130`).

**Decision Needed for V3:** Implement structured logging with a user-exportable support bundle, or defer again.

---

## 4. History Search Never Implemented

**Question:** Was history search filtering ever written and removed, or never implemented?

**Confirmed Answer:**
- Search input control exists (`index.html:570`), but **no search handler logic** was ever implemented.
- Existing input listeners are for API keys only (`index.html:2175`, `index.html:2192`).

**Decision Needed for V3:** Define search scope (substring? fuzzy? date-range?) and implement.

---

## 5. Pill Widget Recording Parity — Architectural Gap

**Question:** How far off is pill recording parity?

**Confirmed Answer:**
- Pill uses the **backend** start/stop transcription path (`pill_manager.py:111`, `pill_manager.py:144`).
- Main UI API mode uses the **frontend** JS pipeline (`index.html:2978`).
- This is an **architectural split**, not just "wrong key/provider passed."

**Decision Needed for V3:** Either route pill through the same frontend pipeline (complex — pill is Qt, not webview), or extend backend transcription to support all providers with keyring keys (simpler, unified).

---

## 6. No History Pagination

**Question:** Is the lack of pagination a known scaling concern?

**Confirmed Answer:**
- History loaded as full JSON list (`config.py:80`), returned fully (`api.py:686`), fully iterated in UI (`index.html:2081`).
- No pagination or lazy loading.

**Decision Needed for V3:** Determine acceptable history volume and implement pagination/virtualization if needed.

---

## 7. Microphone Unplug Mid-Recording — No Recovery

**Question:** What happens if mic is unplugged during recording?

**Confirmed Answer:**
- Recorder callback receives status but doesn't act on it (`audio_recorder.py:20`).
- No dedicated unplug/reconnect handler exists.

**Decision Needed for V3:** Define recovery contract — graceful stop + user notification, or attempt reconnect.

---

## 8. API Error Handling — No Retry/Backoff

**Question:** Are transient API failures (429) distinguished from auth failures (401)?

**Confirmed Answer:**
- Verification endpoint does distinguish auth failures (`api.py:558`).
- Transcription request handling uses generic status-based errors (`index.html:2877`, `index.html:2912`, `index.html:2931`).
- No retry/backoff logic found — only a timeout wrapper (`index.html:2844`).

**Decision Needed for V3:** Add retry with exponential backoff for transient errors (429, 5xx). Keep immediate failure for auth errors (401/403).

---

## 9. No Settings Schema Versioning

**Question:** What if a setting key's meaning changes or gets renamed?

**Confirmed Answer:**
- Settings merged with defaults on load (`config.py:64`, `config.py:70`).
- No schema version key exists.

**Decision Needed for V3:** Add a `settings_version` field and migration function for breaking schema changes.

---

## 10. No Code Signing

**Question:** Is signing planned before public distribution?

**Confirmed Answer:**
- Not implemented. Docs mark it as pending (`ROADMAP.md:54`, `PRODUCTION_AUDIT_CHECKLIST.md:126`).

**Decision Needed for V3:** Acquire code signing certificate and integrate into build pipeline before public release.

---

## 11. No Auto-Update Mechanism

**Question:** Is there a plan for update notifications or in-app updates?

**Confirmed Answer:**
- No auto-update mechanism in code.
- Docs mark update strategy as undecided (`ROADMAP.md:64`, `PRODUCTION_AUDIT_CHECKLIST.md:108`).

**Decision Needed for V3:** Choose strategy — GitHub Releases polling, Sparkle-like updater, or manual-only.

---

## 12. Gemini Support — Frontend Only

**Question:** Does `transcription.py` actually support Gemini, or is it OpenAI-only?

**Confirmed Answer:**
- Backend transcription is **OpenAI-only** (`transcription.py:98`).
- Gemini is implemented in the **frontend** API pipeline (`index.html:2937`, `index.html:2959`, `index.html:2980`).
- Key verification supports Gemini (`api.py:516`, `api.py:542`).

**Decision Needed for V3:** Extend backend transcription to support Gemini (and future providers), or accept frontend-only API mode as canonical.

---

## Summary Matrix

| # | Topic | Status | V3 Action |
|---|-------|--------|-----------|
| 1 | API key routing | Architecture mismatch | **Unify** |
| 2 | Sync transcription | Intentional, legacy async exists | **Decide** |
| 3 | Structured logging | Tracked as pending | **Implement** |
| 4 | History search | Never implemented | **Implement** |
| 5 | Pill recording parity | Architectural gap | **Unify** |
| 6 | History pagination | Not implemented | **Decide threshold** |
| 7 | Mic unplug recovery | No handler | **Define contract** |
| 8 | API retry/backoff | Not implemented | **Implement** |
| 9 | Settings versioning | Not implemented | **Add** |
| 10 | Code signing | Pending | **Decide timeline** |
| 11 | Auto-update | Undecided | **Choose strategy** |
| 12 | Gemini backend | Frontend-only | **Unify or accept** |

---

*Last updated: 2026-02-19*
*Compiled by: Claude Opus 4.6 during V2→V3 handoff review*

---

## Codex Answers for Original Developer (Appended 2026-02-20)

These are direct implementation answers/recommendations to unblock V3 decisions.

### 1) API mode key routing mismatch

Answer: Unify on backend-owned key/provider routing. Frontend should not be the source of truth for API key usage.

Proposed direction:
- Move OpenAI/Gemini transcription/translation request execution into backend service layer.
- Read provider keys from keyring-backed `api.py` endpoints.
- Keep frontend as a thin UI/client that submits audio + settings only.

### 2) Synchronous transcription

Answer: Synchronous backend stop path should be replaced for V3.

Proposed direction:
- Use background jobs (thread or task queue abstraction) for transcription.
- Return immediate job id to UI.
- Surface progress/state (`recording -> processing -> done/error`) via polling or event bridge.

### 3) Structured logging

Answer: Must be implemented before public release.

Proposed direction:
- Add structured JSON logs with event names and correlation/session ids.
- Include key flows: record start/stop, provider request start/end, failures, model ops, hotkey events.
- Add "Export diagnostics" flow with secret redaction.

### 4) History search

Answer: Implement now as deterministic substring search first.

Proposed direction:
- Phase 1: case-insensitive substring over transcript text.
- Phase 2: optional filters (date/provider/model) if needed.
- Defer fuzzy search until real usage data justifies complexity.

### 5) Pill widget parity

Answer: Treat this as an architecture unification task, not a minor bug.

Proposed direction:
- Pill and main UI must call the same backend transcription pipeline.
- Remove pipeline divergence where one path uses frontend network logic and the other uses backend env-var logic.

### 6) History pagination

Answer: Add pagination/virtualization before history volume grows.

Proposed direction:
- Backend API: `get_history(offset, limit, query?)`.
- Frontend: incremental load/virtual list rendering.
- Keep full in-memory load only for very small histories.

### 7) Mic unplug mid-recording

Answer: Add explicit recovery contract and error states.

Proposed direction:
- Detect stream status/device errors in recorder callback path.
- Transition to safe idle state.
- Show actionable toast/message and preserve app responsiveness.

### 8) Retry/backoff for API errors

Answer: Implement provider retry policy for transient failures.

Proposed direction:
- No retry for auth/config errors (`400` invalid config, `401`, `403`).
- Retry with exponential backoff + jitter for `429`, `5xx`, and timeout/network failures.
- Cap retries and emit clear final error reason.

### 9) Settings schema versioning

Answer: Add schema versioning in V3.

Proposed direction:
- Add `settings_version` key.
- Add explicit migration functions per version step.
- Add downgrade/rollback-safe behavior for unknown/new keys.

### 10) Code signing

Answer: Required for public Windows release.

Proposed direction:
- Acquire certificate (OV minimum, EV preferred for SmartScreen reputation ramp).
- Integrate signing into release scripts for EXE + installer.
- Validate signatures as part of release gate.

### 11) Auto-update strategy

Answer: Decide update model now, even if implementation is phased.

Proposed direction:
- Phase 1: in-app update check + "download latest" UX.
- Phase 2: optional auto-download/install flow with rollback handling.
- Keep portable and installer channels explicitly documented.

### 12) Gemini backend support

Answer: Add backend provider abstraction so Gemini/OpenAI are first-class in backend, not frontend-only.

Proposed direction:
- Create backend provider interface (`transcribe`, `translate`, `validate_key`, `normalize_errors`).
- Implement OpenAI and Gemini adapters.
- Route both pill and main UI through this shared backend layer.

### Recommended V3 execution order

1. Unify backend transcription/provider architecture (#1, #5, #12).
2. Add async job model + robust state transitions (#2, #7, #8).
3. Ship core operability gaps: logging, settings versioning, search (#3, #4, #9).
4. Finalize release operations: signing + update strategy + scale controls (#6, #10, #11).

*Appended by: Codex*
