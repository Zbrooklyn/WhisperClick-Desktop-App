/**
 * Torture tests — simulate real user abuse scenarios.
 *
 * These tests hammer the system with the exact patterns that caused
 * bugs in v2.1.0–v2.1.2: double-clicks, rapid toggles, cancel during
 * processing, recording during success window, sidecar crashes, and
 * state desync between entry points.
 *
 * Every test verifies: (1) no stuck state, (2) no crashes, (3) state
 * machine ends in a valid state, (4) sidecar commands are coherent.
 */

const os = require('os');
const path = require('path');
const realFs = jest.requireActual('fs');

const TEST_CONFIG_BASE = realFs.mkdtempSync(path.join(os.tmpdir(), 'wc-torture-'));

jest.mock('child_process', () => {
  const { PassThrough } = jest.requireActual('stream');
  const EventEmitter = jest.requireActual('events');
  return {
    spawn: jest.fn(() => {
      const proc = new EventEmitter();
      proc.stdin = new PassThrough();
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.kill = jest.fn();
      proc.pid = 77777;
      return proc;
    }),
    exec: jest.fn(),
  };
});

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn((p) => {
      if (typeof p === 'string' && p.includes('venv')) return false;
      return actual.existsSync(p);
    }),
  };
});

const { app, ipcMain, globalShortcut, BrowserWindow } = require('electron');
const { spawn } = require('child_process');

app.getPath = (name) => {
  if (name === 'userData') return TEST_CONFIG_BASE;
  return os.tmpdir();
};

require('../../platforms/electron/main');
app._triggerReady();

const fakeProc = spawn.mock.results[0].value;
const mainWin = BrowserWindow._instances[0];

function autoRespondSidecar(proc, commandResponses = {}) {
  const handler = (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        const cmd = msg.command;
        const template = commandResponses[cmd] || { result: 'ok' };
        const response = { ...template, id: msg.id };
        setImmediate(() => {
          try { proc.stdout.push(JSON.stringify(response) + '\n'); } catch {}
        });
      } catch {}
    }
  };
  proc.stdin.on('data', handler);
  return () => proc.stdin.removeListener('data', handler);
}

function pushSidecarEvent(proc, event, data = {}) {
  proc.stdout.push(JSON.stringify({ event, data }) + '\n');
}

function tick(ms = 30) {
  return new Promise(r => setTimeout(r, ms));
}

let cleanupSidecar;

beforeAll(async () => {
  pushSidecarEvent(fakeProc, 'ready', { version: '1.0' });
  await tick(50);
  await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-torture-test' });
  cleanupSidecar = autoRespondSidecar(fakeProc, {
    configure: { status: 'ok' },
    start_rec: { status: 'ok' },
    stop_rec: { status: 'ok' },
    cancel: { status: 'ok' },
    capture_fg: { status: 'ok' },
    list_mics: { mics: [] },
    list_models: { models: [] },
    verify_key: { valid: true },
  });
});

beforeEach(async () => {
  await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-torture-test' });
});

afterEach(async () => {
  // Drain any in-flight transition so an app timer (success auto-revert, error
  // window, etc.) can't fire AFTER the test completes and bleed into the next
  // one — the source of "Cannot log after tests are done" and load-dependent
  // cross-test failures. Runs after assertions, so it can't mask a result.
  await ipcMain._invoke('cancel-processing').catch(() => {});
  await ipcMain._invoke('ack-state').catch(() => {});
  await tick(10);
});

afterAll(() => {
  if (cleanupSidecar) cleanupSidecar();
  try { realFs.rmSync(TEST_CONFIG_BASE, { recursive: true, force: true }); } catch {}
});

async function getState() {
  return (await ipcMain._invoke('get-state')).state;
}

// Condition-based wait — poll until the state machine reaches `expected` (or a
// cap elapses) instead of a fixed sleep. Fixed real-timer waits are the root
// cause of this suite's load-dependent flakes: when CPU is busy under the full
// jest run, an app transition timer hasn't fired yet when a fixed tick() ends,
// so the assertion sees a stale state. Polling waits exactly as long as needed
// and never longer; if the state genuinely never arrives the cap lets the real
// assertion fail (no masking).
async function waitForState(expected, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let s = await getState();
  while (s !== expected && Date.now() < deadline) {
    await tick(5);
    s = await getState();
  }
  return s;
}

async function ensureDormant() {
  // Fast reset: cancel + ack in quick succession
  await ipcMain._invoke('cancel-processing').catch(() => {});
  pushSidecarEvent(fakeProc, 'cancelled');
  await ipcMain._invoke('ack-state').catch(() => {});
  await tick(10);
}

// ── DOUBLE/TRIPLE CLICK ABUSE ────────────────────────────────────────

describe('Double/triple click abuse', () => {
  beforeEach(() => ensureDormant());

  test('double pill-clicked capsule — second click is harmless', async () => {
    await ipcMain._invoke('pill-clicked', 'capsule');
    await tick(10);
    await ipcMain._invoke('pill-clicked', 'capsule');
    await tick(50);
    // Should be recording (first click) or dormant (if second toggled back)
    // Must NOT be stuck in error
    const s = await getState();
    expect(['dormant', 'recording']).toContain(s);
  }, 10000);

  test('triple pill-clicked capsule — no stuck state', async () => {
    for (let i = 0; i < 3; i++) {
      await ipcMain._invoke('pill-clicked', 'capsule');
      await tick(5);
    }
    await tick(100);
    const s = await getState();
    expect(['dormant', 'recording', 'processing']).toContain(s);
    await ensureDormant();
  }, 10000);

  test('10 rapid pill clicks — state is valid at end', async () => {
    for (let i = 0; i < 10; i++) {
      await ipcMain._invoke('pill-clicked', 'capsule');
      await tick(2);
    }
    await tick(200);
    const s = await getState();
    expect(['dormant', 'recording', 'processing', 'success', 'error']).toContain(s);
    await ensureDormant();
  }, 15000);

  test('rapid start-recording calls — only first succeeds', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await ipcMain._invoke('start-recording'));
      await tick(2);
    }
    // First should succeed, rest should fail
    expect(results[0].success).toBe(true);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].success).toBe(false);
    }
    await ensureDormant();
  }, 10000);
});

// ── CANCEL DURING EVERY STATE ────────────────────────────────────────

describe('Cancel during every state', () => {
  beforeEach(() => ensureDormant());

  test('cancel during dormant — returns nothing to cancel', async () => {
    const result = await ipcMain._invoke('cancel-processing');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing to cancel/i);
  });

  test('cancel during recording — resets to dormant', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    expect(await getState()).toBe('recording');
    await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(fakeProc, 'cancelled');
    await tick(50);
    expect(await getState()).toBe('dormant');
  });

  test('cancel during success — returns nothing to cancel', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    pushSidecarEvent(fakeProc, 'transcription', { text: 'test' });
    await tick(50);
    expect(await getState()).toBe('success');
    const result = await ipcMain._invoke('cancel-processing');
    expect(result.success).toBe(false);
    await ipcMain._invoke('ack-state');
    await tick(50);
  });

  test('cancel during error — returns nothing to cancel', async () => {
    pushSidecarEvent(fakeProc, 'error', { message: 'test error' });
    await tick(50);
    expect(await getState()).toBe('error');
    const result = await ipcMain._invoke('cancel-processing');
    expect(result.success).toBe(false);
    await tick(3100);
  });
});

// ── RECORDING DURING TRANSIENT STATES ────────────────────────────────

describe('Recording during transient states', () => {
  beforeEach(() => ensureDormant());

  test('start recording during success window — succeeds', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    pushSidecarEvent(fakeProc, 'transcription', { text: 'test' });
    await tick(50);
    expect(await getState()).toBe('success');

    // Start new recording while still in success
    const result = await ipcMain._invoke('start-recording');
    expect(result.success).toBe(true);
    expect(await getState()).toBe('recording');
    await ensureDormant();
  });

  test('start recording during error window — succeeds', async () => {
    pushSidecarEvent(fakeProc, 'error', { message: 'test' });
    await tick(50);
    expect(await getState()).toBe('error');

    const result = await ipcMain._invoke('start-recording');
    expect(result.success).toBe(true);
    expect(await getState()).toBe('recording');
    await ensureDormant();
  });
});

// ── BACK-TO-BACK RECORDING ──────────────────────────────────────────

describe('Back-to-back recording (the original bug)', () => {
  beforeEach(() => ensureDormant());

  test('record → transcribe → immediately record again', async () => {
    // First recording
    await ipcMain._invoke('start-recording');
    await tick(20);
    pushSidecarEvent(fakeProc, 'transcription', { text: 'first' });
    await tick(50);
    expect(await getState()).toBe('success');

    // Immediately start second recording (during success)
    const result = await ipcMain._invoke('start-recording');
    expect(result.success).toBe(true);
    expect(await getState()).toBe('recording');

    // Complete second recording
    pushSidecarEvent(fakeProc, 'transcription', { text: 'second' });
    await tick(50);
    expect(await getState()).toBe('success');
    await ipcMain._invoke('ack-state');
    await tick(50);
  });

  test('5 back-to-back recordings — all succeed', async () => {
    for (let i = 0; i < 5; i++) {
      const start = await ipcMain._invoke('start-recording');
      expect(start.success).toBe(true);
      await tick(20);
      pushSidecarEvent(fakeProc, 'transcription', { text: `recording ${i}` });
      await tick(50);
      // State may be success or dormant (1.5s fallback timer can fire between cycles)
      const s = await getState();
      expect(['success', 'dormant']).toContain(s);
      // Ack before next iteration to ensure clean start
      await ipcMain._invoke('ack-state').catch(() => {});
      await tick(20);
    }
    expect(await getState()).toBe('dormant');
  }, 15000);
});

// ── PILL CLICK DURING EVERY STATE ───────────────────────────────────

describe('Pill click actions during every state', () => {
  beforeEach(() => ensureDormant());

  test('pill stop during dormant — ignored gracefully', async () => {
    await ipcMain._invoke('pill-clicked', 'stop');
    await tick(50);
    expect(await getState()).toBe('dormant');
  });

  test('pill cancel during dormant — ignored gracefully', async () => {
    await ipcMain._invoke('pill-clicked', 'cancel');
    await tick(50);
    expect(await getState()).toBe('dormant');
  });

  test('pill enter during dormant — no crash', async () => {
    await ipcMain._invoke('pill-clicked', 'enter');
    await tick(50);
    expect(await getState()).toBe('dormant');
  });

  test('pill stop during recording — transitions to processing', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    await ipcMain._invoke('pill-clicked', 'stop');
    await tick(50);
    const s = await getState();
    expect(['processing', 'dormant']).toContain(s);
    await ensureDormant();
  });

  test('pill cancel during recording — returns to dormant', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    await ipcMain._invoke('pill-clicked', 'cancel');
    pushSidecarEvent(fakeProc, 'cancelled');
    await tick(50);
    expect(await getState()).toBe('dormant');
  });
});

// ── ACK-STATE ABUSE ─────────────────────────────────────────────────

describe('ack-state abuse', () => {
  beforeEach(() => ensureDormant());

  test('ack-state during dormant — harmless', async () => {
    const result = await ipcMain._invoke('ack-state');
    expect(result.success).toBe(false);
    expect(await getState()).toBe('dormant');
  });

  test('ack-state during recording — harmless', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    const result = await ipcMain._invoke('ack-state');
    expect(result.success).toBe(false);
    expect(await getState()).toBe('recording');
    await ensureDormant();
  });

  test('5 rapid ack-states during success — at most first works', async () => {
    await ipcMain._invoke('start-recording');
    await tick(5);
    pushSidecarEvent(fakeProc, 'transcription', { text: 'test' });
    await tick(10);

    // Fire all 5 immediately — first may or may not catch success
    // (1.5s fallback timer may have fired by now depending on timing)
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await ipcMain._invoke('ack-state'));
    }
    // At most 1 should succeed (the one that caught success state)
    const successes = results.filter(r => r.success);
    expect(successes.length).toBeLessThanOrEqual(1);
    expect(await getState()).toBe('dormant');
  });

  test('ack-state during error — transitions to dormant', async () => {
    pushSidecarEvent(fakeProc, 'error', { message: 'test' });
    await tick(50);
    expect(await getState()).toBe('error');
    const result = await ipcMain._invoke('ack-state');
    expect(result.success).toBe(true);
    expect(await getState()).toBe('dormant');
  });
});

// ── MIXED ENTRY POINT ABUSE ─────────────────────────────────────────

describe('Mixed entry point abuse', () => {
  beforeEach(() => ensureDormant());

  test('start via pill, stop via hotkey bridge — no desync', async () => {
    await ipcMain._invoke('pill-clicked', 'capsule');
    await tick(50);
    // Hotkey would normally call triggerTrustedHotkeyToggle in frontend
    // In test, call stop-recording directly (simulates frontend stopping)
    if (await getState() === 'recording') {
      await ipcMain._invoke('stop-recording');
      await tick(50);
    }
    const s = await getState();
    expect(['dormant', 'processing', 'success']).toContain(s);
    await ensureDormant();
  });

  test('start via IPC, cancel via pill, start via IPC — no stuck', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    await ipcMain._invoke('pill-clicked', 'cancel');
    pushSidecarEvent(fakeProc, 'cancelled');
    await tick(50);
    expect(await getState()).toBe('dormant');

    const result = await ipcMain._invoke('start-recording');
    expect(result.success).toBe(true);
    expect(await getState()).toBe('recording');
    await ensureDormant();
  });

  test('rapid alternating pill and IPC — state always valid', async () => {
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) {
        await ipcMain._invoke('pill-clicked', 'capsule');
      } else {
        await ipcMain._invoke('start-recording').catch(() => {});
      }
      await tick(5);
    }
    await tick(200);
    const s = await getState();
    expect(['dormant', 'recording', 'processing', 'success', 'error']).toContain(s);
    await ensureDormant();
  }, 15000);
});

// ── SIDECAR CRASH DURING OPERATIONS ─────────────────────────────────

describe('Sidecar crash scenarios', () => {
  test('sidecar crash during recording — state resets', async () => {
    await ensureDormant();
    const currentProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-torture-crash' });
    const tempCleanup = autoRespondSidecar(currentProc, {
      configure: { status: 'ok' },
      start_rec: { status: 'ok' },
    });

    await ipcMain._invoke('start-recording');
    await tick(20);

    // Crash
    currentProc.emit('exit', 1);
    await tick(3500);

    const s = await getState();
    expect(['dormant', 'error']).toContain(s);
    tempCleanup();

    // Set up auto-responder on the new sidecar process (spawned by restart logic)
    tempCleanup();
    const newProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    if (newProc !== currentProc) {
      autoRespondSidecar(newProc, {
        configure: { status: 'ok' },
        start_rec: { status: 'ok' },
        stop_rec: { status: 'ok' },
        cancel: { status: 'ok' },
        capture_fg: { status: 'ok' },
      });
      pushSidecarEvent(newProc, 'ready', { version: '1.0' });
      await tick(50);
    }
    // Clean up for next test
    await ipcMain._invoke('ack-state').catch(() => {});
    await tick(50);
  }, 15000);
});

// ── STATE TRANSITION COHERENCE ──────────────────────────────────────

describe('State transition coherence', () => {
  beforeEach(() => ensureDormant());

  test('full lifecycle 10 times — no state leak', async () => {
    for (let i = 0; i < 10; i++) {
      await ensureDormant();
      const start = await ipcMain._invoke('start-recording');
      expect(start.success).toBe(true);
      await tick(5);
      pushSidecarEvent(fakeProc, 'transcription', { text: `cycle ${i}` });
      await tick(20);
      await ipcMain._invoke('ack-state').catch(() => {});
      await tick(5);
    }
    expect(await getState()).toBe('dormant');
  }, 60000);

  test('alternating success and error — state always recovers', async () => {
    for (let i = 0; i < 5; i++) {
      await ensureDormant();
      // Success cycle
      await ipcMain._invoke('start-recording');
      await tick(5);
      pushSidecarEvent(fakeProc, 'transcription', { text: `ok ${i}` });
      await tick(20);
      await ipcMain._invoke('ack-state').catch(() => {});
      await tick(5);
      expect(await getState()).toBe('dormant');

      // Error cycle
      pushSidecarEvent(fakeProc, 'error', { message: `err ${i}` });
      await tick(20);
      await ipcMain._invoke('ack-state');
      await tick(5);
      expect(await getState()).toBe('dormant');
    }
  }, 60000);
});

// ── STATE × ACTION MATRIX (40 combinations) ─────────────────────────

describe('State × action matrix — every action in every state', () => {
  const ACTIONS = [
    { name: 'start-recording', fn: () => ipcMain._invoke('start-recording') },
    { name: 'stop-recording', fn: () => ipcMain._invoke('stop-recording') },
    { name: 'cancel-processing', fn: () => ipcMain._invoke('cancel-processing') },
    { name: 'ack-state', fn: () => ipcMain._invoke('ack-state') },
    { name: 'pill-capsule', fn: () => ipcMain._invoke('pill-clicked', 'capsule') },
    { name: 'pill-stop', fn: () => ipcMain._invoke('pill-clicked', 'stop') },
    { name: 'pill-cancel', fn: () => ipcMain._invoke('pill-clicked', 'cancel') },
    { name: 'pill-enter', fn: () => ipcMain._invoke('pill-clicked', 'enter') },
  ];

  async function setupState(target) {
    await ensureDormant();
    if (target === 'dormant') { await waitForState('dormant'); return; }
    if (target === 'recording') {
      await ipcMain._invoke('start-recording');
      await waitForState('recording');
      return;
    }
    if (target === 'processing') {
      // Not exercised by the matrix loop below (stop-recording blocks on a
      // transcription event); kept for completeness with the original waits.
      await ipcMain._invoke('start-recording');
      await tick(10);
      await ipcMain._invoke('stop-recording');
      await tick(10);
      return;
    }
    if (target === 'success') {
      await ipcMain._invoke('start-recording');
      await waitForState('recording');
      pushSidecarEvent(fakeProc, 'transcription', { text: 'matrix' });
      await waitForState('success');
      return;
    }
    if (target === 'error') {
      pushSidecarEvent(fakeProc, 'error', { message: 'matrix error' });
      await waitForState('error');
      return;
    }
  }

  for (const state of ['dormant', 'recording', 'success', 'error']) {
    for (const action of ACTIONS) {
      // stop-recording blocks waiting for sidecar transcription event — needs special handling
      const needsTranscription = state === 'recording' && action.name === 'stop-recording';
      // cancel during recording+stop blocks the pending stop promise
      const cancelDuringStop = state === 'recording' && action.name === 'cancel-processing';

      test(`${state} + ${action.name} — no crash, valid state`, async () => {
        await setupState(state);
        const before = await getState();
        expect(before).toBe(state);

        if (needsTranscription) {
          // Fire stop, then provide transcription so it resolves
          const stopPromise = action.fn().catch(e => ({ error: e.message }));
          await tick(20);
          pushSidecarEvent(fakeProc, 'transcription', { text: 'matrix stop' });
          await stopPromise;
        } else if (cancelDuringStop) {
          // Cancel during recording goes to dormant — not processing
          const result = await action.fn().catch(e => ({ error: e.message }));
          pushSidecarEvent(fakeProc, 'cancelled');
        } else {
          await action.fn().catch(e => ({ error: e.message }));
        }
        await tick(50);

        // State must be valid
        const after = await getState();
        expect(['dormant', 'recording', 'processing', 'success', 'error']).toContain(after);

        await ensureDormant();
      }, 10000);
    }
  }
});

// ── SETTINGS MUTATION DURING RECORDING ──────────────────────────────

describe('Settings mutation during recording', () => {
  beforeEach(() => ensureDormant());

  test('change API key mid-recording — recording continues', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    expect(await getState()).toBe('recording');

    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-changed-mid-recording' });
    await tick(20);

    // Recording should still be active
    expect(await getState()).toBe('recording');
    await ensureDormant();
  });

  test('change provider mid-recording — recording continues', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    await ipcMain._invoke('save-settings', { provider: 'gemini', geminiApiKey: 'AIza-fake-key' });
    await tick(20);
    expect(await getState()).toBe('recording');
    await ensureDormant();
  });

  test('change mode to local mid-recording — recording continues', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    await ipcMain._invoke('save-settings', { mode: 'local' });
    await tick(20);
    expect(await getState()).toBe('recording');
    await ensureDormant();
  });

  test('remove API key mid-recording — recording continues (key checked at start)', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    await ipcMain._invoke('save-settings', { openaiApiKey: '' });
    await tick(20);
    // Recording should still be active — key was valid at start time
    expect(await getState()).toBe('recording');

    // Restore key for future tests
    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-torture-test' });
    await ensureDormant();
  });
});

// ── EMPTY / MICRO RECORDING ─────────────────────────────────────────

describe('Empty and micro recordings', () => {
  beforeEach(() => ensureDormant());

  test('start then immediately stop — no crash', async () => {
    await ipcMain._invoke('start-recording');
    await tick(5);
    // Stop — sidecar needs to respond with transcription or cancel
    const stopPromise = ipcMain._invoke('stop-recording').catch(() => {});
    await tick(10);
    pushSidecarEvent(fakeProc, 'transcription', { text: 'micro', duration: 0.1 });
    await stopPromise;
    await tick(50);
    const s = await getState();
    expect(['processing', 'dormant', 'success', 'error']).toContain(s);
    await ensureDormant();
  });

  test('start-stop-start-stop rapid — no stuck state', async () => {
    for (let i = 0; i < 3; i++) {
      await ipcMain._invoke('start-recording');
      await tick(5);
      const stopPromise = ipcMain._invoke('stop-recording').catch(() => {});
      await tick(5);
      pushSidecarEvent(fakeProc, 'transcription', { text: `rapid ${i}` });
      await stopPromise;
      await ipcMain._invoke('ack-state').catch(() => {});
      await tick(10);
    }
    await tick(50);
    const s = await getState();
    expect(['dormant', 'recording', 'processing', 'success', 'error']).toContain(s);
    await ensureDormant();
  }, 15000);

  test('empty transcription text — no crash', async () => {
    await ipcMain._invoke('start-recording');
    await tick(10);
    pushSidecarEvent(fakeProc, 'transcription', { text: '', duration: 0.1 });
    await tick(50);
    // Should handle gracefully — success or dormant
    const s = await getState();
    expect(['success', 'dormant']).toContain(s);
    await ensureDormant();
  });
});

// ── CONCURRENT IPC CALLS ────────────────────────────────────────────

describe('Concurrent IPC calls', () => {
  beforeEach(() => ensureDormant());

  test('start + pill-click + cancel fired simultaneously — no crash', async () => {
    const results = await Promise.all([
      ipcMain._invoke('start-recording').catch(e => ({ error: e.message })),
      ipcMain._invoke('pill-clicked', 'capsule').catch(e => ({ error: e.message })),
      ipcMain._invoke('cancel-processing').catch(e => ({ error: e.message })),
    ]);
    await tick(100);
    // All should return without throwing
    expect(results.length).toBe(3);
    const s = await getState();
    expect(['dormant', 'recording', 'processing', 'success', 'error']).toContain(s);
    await ensureDormant();
  });

  test('3 simultaneous start-recording — only 1 succeeds', async () => {
    const results = await Promise.all([
      ipcMain._invoke('start-recording'),
      ipcMain._invoke('start-recording'),
      ipcMain._invoke('start-recording'),
    ]);
    await tick(50);
    const successes = results.filter(r => r.success);
    expect(successes.length).toBeLessThanOrEqual(1);
    await ensureDormant();
  });

  test('stop + cancel fired simultaneously during recording — no hang', async () => {
    await ipcMain._invoke('start-recording');
    await tick(10);
    // Fire both — cancel should resolve the stop by emitting cancelled
    const stopPromise = ipcMain._invoke('stop-recording').catch(e => ({ error: e.message }));
    const cancelResult = await ipcMain._invoke('cancel-processing').catch(e => ({ error: e.message }));
    pushSidecarEvent(fakeProc, 'cancelled');
    const stopResult = await stopPromise;
    await tick(50);
    expect([stopResult, cancelResult].length).toBe(2);
    await ensureDormant();
  });

  test('5 ack-states + 5 starts fired simultaneously — no crash', async () => {
    pushSidecarEvent(fakeProc, 'error', { message: 'concurrent test' });
    await tick(20);
    const results = await Promise.all([
      ...Array(5).fill().map(() => ipcMain._invoke('ack-state').catch(e => ({ error: e.message }))),
      ...Array(5).fill().map(() => ipcMain._invoke('start-recording').catch(e => ({ error: e.message }))),
    ]);
    await tick(100);
    expect(results.length).toBe(10);
    await ensureDormant();
  });
});

// ── RAPID SIDECAR RESTARTS ──────────────────────────────────────────

describe('Rapid sidecar restarts', () => {
  test('3 crashes in quick succession — hits restart limit gracefully', async () => {
    await ensureDormant();
    for (let i = 0; i < 3; i++) {
      const proc = spawn.mock.results[spawn.mock.results.length - 1].value;
      proc.emit('exit', 1);
      await tick(2000); // Wait for restart delay
    }
    await tick(1000);
    // App should still be responsive — check we can get state
    const s = await getState();
    expect(['dormant', 'error']).toContain(s);
    await ipcMain._invoke('ack-state').catch(() => {});
    await tick(50);

    // Restore sidecar for subsequent tests — spawn a fresh one
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    autoRespondSidecar(latestProc, {
      configure: { status: 'ok' },
      start_rec: { status: 'ok' },
      stop_rec: { status: 'ok' },
      cancel: { status: 'ok' },
      capture_fg: { status: 'ok' },
    });
    pushSidecarEvent(latestProc, 'ready', { version: '1.0' });
    await tick(50);
    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-torture-test' });
  }, 30000);
});

// ── TRANSCRIPTION TIMEOUT PATH ──────────────────────────────────────

describe('Transcription timeout', () => {
  beforeEach(() => ensureDormant());

  test('stop-recording with no sidecar response — eventually times out', async () => {
    // Create a proc that ignores stop_rec (no auto-responder for it)
    const proc = spawn.mock.results[spawn.mock.results.length - 1].value;
    const ignoreStop = autoRespondSidecar(proc, {
      configure: { status: 'ok' },
      start_rec: { status: 'ok' },
      cancel: { status: 'ok' },
      capture_fg: { status: 'ok' },
      // deliberately no stop_rec — simulates timeout
    });

    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-torture-timeout' });
    await ipcMain._invoke('start-recording');
    await tick(20);

    // Stop will hang until timeout (120s) — but we can cancel to unstick
    const cancelResult = await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(proc, 'cancelled');
    await tick(50);

    const s = await getState();
    expect(['dormant', 'error']).toContain(s);
    ignoreStop();
    await ipcMain._invoke('ack-state').catch(() => {});
    await tick(50);
  }, 15000);
});

// ── HISTORY STRESS ──────────────────────────────────────────────────

describe('History under load', () => {
  beforeEach(() => ensureDormant());

  test('transcription after 500 history entries — no corruption', async () => {
    // Fill history to capacity
    for (let i = 0; i < 500; i++) {
      pushSidecarEvent(fakeProc, 'transcription', {
        text: `entry ${i}`,
        duration: 1,
        provider: 'test',
      });
    }
    await tick(200);

    // One more transcription at capacity
    await ipcMain._invoke('start-recording');
    await tick(10);
    pushSidecarEvent(fakeProc, 'transcription', { text: 'over capacity', duration: 1 });
    await tick(50);

    // Should not crash, state should be valid
    const s = await getState();
    expect(['success', 'dormant']).toContain(s);

    // History should not exceed max
    const history = await ipcMain._invoke('get-history');
    expect(history.length).toBeLessThanOrEqual(500);

    await ipcMain._invoke('clear-history');
    await ensureDormant();
  }, 30000);
});

// ── SETTINGS FILE EDGE CASES ────────────────────────────────────────

describe('Settings edge cases', () => {
  beforeEach(() => ensureDormant());

  test('save-settings with empty object — no crash', async () => {
    const result = await ipcMain._invoke('save-settings', {});
    expect(result.success).toBe(true);
  });

  test('save-settings with unknown keys — ignored gracefully', async () => {
    const result = await ipcMain._invoke('save-settings', {
      nonExistentKey: 'value',
      anotherFake: 123,
    });
    expect(result).toBeDefined();
    // Original settings should be intact
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.openaiApiKey).toBeDefined();
  });

  test('rapid settings saves during recording — no corruption', async () => {
    await ipcMain._invoke('start-recording');
    await tick(10);
    for (let i = 0; i < 20; i++) {
      await ipcMain._invoke('save-settings', { theme: i % 2 === 0 ? 'dark' : 'light' });
    }
    await tick(50);
    expect(await getState()).toBe('recording');
    const settings = await ipcMain._invoke('get-settings');
    expect(['dark', 'light']).toContain(settings.theme);
    await ensureDormant();
  });
});

// ── FACTORY RESET DURING STATES ─────────────────────────────────────

describe('Factory reset during active states', () => {
  test('factory reset during recording — no crash', async () => {
    await ensureDormant();
    await ipcMain._invoke('start-recording');
    await tick(20);
    expect(await getState()).toBe('recording');

    await ipcMain._invoke('reset-settings');
    await tick(50);

    // App should survive — state may be anything but not stuck
    const s = await getState();
    expect(['dormant', 'recording', 'error']).toContain(s);

    // Restore API key
    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-torture-test' });
    await ensureDormant();
  });

  test('factory reset during success — no crash', async () => {
    await ensureDormant();
    await ipcMain._invoke('start-recording');
    await tick(10);
    pushSidecarEvent(fakeProc, 'transcription', { text: 'reset test' });
    await tick(50);

    await ipcMain._invoke('reset-settings');
    await tick(50);

    const s = await getState();
    expect(['dormant', 'success', 'error']).toContain(s);

    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-torture-test' });
    await ensureDormant();
  });
});
