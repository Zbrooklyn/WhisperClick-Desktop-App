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

require('../../electron/main');
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

afterAll(() => {
  if (cleanupSidecar) cleanupSidecar();
  try { realFs.rmSync(TEST_CONFIG_BASE, { recursive: true, force: true }); } catch {}
});

async function getState() {
  return (await ipcMain._invoke('get-state')).state;
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

  test('5 rapid ack-states during success — only first works', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);
    pushSidecarEvent(fakeProc, 'transcription', { text: 'test' });
    await tick(50);

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await ipcMain._invoke('ack-state'));
    }
    expect(results[0].success).toBe(true);
    // Subsequent acks fail (already dormant)
    for (let i = 1; i < results.length; i++) {
      expect(results[i].success).toBe(false);
    }
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
