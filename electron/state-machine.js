'use strict';

/**
 * WhisperClick State Machine
 *
 * Single source of truth for app state. All state transitions are validated
 * against a defined transition table. Invalid transitions are rejected and logged.
 *
 * States: dormant, recording, processing, success, error
 * See docs/dev/state-machine-refactor.md for full design.
 */

const STATES = {
  DORMANT: 'dormant',
  RECORDING: 'recording',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  ERROR: 'error',
};

// Valid transitions: from → [allowed destinations]
const TRANSITIONS = {
  // Phase 1: permissive transitions for compatibility with existing code.
  // Phase 2+ will tighten these to only valid paths.
  dormant:    ['recording', 'error', 'success', 'processing'], // success/processing for compat
  recording:  ['processing', 'dormant', 'error', 'success'],   // dormant = cancel
  processing: ['success', 'dormant', 'error'],                  // dormant = cancel/timeout
  success:    ['dormant', 'recording'],                          // can start new recording
  error:      ['dormant', 'recording'],                          // can recover from error
};

class StateMachine {
  /**
   * @param {string} initial - Initial state (default: 'dormant')
   * @param {object} [opts]
   * @param {function} [opts.logger] - Log function (receives string messages)
   */
  constructor(initial = STATES.DORMANT, opts = {}) {
    if (!TRANSITIONS[initial]) {
      throw new Error(`Invalid initial state: ${initial}`);
    }
    this._state = initial;
    this._message = '';
    this._listeners = [];
    this._log = opts.logger || (() => {});
  }

  /** Current state */
  get state() { return this._state; }

  /** Human-readable context for current state (e.g. error details) */
  get message() { return this._message; }

  /**
   * Check if a transition to the target state is valid.
   * @param {string} to - Target state
   * @returns {boolean}
   */
  can(to) {
    const allowed = TRANSITIONS[this._state];
    return allowed ? allowed.includes(to) : false;
  }

  /**
   * Check if the current state is one of the given states.
   * @param {...string} states - States to check against
   * @returns {boolean}
   */
  is(...states) {
    return states.includes(this._state);
  }

  /**
   * Check if the app is in an "active" state (recording or processing).
   * @returns {boolean}
   */
  get isActive() {
    return this._state === STATES.RECORDING || this._state === STATES.PROCESSING;
  }

  /**
   * Check if a new recording can be started.
   * @returns {boolean}
   */
  get canRecord() {
    return this.can(STATES.RECORDING);
  }

  /**
   * Check if an action can be cancelled.
   * @returns {boolean}
   */
  get canCancel() {
    return this._state === STATES.RECORDING || this._state === STATES.PROCESSING;
  }

  /**
   * Attempt a state transition. Returns true if successful, false if invalid.
   * Notifies all listeners on successful transition.
   *
   * @param {string} to - Target state
   * @param {string} [message] - Optional human-readable context
   * @returns {boolean} Whether the transition succeeded
   */
  transition(to, message) {
    if (!TRANSITIONS[to]) {
      this._log(`[state-machine] Unknown state: ${to}`);
      return false;
    }

    if (!this.can(to)) {
      this._log(`[state-machine] Invalid transition: ${this._state} → ${to}`);
      return false;
    }

    const from = this._state;
    this._state = to;

    // Clear message on dormant/success unless explicitly provided
    if (message !== undefined) {
      this._message = message;
    } else if (to === STATES.DORMANT || to === STATES.SUCCESS) {
      this._message = '';
    }

    this._log(`[state-machine] ${from} → ${to}${message ? ` (${message})` : ''}`);

    // Notify listeners
    for (const fn of this._listeners) {
      try {
        fn({ from, to, message: this._message });
      } catch (err) {
        this._log(`[state-machine] Listener error: ${err.message}`);
      }
    }

    return true;
  }

  /**
   * Force transition to dormant from any state. Use only for error recovery.
   * @param {string} [message] - Optional context
   */
  reset(message) {
    const from = this._state;
    this._state = STATES.DORMANT;
    this._message = message || '';
    this._log(`[state-machine] RESET: ${from} → dormant${message ? ` (${message})` : ''}`);

    for (const fn of this._listeners) {
      try {
        fn({ from, to: STATES.DORMANT, message: this._message, forced: true });
      } catch (err) {
        this._log(`[state-machine] Listener error: ${err.message}`);
      }
    }
  }

  /**
   * Subscribe to state transitions.
   * @param {function} fn - Callback receiving { from, to, message, forced? }
   * @returns {function} Unsubscribe function
   */
  on(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(f => f !== fn); };
  }
}

module.exports = { StateMachine, STATES };
