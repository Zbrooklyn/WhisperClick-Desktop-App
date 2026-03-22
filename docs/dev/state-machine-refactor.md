# State Machine Refactor — Design Document

> Created: 2026-03-18
> Status: Planned — Phase 1 in progress

## Problem Statement

The app's state management is an implicit state machine implemented as a string
variable (`appState`) set from 15+ locations with no transition validation. This
has caused a pattern of recurring bugs:

| Bug | Root Cause | Version Fixed |
|-----|-----------|---------------|
| Cancel button (X) not working | 900ms debounce blocked cancel during processing | v2.1.2 |
| "Already recording" after transcription | `success` state treated as active, blocking new recordings | v2.1.1 |
| Pill widget disappearing | Broadcasts sent to destroyed windows, no isDestroyed guards | v2.1.0 |
| Phantom clock on window reopen | No state sync on window show, stale timer persisted | v2.1.0 |
| App state stuck on `success` | Dormant timer skipped in button mode, state never transitioned | v2.1.0 |
| Dormant overriding enter button | 1.5s timer broadcasting dormant over enter-ready state | v2.1.0 |

**Common theme**: State transitions have timing windows where the app is between
states, and actions during those windows aren't handled. Each fix adds another
guard or special case, increasing complexity.

## Current Architecture (Problems)

### 1. No formal state machine
```js
// Current: string variable, set anywhere
let appState = 'dormant';
function setAppState(s) { appState = s; appStateMessage = ''; }
// Called from 15+ places with no transition validation
```

### 2. Three independent state trackers
- **Main process**: `appState` (string)
- **Frontend (index.html)**: `isRecording` + `isProcessing` (booleans)
- **Pill (pill.html)**: `currentState` (string)

These can disagree. Reconciliation mechanisms (broadcastState on show, 5s polling,
dormant override guards) exist because of this divergence.

### 3. Timer-based transitions
```js
// Current: timeouts create windows where state is wrong
setTimeout(() => { setAppState('dormant'); broadcastState(); }, 1500);
```

### 4. Five overlapping debounce/guard layers
- `nextAllowedToggleAt` (900ms after stop)
- `lastToggleInvocationAt` (160ms between toggles)
- `lastToggleEventStamp` (dedup same event)
- `HOTKEY_DEBOUNCE_MS` (300ms hotkey guard)
- Sidecar `_recording` flag (Python-side guard)

These interact in unpredictable ways (cancel blocked by recording debounce).

## Proposed Architecture

### Phase 1 — State Machine Module

Create `electron/state-machine.js`:

```js
// Defined states
const STATES = { DORMANT: 'dormant', RECORDING: 'recording',
                 PROCESSING: 'processing', SUCCESS: 'success' };

// Valid transitions: from → [allowed destinations]
const TRANSITIONS = {
  dormant:    ['recording'],
  recording:  ['processing', 'dormant'],   // dormant = cancel
  processing: ['success', 'dormant'],      // dormant = cancel/error
  success:    ['dormant', 'recording'],    // can start new recording from success
};

class StateMachine {
  constructor(initial = 'dormant') { this.state = initial; this.listeners = []; }

  can(to) { return TRANSITIONS[this.state]?.includes(to); }

  transition(to, meta = {}) {
    if (!this.can(to)) {
      console.warn(`Invalid transition: ${this.state} → ${to}`);
      return false;
    }
    const from = this.state;
    this.state = to;
    this.listeners.forEach(fn => fn({ from, to, meta }));
    return true;
  }

  on(fn) { this.listeners.push(fn); return () => this.listeners = this.listeners.filter(f => f !== fn); }
}
```

**main.js changes**: Replace `appState` / `setAppState` with `sm.transition()`.
Wire `sm.on()` to `broadcastState()` so every valid transition auto-broadcasts.
Invalid transitions are logged and rejected — no silent state corruption.

### Phase 2 — Single Input Gate

Replace 5 debounce layers with one function:

```js
function canAcceptAction(action) {
  if (action === 'start') return sm.can('recording');
  if (action === 'stop')  return sm.state === 'recording';
  if (action === 'cancel') return sm.state === 'recording' || sm.state === 'processing';
  return false;
}
```

All triggers (hotkey, pill, tray, UI click) call `canAcceptAction()` first.
One place, one check, one answer.

### Phase 3 — Pill as Dumb Terminal

Main process sends render payloads:
```js
pillWindow.webContents.send('render', {
  shape: 'recording',    // dormant | recording | processing | success | enter-ready
  level: 0.5,            // audio level (recording only)
  autoEnterMode: 'auto', // for stop button icon
});
```

Pill has zero state logic — just renders what it receives and forwards clicks.

### Phase 4 — Frontend State Simplification

Remove `isRecording`, `isProcessing` from index.html. The state-update event
handler becomes the single place that drives all UI:

```js
window.addEventListener('state-update', (e) => {
  const { state } = e.detail;
  if (state === 'dormant')    setIdleUi();
  if (state === 'recording')  setListeningUi();
  if (state === 'processing') setProcessingUi();
  if (state === 'success')    handleSuccess();
});
```

No reconciliation needed because there's nothing to reconcile.

### Phase 5 — Event-Driven Transitions

Replace timer-based transitions with event-driven + fallback:

```js
// Instead of: setTimeout(() => sm.transition('dormant'), 1500)
// Use: UI acknowledges success, main transitions to dormant
ipcMain.handle('ack-success', () => sm.transition('dormant'));
// Fallback timer only as safety net (10s, not 1.5s)
setTimeout(() => { if (sm.state === 'success') sm.transition('dormant'); }, 10000);
```

## Migration Strategy

- Feature branch: `feature/state-machine`
- Each phase is a separate commit
- Tests must pass after every phase (412 tests = safety net)
- Live-test app after each phase before proceeding
- Merge to main after each phase is verified, not all at once
- No behavior changes — pure refactor (same UX, cleaner internals)

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Breaking existing behavior | 412 tests + live testing per phase |
| Pill behavior changes | Phase 3 only changes HOW pill renders, not WHAT |
| Frontend regression | Phase 4 is highest risk — extra live testing needed |
| Timer removal breaks UX | Phase 5 keeps fallback timers as safety net |

## Success Criteria

After all 5 phases:
- Zero state-related bug fixes needed (no more "state was X when it should be Y")
- One place to check for valid actions (`canAcceptAction`)
- One source of truth for state (state machine in main process)
- Pill and frontend are pure views with no independent state tracking
- All 412+ tests pass, all manual verification items pass
