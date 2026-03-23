'use strict';

const { StateMachine, STATES } = require('../../platforms/electron/state-machine');

describe('StateMachine', () => {
  let sm;

  beforeEach(() => {
    sm = new StateMachine();
  });

  describe('initialization', () => {
    test('starts in dormant state', () => {
      expect(sm.state).toBe('dormant');
      expect(sm.message).toBe('');
    });

    test('accepts custom initial state', () => {
      const s = new StateMachine('recording');
      expect(s.state).toBe('recording');
    });

    test('rejects invalid initial state', () => {
      expect(() => new StateMachine('invalid')).toThrow('Invalid initial state');
    });
  });

  describe('STATES constants', () => {
    test('exports all states', () => {
      expect(STATES.DORMANT).toBe('dormant');
      expect(STATES.RECORDING).toBe('recording');
      expect(STATES.PROCESSING).toBe('processing');
      expect(STATES.SUCCESS).toBe('success');
      expect(STATES.ERROR).toBe('error');
    });
  });

  describe('can()', () => {
    test('dormant can transition to recording', () => {
      expect(sm.can('recording')).toBe(true);
    });

    test('dormant cannot transition to processing', () => {
      expect(sm.can('processing')).toBe(false);
    });

    test('dormant cannot transition to success', () => {
      expect(sm.can('success')).toBe(false);
    });

    test('recording can transition to processing or dormant', () => {
      sm.transition('recording');
      expect(sm.can('processing')).toBe(true);
      expect(sm.can('dormant')).toBe(true);
    });

    test('recording can transition to success (fast transcription)', () => {
      sm.transition('recording');
      expect(sm.can('success')).toBe(true);
    });

    test('processing can transition to success, dormant, or error', () => {
      sm.transition('recording');
      sm.transition('processing');
      expect(sm.can('success')).toBe(true);
      expect(sm.can('dormant')).toBe(true);
      expect(sm.can('error')).toBe(true);
    });

    test('success can transition to dormant or recording', () => {
      sm.transition('recording');
      sm.transition('processing');
      sm.transition('success');
      expect(sm.can('dormant')).toBe(true);
      expect(sm.can('recording')).toBe(true);
    });

    test('error can transition to dormant or recording', () => {
      sm.transition('recording');
      sm.transition('processing');
      sm.transition('error');
      expect(sm.can('dormant')).toBe(true);
      expect(sm.can('recording')).toBe(true);
    });
  });

  describe('is()', () => {
    test('matches current state', () => {
      expect(sm.is('dormant')).toBe(true);
      expect(sm.is('recording')).toBe(false);
    });

    test('matches any of multiple states', () => {
      expect(sm.is('dormant', 'recording')).toBe(true);
      expect(sm.is('processing', 'success')).toBe(false);
    });
  });

  describe('isActive', () => {
    test('false when dormant', () => {
      expect(sm.isActive).toBe(false);
    });

    test('true when recording', () => {
      sm.transition('recording');
      expect(sm.isActive).toBe(true);
    });

    test('true when processing', () => {
      sm.transition('recording');
      sm.transition('processing');
      expect(sm.isActive).toBe(true);
    });

    test('false when success', () => {
      sm.transition('recording');
      sm.transition('processing');
      sm.transition('success');
      expect(sm.isActive).toBe(false);
    });
  });

  describe('canRecord', () => {
    test('true when dormant', () => {
      expect(sm.canRecord).toBe(true);
    });

    test('false when recording', () => {
      sm.transition('recording');
      expect(sm.canRecord).toBe(false);
    });

    test('true when success', () => {
      sm.transition('recording');
      sm.transition('processing');
      sm.transition('success');
      expect(sm.canRecord).toBe(true);
    });

    test('true when error', () => {
      sm.transition('recording');
      sm.transition('processing');
      sm.transition('error');
      expect(sm.canRecord).toBe(true);
    });
  });

  describe('canCancel', () => {
    test('false when dormant', () => {
      expect(sm.canCancel).toBe(false);
    });

    test('true when recording', () => {
      sm.transition('recording');
      expect(sm.canCancel).toBe(true);
    });

    test('true when processing', () => {
      sm.transition('recording');
      sm.transition('processing');
      expect(sm.canCancel).toBe(true);
    });

    test('false when success', () => {
      sm.transition('recording');
      sm.transition('processing');
      sm.transition('success');
      expect(sm.canCancel).toBe(false);
    });
  });

  describe('transition()', () => {
    test('valid transition changes state', () => {
      const result = sm.transition('recording');
      expect(result).toBe(true);
      expect(sm.state).toBe('recording');
    });

    test('invalid transition returns false and keeps state', () => {
      // success → processing is invalid even in Phase 1
      sm.transition('recording');
      sm.transition('processing');
      sm.transition('success');
      const result = sm.transition('processing');
      expect(result).toBe(false);
      expect(sm.state).toBe('success');
    });

    test('unknown state returns false', () => {
      const result = sm.transition('nonexistent');
      expect(result).toBe(false);
      expect(sm.state).toBe('dormant');
    });

    test('sets message when provided', () => {
      sm.transition('recording', 'Starting...');
      expect(sm.message).toBe('Starting...');
    });

    test('clears message on dormant transition', () => {
      sm.transition('recording', 'Recording');
      sm.transition('dormant');
      expect(sm.message).toBe('');
    });

    test('clears message on success transition', () => {
      sm.transition('recording');
      sm.transition('processing', 'Transcribing...');
      sm.transition('success');
      expect(sm.message).toBe('');
    });

    test('preserves message on error when provided', () => {
      sm.transition('recording');
      sm.transition('processing');
      sm.transition('error', 'API key invalid');
      expect(sm.message).toBe('API key invalid');
    });
  });

  describe('full recording flow', () => {
    test('dormant → recording → processing → success → dormant', () => {
      expect(sm.transition('recording')).toBe(true);
      expect(sm.transition('processing')).toBe(true);
      expect(sm.transition('success')).toBe(true);
      expect(sm.transition('dormant')).toBe(true);
      expect(sm.state).toBe('dormant');
    });

    test('dormant → recording → dormant (cancel during recording)', () => {
      expect(sm.transition('recording')).toBe(true);
      expect(sm.transition('dormant')).toBe(true);
      expect(sm.state).toBe('dormant');
    });

    test('dormant → recording → processing → dormant (cancel during processing)', () => {
      expect(sm.transition('recording')).toBe(true);
      expect(sm.transition('processing')).toBe(true);
      expect(sm.transition('dormant')).toBe(true);
      expect(sm.state).toBe('dormant');
    });

    test('success → recording (back-to-back recording)', () => {
      sm.transition('recording');
      sm.transition('processing');
      sm.transition('success');
      expect(sm.transition('recording')).toBe(true);
      expect(sm.state).toBe('recording');
    });

    test('error → recording (recover from error)', () => {
      sm.transition('recording');
      sm.transition('processing');
      sm.transition('error', 'API failed');
      expect(sm.transition('recording')).toBe(true);
      expect(sm.state).toBe('recording');
    });
  });

  describe('listeners', () => {
    test('notifies on valid transition', () => {
      const events = [];
      sm.on((e) => events.push(e));
      sm.transition('recording');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ from: 'dormant', to: 'recording', message: '' });
    });

    test('does not notify on invalid transition', () => {
      const events = [];
      sm.transition('recording');
      sm.transition('processing');
      sm.transition('success');
      sm.on((e) => events.push(e));
      sm.transition('processing'); // invalid from success
      expect(events).toHaveLength(0);
    });

    test('unsubscribe stops notifications', () => {
      const events = [];
      const unsub = sm.on((e) => events.push(e));
      sm.transition('recording');
      unsub();
      sm.transition('processing');
      expect(events).toHaveLength(1);
    });

    test('listener error does not break other listeners', () => {
      const events = [];
      sm.on(() => { throw new Error('boom'); });
      sm.on((e) => events.push(e));
      sm.transition('recording');
      expect(events).toHaveLength(1);
    });

    test('includes message in event', () => {
      const events = [];
      sm.on((e) => events.push(e));
      sm.transition('recording', 'Starting now');
      expect(events[0].message).toBe('Starting now');
    });
  });

  describe('reset()', () => {
    test('forces transition to dormant from any state', () => {
      sm.transition('recording');
      sm.transition('processing');
      sm.reset();
      expect(sm.state).toBe('dormant');
    });

    test('notifies listeners with forced flag', () => {
      const events = [];
      sm.on((e) => events.push(e));
      sm.transition('recording');
      sm.reset('Emergency reset');
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({
        from: 'recording',
        to: 'dormant',
        message: 'Emergency reset',
        forced: true,
      });
    });

    test('sets message when provided', () => {
      sm.transition('recording');
      sm.reset('Sidecar crashed');
      expect(sm.message).toBe('Sidecar crashed');
    });
  });

  describe('logger', () => {
    test('logs transitions when logger provided', () => {
      const logs = [];
      const s = new StateMachine('dormant', { logger: (msg) => logs.push(msg) });
      s.transition('recording');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]).toContain('dormant → recording');
    });

    test('logs invalid transitions', () => {
      const logs = [];
      const s = new StateMachine('dormant', { logger: (msg) => logs.push(msg) });
      s.transition('recording');
      s.transition('processing');
      s.transition('success');
      const prevLen = logs.length;
      s.transition('processing'); // invalid from success
      expect(logs[prevLen]).toContain('Invalid transition');
    });
  });
});
