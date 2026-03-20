# Roadmap: State Machine Refactor

**Milestone:** v1.0 — Single Source of Truth
**Phases:** 3
**Requirements:** 16

## Phase 3: Pill as Dumb Terminal

**Goal:** Remove all state logic from pill.html. Main process sends render payloads, pill renders and forwards clicks.

**Requirements:** PILL-01, PILL-02, PILL-03, PILL-04

**Success Criteria:**
1. Pill receives `{ shape, level, autoEnterMode, dismissMs }` payloads and renders them
2. No `currentState`, `enterTimeout`, `shrinkTimeout`, or state-tracking variables in pill.html
3. Pill click sends generic event to main — main decides the action via canAcceptAction
4. All pill visual states (dormant, recording, processing, success, enter-ready) work identically to current behavior

**Dependencies:** Phase 2 (complete)

---

## Phase 4: Frontend State Simplification

**Goal:** Remove `isRecording` and `isProcessing` flags from index.html. All UI state derived from state-update events.

**Requirements:** FEND-01, FEND-02, FEND-03, FEND-04

**Success Criteria:**
1. `isRecording` and `isProcessing` variables removed from frontend
2. state-update event handler is the single place that drives all UI changes
3. No 5-second state reconciliation polling needed
4. toggleRecording reads state from last state-update, not local boolean flags

**Dependencies:** Phase 3 (pill must be dumb first — otherwise pill and frontend fight over state)

---

## Phase 5: Event-Driven Transitions

**Goal:** Replace timer-based state transitions with event acknowledgment + safety fallback timers.

**Requirements:** TRAN-01, TRAN-02, TRAN-03, TRAN-04

**Success Criteria:**
1. success→dormant uses UI acknowledgment event (not setTimeout 1.5s)
2. Safety fallback timer is 10s (not 1.5s) — only fires if UI crashes
3. Enter button dismiss is handled entirely in UI, doesn't affect main process state
4. broadcastError recovery timer replaced with event-driven cleanup

**Dependencies:** Phase 4 (frontend must derive state from events before events can drive transitions)

---

## Cross-Phase Requirements

**VERI-01 through VERI-04** apply to all phases:
- All 460+ tests pass after every phase
- No behavior changes — identical UX
- Live testing after each phase
- Clean debug log (no forced resets)
