# Requirements: WhisperClick State Machine Refactor

**Defined:** 2026-03-20
**Core Value:** Single source of truth for all app state — state desync bugs cannot happen.

## v1 Requirements

### Pill Widget

- [ ] **PILL-01**: Pill receives render payloads from main process (shape, level, autoEnterMode)
- [ ] **PILL-02**: Pill has zero local state tracking — no currentState, no enterTimeout, no shrinkTimeout
- [ ] **PILL-03**: Pill click sends event to main process — main decides what happens
- [ ] **PILL-04**: Pill renders exactly what it's told — dormant, recording, processing, success, enter-ready

### Frontend State

- [ ] **FEND-01**: Frontend removes isRecording and isProcessing boolean flags
- [ ] **FEND-02**: Frontend derives all UI state from state-update events
- [ ] **FEND-03**: No state reconciliation polling needed — state-update is the sole authority
- [ ] **FEND-04**: toggleRecording uses state from last state-update, not local flags

### Transitions

- [ ] **TRAN-01**: success→dormant transition is event-driven (UI acknowledges), not timer-based
- [ ] **TRAN-02**: Timer exists only as safety fallback (10s), not primary mechanism
- [ ] **TRAN-03**: Enter button dismiss is a UI concern, not a state transition concern
- [ ] **TRAN-04**: No setTimeout-based state transitions in main process broadcastError path

### Verification

- [ ] **VERI-01**: All 460+ tests pass after every phase
- [ ] **VERI-02**: No behavior changes — identical UX before and after
- [ ] **VERI-03**: Live testing confirms: record, stop, cancel, back-to-back, pill click, hotkey, tray
- [ ] **VERI-04**: Debug log shows clean state transitions with no forced resets or rejected transitions

## v2 Requirements

### Future Hardening

- **HARD-01**: State machine emits metrics (transition count, rejected count, average time in each state)
- **HARD-02**: State visualization in debug mode (overlay showing current state + recent transitions)
- **HARD-03**: Formal state machine diagram auto-generated from transition table

## Out of Scope

| Feature | Reason |
|---------|--------|
| React rewrite | Too much risk for a state refactor — V3 frontend stays |
| Sidecar protocol changes | JSON stdin/stdout works fine |
| New features (streaming, premium) | Pure refactor — no behavior changes |
| Frontend JS logic beyond state | Keep V3 portable for preload shim |
| Code signing | Separate concern, tracked in ROADMAP.md |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PILL-01 | Phase 3 | Pending |
| PILL-02 | Phase 3 | Pending |
| PILL-03 | Phase 3 | Pending |
| PILL-04 | Phase 3 | Pending |
| FEND-01 | Phase 4 | Pending |
| FEND-02 | Phase 4 | Pending |
| FEND-03 | Phase 4 | Pending |
| FEND-04 | Phase 4 | Pending |
| TRAN-01 | Phase 5 | Pending |
| TRAN-02 | Phase 5 | Pending |
| TRAN-03 | Phase 5 | Pending |
| TRAN-04 | Phase 5 | Pending |
| VERI-01 | All | Pending |
| VERI-02 | All | Pending |
| VERI-03 | All | Pending |
| VERI-04 | All | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after initial definition*
