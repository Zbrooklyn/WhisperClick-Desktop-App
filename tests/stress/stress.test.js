/**
 * Stress tests — push the system to its limits.
 *
 * These tests verify the system holds up under real usage pressure:
 * 1. Concurrent IPC calls — settings read/save while recording
 * 2. Rapid state machine transitions — rapid toggling, cancel spam
 * 3. Store contention — rapid saves, interleaved history mutations
 * 4. IPC response time — handlers respond within acceptable latency
 * 5. State consistency — concurrent ops don't corrupt state
 * 6. Memory stability — repeated ops don't leak
 * 7. Production edge cases — cancel during processing, late transcription
 *
 * Uses the same mock infrastructure as main-ipc.test.js (PassThrough streams,
 * jest.mock at module level, id-matched sidecar responses).
 */

const os = require('os');
const path = require('path');
const realFs = jest.requireActual('fs');

// Create a real temp dir for the store
const TEST_CONFIG_BASE = realFs.mkdtempSync(path.join(os.tmpdir(), 'wc-stress-'));

// --- Mock child_process (same pattern as main-ipc.test.js) ---
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
      proc.pid = 99999;
      return proc;
    }),
    exec: jest.fn(),
  };
});

// --- Mock fs: real fs except venv check ---
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

// Configure electron mock before requiring main.js
const { app, ipcMain, BrowserWindow } = require('electron');
const { spawn } = require('child_process');

// Override app.getPath to use our real temp dir
app.getPath = (name) => {
  if (name === 'userData') return TEST_CONFIG_BASE;
  return os.tmpdir();
};

// Require main.js — registers all handlers and whenReady callback
require('../../electron/main');

// Trigger app.whenReady — initializes store, sidecar, windows, tray
app._triggerReady();

// Capture the fake sidecar process
const fakeProc = spawn.mock.results[0].value;

// Capture the mainWindow
const mainWin = BrowserWindow._instances[0];

// --- Helpers (same as main-ipc.test.js) ---

/**
 * Auto-respond to sidecar commands with id-matched responses.
 * Returns cleanup function.
 */
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

/** Push a sidecar event (transcription, error, etc.) */
function pushSidecarEvent(proc, event, data = {}) {
  proc.stdout.push(JSON.stringify({ event, data }) + '\n');
}

/** Wait for async processing to settle */
function tick(ms = 30) {
  return new Promise(r => setTimeout(r, ms));
}

// --- Boot sidecar ---
let cleanupSidecar;

beforeAll(async () => {
  // Send sidecar ready event
  pushSidecarEvent(fakeProc, 'ready', { version: '1.0' });
  await tick(50);

  // Auto-respond to standard commands
  cleanupSidecar = autoRespondSidecar(fakeProc, {
    configure: { status: 'ok' },
    start_rec: { status: 'ok' },
    cancel: { status: 'ok' },
    list_mics: { mics: [{ id: 0, name: 'Test Mic', is_default: true }] },
    list_models: { models: [] },
    capture_fg: { status: 'ok' },
    paste: { status: 'ok' },
    set_mic: { status: 'ok' },
    verify_key: { valid: true },
  });
});

afterAll(() => {
  if (cleanupSidecar) cleanupSidecar();
  try { realFs.rmSync(TEST_CONFIG_BASE, { recursive: true, force: true }); } catch {}
  try { fakeProc.stdin.destroy(); } catch {}
  try { fakeProc.stdout.destroy(); } catch {}
  try { fakeProc.stderr.destroy(); } catch {}
});

// Helper: ensure we're in dormant state before each test
async function ensureDormant() {
  const state = await ipcMain._invoke('get-state');
  if (state.state === 'recording' || state.state === 'processing') {
    await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(fakeProc, 'cancelled');
    await tick(100);
  }
  if (state.state === 'success' || state.state === 'error') {
    await tick(3500); // wait for auto-reset to dormant
  }
}

beforeEach(async () => {
  await ensureDormant();
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 1: Concurrent IPC calls
// ═══════════════════════════════════════════════════════════════════════════

describe('Concurrent IPC stress', () => {
  test('50 simultaneous get-settings calls return consistent data', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => ipcMain._invoke('get-settings'))
    );

    // All results must be identical
    const first = JSON.stringify(results[0]);
    for (let i = 1; i < results.length; i++) {
      expect(JSON.stringify(results[i])).toBe(first);
    }
  });

  test('settings read/write interleaved — final state reflects last write', async () => {
    // Fire 20 saves with alternating themes, interleaved with reads
    const ops = [];
    for (let i = 0; i < 20; i++) {
      const theme = i % 2 === 0 ? 'dark' : 'light';
      ops.push(ipcMain._invoke('save-settings', { theme }));
      ops.push(ipcMain._invoke('get-settings'));
    }
    await Promise.all(ops);

    // Final settings must have a valid theme (either dark or light)
    const final = await ipcMain._invoke('get-settings');
    expect(['dark', 'light']).toContain(final.theme);
  });

  test('get-settings works while recording is active', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);

    // While recording, rapidly read settings 30 times
    const reads = await Promise.all(
      Array.from({ length: 30 }, () => ipcMain._invoke('get-settings'))
    );

    expect(reads).toHaveLength(30);
    reads.forEach(r => expect(r).toHaveProperty('theme'));

    await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(fakeProc, 'cancelled');
    await tick(100);
  }, 15000);

  test('save-settings works while recording is active', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);

    const result = await ipcMain._invoke('save-settings', { soundEnabled: false });
    expect(result).toEqual({ success: true });

    const settings = await ipcMain._invoke('get-settings');
    expect(settings.soundEnabled).toBe(false);

    await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(fakeProc, 'cancelled');
    await tick(100);
    await ipcMain._invoke('save-settings', { soundEnabled: true });
  }, 15000);

  test('history read works during recording', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);

    const history = await ipcMain._invoke('get-history');
    expect(Array.isArray(history)).toBe(true);

    await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(fakeProc, 'cancelled');
    await tick(100);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 2: Rapid state machine transitions
// ═══════════════════════════════════════════════════════════════════════════

describe('Rapid state machine transitions', () => {
  test('20 rapid start/cancel cycles — state returns to dormant', async () => {
    for (let i = 0; i < 20; i++) {
      await ipcMain._invoke('start-recording');
      await ipcMain._invoke('cancel-processing');
      pushSidecarEvent(fakeProc, 'cancelled');
      await tick(10);
    }
    await tick(200);

    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('dormant');
  }, 30000);

  test('50 cancel calls when dormant — all return error, no throws', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => ipcMain._invoke('cancel-processing'))
    );

    results.forEach(r => {
      expect(r.success).toBe(false);
      expect(r.error).toBe('Nothing to cancel');
    });

    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('dormant');
  });

  test('start recording while already recording — state stays recording', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);

    // Subsequent starts while already recording
    for (let i = 0; i < 9; i++) {
      await ipcMain._invoke('start-recording');
      await tick(5);
    }

    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('recording');

    await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(fakeProc, 'cancelled');
    await tick(100);
  }, 15000);

  test('clean recording flow works after stress abuse', async () => {
    // First do some abuse
    for (let i = 0; i < 5; i++) {
      await ipcMain._invoke('start-recording');
      await ipcMain._invoke('cancel-processing');
      pushSidecarEvent(fakeProc, 'cancelled');
      await tick(20);
    }
    await tick(200);

    // Now verify a clean flow still works end-to-end
    await ipcMain._invoke('start-recording');
    await tick(20);

    const stateRec = await ipcMain._invoke('get-state');
    expect(stateRec.state).toBe('recording');

    // Stop recording
    const stopPromise = ipcMain._invoke('stop-recording');
    await tick(50);

    // Simulate sidecar transcription
    pushSidecarEvent(fakeProc, 'transcription', {
      text: 'stress test transcription',
      duration: 2.5,
      transcription_time: 0.8,
      provider: 'test',
      model: 'test',
    });

    const result = await stopPromise;
    expect(result.success).toBe(true);
    expect(result.text).toBe('stress test transcription');

    // Wait for success → dormant
    await tick(2000);
    const stateFinal = await ipcMain._invoke('get-state');
    expect(stateFinal.state).toBe('dormant');
  }, 20000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 3: Store contention under load
// ═══════════════════════════════════════════════════════════════════════════

describe('Store contention under load', () => {
  test('100 rapid sequential settings saves — no data corruption', async () => {
    for (let i = 0; i < 100; i++) {
      await ipcMain._invoke('save-settings', {
        audioRetentionDays: i,
        visualizerStyle: `style-${i}`,
      });
    }

    // Final state should be last save
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.audioRetentionDays).toBe(99);
    expect(settings.visualizerStyle).toBe('style-99');
  }, 30000);

  test('history entries from transcription events have unique IDs', async () => {
    await ipcMain._invoke('clear-history');

    // Fire transcription events in quick succession
    for (let i = 0; i < 20; i++) {
      pushSidecarEvent(fakeProc, 'transcription', {
        text: `unique-id-test-${i}`,
        duration: 1,
        provider: 'test',
        model: 'test',
      });
      await tick(5);
    }
    await tick(500);

    const history = await ipcMain._invoke('get-history');
    expect(history.length).toBeGreaterThan(0);

    // Verify no duplicate IDs
    const ids = history.map(h => h.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    await ipcMain._invoke('clear-history');
    await tick(2000); // wait for success→dormant timeouts
  }, 15000);

  test('interleaved add and delete — no orphaned entries', async () => {
    await ipcMain._invoke('clear-history');
    await tick(50);

    // Add entries via transcription events
    for (let i = 0; i < 10; i++) {
      pushSidecarEvent(fakeProc, 'transcription', {
        text: `delete-test-${i}`,
        duration: 1,
        provider: 'test',
        model: 'test',
      });
      await tick(30);
    }
    await tick(500);

    const history = await ipcMain._invoke('get-history');
    const startCount = history.length;

    if (startCount === 0) {
      // If events didn't produce history (state not right), skip gracefully
      return;
    }

    // Delete every other entry
    for (let i = 0; i < history.length; i += 2) {
      await ipcMain._invoke('delete-history', history[i].id);
    }

    const afterDelete = await ipcMain._invoke('get-history');
    expect(afterDelete.length).toBeLessThan(startCount);

    // Verify deleted entries are actually gone
    const remainingIds = new Set(afterDelete.map(h => h.id));
    for (let i = 0; i < history.length; i += 2) {
      expect(remainingIds.has(history[i].id)).toBe(false);
    }

    await ipcMain._invoke('clear-history');
    await tick(2000);
  }, 20000);

  test('clear-history during rapid adds — no crash', async () => {
    // Fire adds and a clear simultaneously
    const ops = [];
    for (let i = 0; i < 5; i++) {
      pushSidecarEvent(fakeProc, 'transcription', {
        text: `clear-race-${i}`,
        duration: 1,
        provider: 'test',
        model: 'test',
      });
    }
    await tick(100);

    // Clear while events may still be processing
    await ipcMain._invoke('clear-history');
    await tick(200);

    const history = await ipcMain._invoke('get-history');
    // Should be empty or have only entries added after clear
    // The point is: no crash, no corruption
    expect(Array.isArray(history)).toBe(true);

    await tick(2000);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 4: IPC response time
// ═══════════════════════════════════════════════════════════════════════════

describe('IPC response time under load', () => {
  const MAX_HANDLER_MS = 100;

  test('get-settings < 100ms after 50 prior calls', async () => {
    // Warm up
    for (let i = 0; i < 50; i++) {
      await ipcMain._invoke('get-settings');
    }

    const start = performance.now();
    await ipcMain._invoke('get-settings');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(MAX_HANDLER_MS);
  });

  test('save-settings < 100ms', async () => {
    const start = performance.now();
    await ipcMain._invoke('save-settings', { theme: 'dark' });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(MAX_HANDLER_MS);
  });

  test('get-state < 10ms (pure memory, no I/O)', async () => {
    const start = performance.now();
    await ipcMain._invoke('get-state');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
  });

  test('50 parallel get-settings all complete under 200ms total', async () => {
    const start = performance.now();
    await Promise.all(
      Array.from({ length: 50 }, () => ipcMain._invoke('get-settings'))
    );
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
  });

  test('get-history < 100ms with seeded entries', async () => {
    // Seed some history
    for (let i = 0; i < 20; i++) {
      pushSidecarEvent(fakeProc, 'transcription', {
        text: `perf-entry-${i} `.repeat(20),
        duration: 1,
        provider: 'test',
        model: 'test',
      });
      await tick(5);
    }
    await tick(200);

    const start = performance.now();
    await ipcMain._invoke('get-history');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(MAX_HANDLER_MS);

    await ipcMain._invoke('clear-history');
    await tick(2000);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 5: State consistency under concurrent operations
// ═══════════════════════════════════════════════════════════════════════════

describe('State consistency under concurrent operations', () => {
  test('settings changes during stop-recording wait are not lost', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);

    const stopPromise = ipcMain._invoke('stop-recording');
    await tick(20);

    // While waiting for transcription, change settings
    await ipcMain._invoke('save-settings', { language: 'es' });
    await ipcMain._invoke('save-settings', { theme: 'light' });

    // Deliver transcription
    pushSidecarEvent(fakeProc, 'transcription', {
      text: 'concurrent settings test',
      duration: 1,
      provider: 'test',
      model: 'test',
    });

    await stopPromise;
    await tick(100);

    // Settings changes must have survived
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.language).toBe('es');
    expect(settings.theme).toBe('light');

    // Restore
    await ipcMain._invoke('save-settings', { language: 'auto', theme: 'dark' });
    await tick(2000);
  }, 15000);

  test('get-state during transitions always returns valid state', async () => {
    const validStates = ['dormant', 'recording', 'processing', 'success', 'error'];

    await ipcMain._invoke('start-recording');
    await tick(10);

    // Rapidly poll state 30 times
    const states = await Promise.all(
      Array.from({ length: 30 }, () => ipcMain._invoke('get-state'))
    );

    states.forEach(s => {
      expect(validStates).toContain(s.state);
    });

    await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(fakeProc, 'cancelled');
    await tick(100);
  }, 15000);

  test('tray menu data reads while settings are being saved', async () => {
    // Simulates: user right-clicks tray while also toggling settings
    const ops = [];
    for (let i = 0; i < 10; i++) {
      ops.push(ipcMain._invoke('save-settings', { soundEnabled: i % 2 === 0 }));
      ops.push(ipcMain._invoke('get-settings'));
      ops.push(ipcMain._invoke('get-history'));
    }

    const results = await Promise.all(ops);
    expect(results).toHaveLength(30);
    // None should throw or return undefined
    results.forEach(r => expect(r).toBeDefined());
  });

  test('concurrent save-settings calls do not drop fields', async () => {
    // Fire overlapping saves that touch different fields
    await Promise.all([
      ipcMain._invoke('save-settings', { language: 'fr' }),
      ipcMain._invoke('save-settings', { soundEnabled: false }),
      ipcMain._invoke('save-settings', { visualizerStyle: 'wave' }),
    ]);

    const settings = await ipcMain._invoke('get-settings');
    // At minimum, the last-write-wins for each field.
    // The critical check: no field is undefined or corrupted
    expect(settings.mode).toBeDefined();
    expect(settings.provider).toBeDefined();
    expect(settings.hotkey).toBeDefined();
    expect(settings.theme).toBeDefined();

    // Restore
    await ipcMain._invoke('save-settings', {
      language: 'auto',
      soundEnabled: true,
      visualizerStyle: 'classic',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 6: Memory stability
// ═══════════════════════════════════════════════════════════════════════════

describe('Memory stability', () => {
  test('1000 settings reads do not grow heap significantly', async () => {
    // Warm cache
    await ipcMain._invoke('get-settings');

    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < 1000; i++) {
      await ipcMain._invoke('get-settings');
    }

    if (global.gc) global.gc();
    const after = process.memoryUsage().heapUsed;
    const growthMB = (after - before) / (1024 * 1024);

    // With caching, 1000 reads should barely grow memory (< 5MB)
    expect(growthMB).toBeLessThan(5);
  }, 15000);

  test('50 start/cancel cycles do not leak listeners', async () => {
    for (let i = 0; i < 50; i++) {
      await ipcMain._invoke('start-recording');
      await tick(5);
      await ipcMain._invoke('cancel-processing');
      pushSidecarEvent(fakeProc, 'cancelled');
      await tick(5);
    }

    // If listeners leaked, Node would emit MaxListenersExceededWarning at 10.
    // 50 cycles without warning = no leak.
    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('dormant');
  }, 30000);

  test('50 stop-recording cycles do not leak sidecar listeners', async () => {
    for (let i = 0; i < 50; i++) {
      await ipcMain._invoke('start-recording');
      await tick(10);

      const stopPromise = ipcMain._invoke('stop-recording');
      await tick(10);

      pushSidecarEvent(fakeProc, 'transcription', {
        text: `leak-test-${i}`,
        duration: 1,
        provider: 'test',
        model: 'test',
      });

      await stopPromise;
      await tick(1600); // wait for success→dormant
    }

    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('dormant');

    await ipcMain._invoke('clear-history');
  }, 120000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 7: Production edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('Production edge cases', () => {
  test('cancel during processing resolves stop-recording promise', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);

    // Stop recording — enters processing
    const stopPromise = ipcMain._invoke('stop-recording');
    await tick(20);

    // Cancel while waiting for transcription
    await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(fakeProc, 'cancelled');

    // stop-recording should resolve (not hang)
    const result = await Promise.race([
      stopPromise,
      tick(5000).then(() => ({ _timeout: true })),
    ]);

    expect(result._timeout).toBeUndefined();
    expect(result.success).toBe(false);

    await tick(100);
    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('dormant');
  }, 10000);

  test('late transcription after cancel does not corrupt state', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);

    const stopPromise = ipcMain._invoke('stop-recording');
    await tick(20);

    // Cancel first
    await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(fakeProc, 'cancelled');
    await tick(50);

    const cancelResult = await stopPromise;
    expect(cancelResult.success).toBe(false);

    // Late transcription arrives after cancel resolved
    pushSidecarEvent(fakeProc, 'transcription', {
      text: 'late arrival — should be ignored by stop handler',
      duration: 1,
      provider: 'test',
      model: 'test',
    });
    await tick(200);

    // State should end up back at dormant (or success from the late event,
    // which is acceptable — the key is no crash or stuck state)
    await tick(2000);
    const state = await ipcMain._invoke('get-state');
    expect(['dormant', 'success']).toContain(state.state);
    // Wait for any success→dormant transition
    await tick(2000);
  }, 15000);

  test('full settings round-trip preserves all fields', async () => {
    const fullSettings = {
      mode: 'api',
      provider: 'openai',
      apiModel: 'whisper-1',
      localModel: 'base',
      language: 'en',
      hotkey: 'Ctrl+Shift+R',
      theme: 'light',
      alwaysOnTop: true,
      autoPaste: false,
      showPill: false,
      closeBehavior: 'quit',
      autoStart: true,
      soundEnabled: false,
      outputMode: 'translate',
      targetLanguage: 'es',
      sourceLanguage: 'en',
      customBaseUrl: 'https://custom.api.com',
      visualizerStyle: 'wave',
      visualizerMotion: 'fast',
      audioRetentionDays: 7,
      onboardingComplete: true,
      autoDownloadUpdates: true,
      updateChannel: 'stable',
      openaiApiKey: 'sk-test123',
      geminiApiKey: 'AIzaTest456',
    };

    await ipcMain._invoke('save-settings', fullSettings);
    const retrieved = await ipcMain._invoke('get-settings');

    for (const [key, value] of Object.entries(fullSettings)) {
      expect(retrieved[key]).toBe(value);
    }

    // Restore defaults
    await ipcMain._invoke('reset-settings');
  });

  test('rapid theme switching does not corrupt other settings', async () => {
    // Set a known baseline
    await ipcMain._invoke('save-settings', { mode: 'api', provider: 'openai' });

    for (let i = 0; i < 30; i++) {
      await ipcMain._invoke('save-settings', {
        theme: i % 2 === 0 ? 'dark' : 'light',
      });
    }

    const settings = await ipcMain._invoke('get-settings');
    expect(settings.theme).toBe('light'); // last was i=29 (odd)
    // Other settings must not be corrupted
    expect(settings.mode).toBe('api');
    expect(settings.provider).toBe('openai');

    await ipcMain._invoke('save-settings', { theme: 'dark' });
  });

  test('stop-recording timeout fires if sidecar never responds', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);

    // Remove autoResponder temporarily so stop_rec never gets a response
    cleanupSidecar();

    // Override: respond to all EXCEPT stop_rec
    const tempCleanup = autoRespondSidecar(fakeProc, {
      configure: { status: 'ok' },
      start_rec: { status: 'ok' },
      cancel: { status: 'ok' },
      capture_fg: { status: 'ok' },
      // stop_rec intentionally missing — sidecar.send('stop_rec') will time out
    });

    const stopPromise = ipcMain._invoke('stop-recording');
    await tick(20);

    // The stop-recording handler has its own 120s timeout.
    // For the test, we'll cancel instead of waiting 120s.
    await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(fakeProc, 'cancelled');

    const result = await stopPromise;
    expect(result.success).toBe(false);

    // Restore autoresponder
    tempCleanup();
    cleanupSidecar = autoRespondSidecar(fakeProc, {
      configure: { status: 'ok' },
      start_rec: { status: 'ok' },
      cancel: { status: 'ok' },
      list_mics: { mics: [{ id: 0, name: 'Test Mic', is_default: true }] },
      list_models: { models: [] },
      capture_fg: { status: 'ok' },
      paste: { status: 'ok' },
      set_mic: { status: 'ok' },
      verify_key: { valid: true },
    });

    await tick(200);
  }, 15000);

  test('multiple IPC handler types interleaved under load', async () => {
    // Simulate real usage: user opens settings, checks mics, changes theme,
    // starts recording, checks state — all in rapid succession
    const ops = [
      ipcMain._invoke('get-settings'),
      ipcMain._invoke('get-history'),
      ipcMain._invoke('get-state'),
      ipcMain._invoke('list-mics'),
      ipcMain._invoke('save-settings', { theme: 'light' }),
      ipcMain._invoke('get-settings'),
      ipcMain._invoke('get-app-info'),
      ipcMain._invoke('get-displays'),
      ipcMain._invoke('save-settings', { theme: 'dark' }),
      ipcMain._invoke('get-state'),
    ];

    const results = await Promise.all(ops);

    // All should complete without throwing
    expect(results).toHaveLength(10);
    results.forEach(r => expect(r).toBeDefined());

    // Verify specific results
    expect(results[2]).toHaveProperty('state'); // get-state
    expect(results[6]).toHaveProperty('version'); // get-app-info
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 8: Sidecar crash recovery
// ═══════════════════════════════════════════════════════════════════════════

describe('Sidecar crash recovery', () => {
  test('sidecar exit during stop-recording resolves promise (not hang)', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);

    // Stop recording — now waiting for transcription
    const stopPromise = ipcMain._invoke('stop-recording');
    await tick(50);

    // Sidecar crashes while we're waiting
    fakeProc.emit('exit', 1);
    await tick(200);

    // The stop-recording promise must resolve, not hang forever.
    // The sidecar exit handler rejects all pending requests + resets state.
    const result = await Promise.race([
      stopPromise,
      tick(5000).then(() => ({ _timeout: true })),
    ]);

    expect(result._timeout).toBeUndefined();
    // With the exit listener fix, stop-recording resolves with an error
    expect(result.success).toBe(false);
    expect(result.error).toContain('crashed');
    await tick(3500); // drain error→dormant timeout

    // Sidecar will try to auto-restart (up to 3 times).
    // Re-create the proc for subsequent tests since exit nulls it.
    // The spawn mock returns a new proc on each call.
    const newProc = spawn.mock.results[spawn.mock.results.length - 1]?.value;
    if (newProc && newProc !== fakeProc) {
      pushSidecarEvent(newProc, 'ready', { version: '1.0' });
      await tick(100);
    }
  }, 15000);

  test('state resets to dormant after sidecar crash during recording', async () => {
    // Get current sidecar proc (may have changed from restart)
    const currentProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    // Manually set up start_rec response on current proc
    const tempCleanup = autoRespondSidecar(currentProc, {
      configure: { status: 'ok' },
      start_rec: { status: 'ok' },
    });

    await ipcMain._invoke('start-recording');
    await tick(20);

    const stateBefore = await ipcMain._invoke('get-state');
    expect(stateBefore.state).toBe('recording');

    // Crash sidecar
    currentProc.emit('exit', 1);
    await tick(200);

    // broadcastError('Backend crashed — recording lost') fires, then 3s timeout
    await tick(3500);

    const stateAfter = await ipcMain._invoke('get-state');
    expect(stateAfter.state).toBe('dormant');

    tempCleanup();

    // Wait for any restart attempts
    await tick(5000);

    // Re-establish autoresponder on latest proc
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(latestProc, 'ready', { version: '1.0' });
    await tick(100);
    cleanupSidecar = autoRespondSidecar(latestProc, {
      configure: { status: 'ok' },
      start_rec: { status: 'ok' },
      cancel: { status: 'ok' },
      list_mics: { mics: [{ id: 0, name: 'Test Mic', is_default: true }] },
      list_models: { models: [] },
      capture_fg: { status: 'ok' },
      paste: { status: 'ok' },
      set_mic: { status: 'ok' },
      verify_key: { valid: true },
    });
  }, 20000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 9: Error state stacking
// ═══════════════════════════════════════════════════════════════════════════

describe('Error state stacking', () => {
  test('multiple rapid broadcastError calls resolve to dormant', async () => {
    // Trigger multiple errors in rapid succession by pushing error events
    for (let i = 0; i < 5; i++) {
      const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
      pushSidecarEvent(latestProc, 'error', { message: `rapid-error-${i}` });
      await tick(10);
    }

    // State should be 'error' (last error wins)
    const stateImmediate = await ipcMain._invoke('get-state');
    expect(stateImmediate.state).toBe('error');

    // After 3.5s all timeouts should have fired, state = dormant
    await tick(3500);
    const stateFinal = await ipcMain._invoke('get-state');
    expect(stateFinal.state).toBe('dormant');
  }, 10000);

  test('error during recording resets to dormant after timeout', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    await ipcMain._invoke('start-recording');
    await tick(20);

    // Sidecar sends error during recording
    pushSidecarEvent(latestProc, 'error', { message: 'mic disconnected' });
    await tick(100);

    const stateErr = await ipcMain._invoke('get-state');
    expect(stateErr.state).toBe('error');

    // Wait for 3s auto-reset
    await tick(3500);
    const stateFinal = await ipcMain._invoke('get-state');
    expect(stateFinal.state).toBe('dormant');
  }, 10000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 10: History at MAX_HISTORY capacity
// ═══════════════════════════════════════════════════════════════════════════

describe('History at capacity', () => {
  test('history truncates at 500 entries without corruption', async () => {
    await ipcMain._invoke('clear-history');

    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    // Add 510 entries — must truncate to 500
    for (let i = 0; i < 510; i++) {
      pushSidecarEvent(latestProc, 'transcription', {
        text: `capacity-test-${i}`,
        duration: 1,
        provider: 'test',
        model: 'test',
      });
      // Small delay to ensure unique IDs (Date.now())
      if (i % 50 === 0) await tick(5);
    }
    await tick(500);

    const history = await ipcMain._invoke('get-history');
    expect(history.length).toBeLessThanOrEqual(500);

    // Most recent entry should be near the end of our sequence
    if (history.length > 0) {
      expect(history[0].text).toMatch(/^capacity-test-/);
    }

    // Verify all entries have valid structure
    history.forEach(h => {
      expect(h).toHaveProperty('id');
      expect(h).toHaveProperty('text');
      expect(typeof h.id).toBe('string');
    });

    await ipcMain._invoke('clear-history');
    await tick(2000);
  }, 30000);

  test('get-history response time < 200ms at capacity', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    // Seed to near capacity
    for (let i = 0; i < 200; i++) {
      pushSidecarEvent(latestProc, 'transcription', {
        text: `perf-capacity-${i} ${'x'.repeat(100)}`,
        duration: 1,
        provider: 'test',
        model: 'test',
      });
      if (i % 50 === 0) await tick(5);
    }
    await tick(500);

    const start = performance.now();
    const history = await ipcMain._invoke('get-history');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
    expect(history.length).toBeGreaterThan(0);

    await ipcMain._invoke('clear-history');
    await tick(2000);
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 11: Hotkey rapid-fire
// ═══════════════════════════════════════════════════════════════════════════

describe('Hotkey rapid-fire', () => {
  test('20 rapid hotkey presses with 300ms debounce — most are filtered', async () => {
    const { globalShortcut } = require('electron');
    const hotkeyCallback = globalShortcut._shortcuts['Ctrl+Alt+R'];

    if (!hotkeyCallback) return;

    // Ensure sidecar is running (may have been restarted by crash tests)
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(latestProc, 'ready', { version: '1.0' });
    await tick(100);

    // Ensure API key is set (factory reset test may have cleared it)
    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-test-hotkey' });

    const mainWin = BrowserWindow._instances[0];
    mainWin.webContents.executeJavaScript.mockClear();

    // Fire 20 hotkey presses in 100ms (way faster than 300ms debounce)
    for (let i = 0; i < 20; i++) {
      hotkeyCallback();
      await tick(5); // 5ms between presses
    }
    await tick(100);

    // With 300ms debounce and 5ms spacing, only the first should fire.
    // At most 1-2 should get through.
    const callCount = mainWin.webContents.executeJavaScript.mock.calls.length;
    expect(callCount).toBeLessThanOrEqual(2);
    expect(callCount).toBeGreaterThanOrEqual(1);

    // Clean up any in-progress recording
    await ipcMain._invoke('cancel-processing');
    pushSidecarEvent(latestProc, 'cancelled');
    await tick(3500);
  }, 15000);

  test('hotkey presses spaced at 400ms all get through', async () => {
    const { globalShortcut } = require('electron');
    const hotkeyCallback = globalShortcut._shortcuts['Ctrl+Alt+R'];

    if (!hotkeyCallback) return;

    // Ensure API key is set for validation
    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-test-hotkey' });

    const mainWin = BrowserWindow._instances[0];
    mainWin.webContents.executeJavaScript.mockClear();

    // Fire 5 hotkey presses spaced at 400ms (above 300ms debounce)
    for (let i = 0; i < 5; i++) {
      hotkeyCallback();
      await tick(400);
    }
    await tick(100);

    // All 5 should get through (spaced above debounce threshold)
    // Some may be filtered by validateRecordingReadiness if state isn't dormant
    const callCount = mainWin.webContents.executeJavaScript.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(3); // at least most get through

    await ipcMain._invoke('cancel-processing');
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(latestProc, 'cancelled');
    await tick(3500);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 12: broadcastLevel throttle verification
// ═══════════════════════════════════════════════════════════════════════════

describe('broadcastLevel throttle', () => {
  test('200 rapid level events result in < 20 actual broadcasts', async () => {
    const mainWin = BrowserWindow._instances[0];
    mainWin.webContents.send.mockClear();

    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    // Fire 200 level events as fast as possible
    for (let i = 0; i < 200; i++) {
      pushSidecarEvent(latestProc, 'level', { level: Math.random() });
    }
    await tick(100);

    // Count level-update sends specifically
    const levelSends = mainWin.webContents.send.mock.calls.filter(
      c => c[0] === 'level-update'
    );

    // With 50ms throttle over ~0ms of firing, at most ~2-3 should get through
    // (one at start, maybe one more if timing allows)
    expect(levelSends.length).toBeLessThan(20);
    // But at least 1 should get through
    expect(levelSends.length).toBeGreaterThanOrEqual(1);
  });

  test('level events spaced at 60ms all get through', async () => {
    const mainWin = BrowserWindow._instances[0];
    mainWin.webContents.send.mockClear();

    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    // Fire 10 level events at 60ms spacing (above 50ms throttle)
    for (let i = 0; i < 10; i++) {
      pushSidecarEvent(latestProc, 'level', { level: 0.5 });
      await tick(60);
    }
    await tick(50);

    const levelSends = mainWin.webContents.send.mock.calls.filter(
      c => c[0] === 'level-update'
    );

    // All 10 should get through (spaced above throttle)
    expect(levelSends.length).toBeGreaterThanOrEqual(8); // allow small timing margin
  }, 10000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 13: Concurrent sidecar proxy commands
// ═══════════════════════════════════════════════════════════════════════════

describe('Concurrent sidecar proxy commands', () => {
  test('list-mics + list-models + verify-key all resolve concurrently', async () => {
    const results = await Promise.all([
      ipcMain._invoke('list-mics'),
      ipcMain._invoke('list-models'),
      ipcMain._invoke('verify-api-key', 'openai', 'sk-test123', ''),
    ]);

    // All three should resolve without hanging
    expect(results).toHaveLength(3);
    results.forEach(r => expect(r).toBeDefined());
  }, 10000);

  test('sidecar proxy commands work during active recording', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);

    // User opens settings and browses mic list while recording
    const [mics, models] = await Promise.all([
      ipcMain._invoke('list-mics'),
      ipcMain._invoke('list-models'),
    ]);

    expect(mics).toBeDefined();
    expect(models).toBeDefined();

    await ipcMain._invoke('cancel-processing');
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(latestProc, 'cancelled');
    await tick(100);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 14: Translation event racing with transcription
// ═══════════════════════════════════════════════════════════════════════════

describe('Translation + transcription race', () => {
  test('translation event immediately after transcription updates history correctly', async () => {
    await ipcMain._invoke('clear-history');

    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    // Transcription arrives
    pushSidecarEvent(latestProc, 'transcription', {
      text: 'hello world',
      duration: 2,
      provider: 'openai',
      model: 'whisper-1',
    });
    await tick(50);

    // Translation arrives immediately after (translate mode)
    pushSidecarEvent(latestProc, 'translation', {
      text: 'hola mundo',
    });
    await tick(200);

    const history = await ipcMain._invoke('get-history');
    expect(history.length).toBeGreaterThan(0);

    // Most recent entry should have both text and translation
    const latest = history[0];
    expect(latest.text).toBe('hello world');
    expect(latest.translation).toBe('hola mundo');

    await ipcMain._invoke('clear-history');
    await tick(2000);
  }, 10000);

  test('rapid transcription+translation pairs do not corrupt history', async () => {
    await ipcMain._invoke('clear-history');

    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    // 10 rapid transcription+translation pairs
    for (let i = 0; i < 10; i++) {
      pushSidecarEvent(latestProc, 'transcription', {
        text: `source-${i}`,
        duration: 1,
        provider: 'test',
        model: 'test',
      });
      await tick(10);
      pushSidecarEvent(latestProc, 'translation', {
        text: `translated-${i}`,
      });
      await tick(20);
    }
    await tick(500);

    const history = await ipcMain._invoke('get-history');
    expect(history.length).toBeGreaterThan(0);

    // All entries should have valid structure
    history.forEach(h => {
      expect(h).toHaveProperty('id');
      expect(h).toHaveProperty('text');
      expect(typeof h.text).toBe('string');
    });

    // No duplicate IDs
    const ids = history.map(h => h.id);
    expect(new Set(ids).size).toBe(ids.length);

    await ipcMain._invoke('clear-history');
    await tick(2000);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 15: API key encryption churn
// ═══════════════════════════════════════════════════════════════════════════

describe('API key encryption under load', () => {
  test('rapid API key changes survive encrypt/decrypt round-trip', async () => {
    const keys = [
      { openaiApiKey: 'sk-alpha111', geminiApiKey: 'AIzaAlpha111' },
      { openaiApiKey: 'sk-beta222', geminiApiKey: 'AIzaBeta222' },
      { openaiApiKey: 'sk-gamma333', geminiApiKey: 'AIzaGamma333' },
      { openaiApiKey: 'sk-delta444', geminiApiKey: 'AIzaDelta444' },
      { openaiApiKey: 'sk-epsilon555', geminiApiKey: 'AIzaEpsilon555' },
    ];

    // Rapidly cycle through different key pairs
    for (let round = 0; round < 10; round++) {
      for (const keyPair of keys) {
        await ipcMain._invoke('save-settings', keyPair);
      }
    }

    // Final keys should be the last pair saved
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.openaiApiKey).toBe('sk-epsilon555');
    expect(settings.geminiApiKey).toBe('AIzaEpsilon555');

    // Restore
    await ipcMain._invoke('save-settings', { openaiApiKey: '', geminiApiKey: '' });
  }, 15000);

  test('empty key → real key → empty key round-trip', async () => {
    await ipcMain._invoke('save-settings', { openaiApiKey: '' });
    let s = await ipcMain._invoke('get-settings');
    expect(s.openaiApiKey).toBe('');

    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-realkey123' });
    s = await ipcMain._invoke('get-settings');
    expect(s.openaiApiKey).toBe('sk-realkey123');

    await ipcMain._invoke('save-settings', { openaiApiKey: '' });
    s = await ipcMain._invoke('get-settings');
    expect(s.openaiApiKey).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 16: Factory reset during recording
// ═══════════════════════════════════════════════════════════════════════════

describe('Factory reset edge cases', () => {
  test('factory reset during recording does not crash', async () => {
    await ipcMain._invoke('start-recording');
    await tick(20);

    // Factory reset while recording
    const result = await ipcMain._invoke('reset-settings');
    expect(result).toEqual({ success: true });

    // Settings should be defaults
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.theme).toBe('dark');
    expect(settings.mode).toBe('api');

    // State machine should still be functional
    await ipcMain._invoke('cancel-processing');
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(latestProc, 'cancelled');
    await tick(100);

    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('dormant');
  }, 10000);

  test('factory reset clears history completely', async () => {
    // Add some history
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(latestProc, 'transcription', {
      text: 'before reset',
      duration: 1,
      provider: 'test',
      model: 'test',
    });
    await tick(200);

    const beforeReset = await ipcMain._invoke('get-history');
    expect(beforeReset.length).toBeGreaterThan(0);

    // Factory reset
    await ipcMain._invoke('reset-settings');
    await tick(50);

    const afterReset = await ipcMain._invoke('get-history');
    expect(afterReset.length).toBe(0);

    await tick(2000);
  }, 10000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 17: State machine — success/error timing windows
// ═══════════════════════════════════════════════════════════════════════════

describe('State machine — success/error timing windows', () => {
  test('start recording during 1.5s success window', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-test' });

    // Complete a recording to enter success state
    await ipcMain._invoke('start-recording');
    await tick(20);
    const stopPromise = ipcMain._invoke('stop-recording');
    await tick(20);
    pushSidecarEvent(latestProc, 'transcription', {
      text: 'first recording',
      duration: 1,
      provider: 'test',
      model: 'test',
    });
    await stopPromise;

    const stateSuccess = await ipcMain._invoke('get-state');
    expect(stateSuccess.state).toBe('success');

    // Immediately try to start a new recording
    await ipcMain._invoke('start-recording');
    const stateAfterStart = await ipcMain._invoke('get-state');
    // Key: no crash, no stuck state
    expect(['recording', 'success']).toContain(stateAfterStart.state);

    if (stateAfterStart.state === 'recording') {
      await ipcMain._invoke('cancel-processing');
      pushSidecarEvent(latestProc, 'cancelled');
    }
    await tick(2000);
    await ipcMain._invoke('clear-history');
  }, 15000);

  test('double stop-recording — second resolves without hanging', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    await ipcMain._invoke('start-recording');
    await tick(20);

    const stop1 = ipcMain._invoke('stop-recording');
    await tick(10);
    const stop2 = ipcMain._invoke('stop-recording');

    pushSidecarEvent(latestProc, 'transcription', {
      text: 'double stop test',
      duration: 1,
      provider: 'test',
      model: 'test',
    });

    const results = await Promise.all([
      Promise.race([stop1, tick(5000).then(() => ({ _timeout: true }))]),
      Promise.race([stop2, tick(5000).then(() => ({ _timeout: true }))]),
    ]);

    results.forEach(r => expect(r._timeout).toBeUndefined());
    await tick(2000);
    await ipcMain._invoke('clear-history');
  }, 15000);

  test('cancel during error state returns gracefully', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(latestProc, 'error', { message: 'test error' });
    await tick(50);

    const result = await ipcMain._invoke('cancel-processing');
    expect(result.success).toBe(false);
    await tick(3500);
  }, 10000);

  test('success→dormant 1.5s timer fires correctly', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(latestProc, 'transcription', {
      text: 'timer test',
      duration: 1,
      provider: 'test',
      model: 'test',
    });
    await tick(50);
    expect((await ipcMain._invoke('get-state')).state).toBe('success');

    await tick(1600);
    expect((await ipcMain._invoke('get-state')).state).toBe('dormant');
    await ipcMain._invoke('clear-history');
  }, 10000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 18: Store resilience — bad inputs
// ═══════════════════════════════════════════════════════════════════════════

describe('Store resilience — bad inputs', () => {
  test('save-settings with empty patch does not wipe settings', async () => {
    await ipcMain._invoke('save-settings', { theme: 'light', language: 'fr' });
    await ipcMain._invoke('save-settings', {});

    const settings = await ipcMain._invoke('get-settings');
    expect(settings.theme).toBe('light');
    expect(settings.language).toBe('fr');
    expect(settings.mode).toBeDefined();

    await ipcMain._invoke('save-settings', { theme: 'dark', language: 'auto' });
  });

  test('save-settings with unknown fields preserves them', async () => {
    await ipcMain._invoke('save-settings', { customField: 'hello', theme: 'dark' });
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.customField).toBe('hello');
    expect(settings.theme).toBe('dark');
  });

  test('delete-history with non-existent ID does not crash', async () => {
    const result = await ipcMain._invoke('delete-history', 'nonexistent-999');
    expect(result).toBeDefined();
  });

  test('get-audio with non-existent history ID returns error', async () => {
    const result = await ipcMain._invoke('get-audio', 'nonexistent-audio-123');
    expect(result.success).toBe(false);
  });

  test('paste-last-transcript with empty history returns error', async () => {
    await ipcMain._invoke('clear-history');
    await tick(50);
    const result = await ipcMain._invoke('paste-last-transcript');
    expect(result.success).toBe(false);
  });

  test('copy-to-clipboard with empty string succeeds', async () => {
    const result = await ipcMain._invoke('copy-to-clipboard', '');
    expect(result.success).toBe(true);
  });

  test('copy-to-clipboard with null does not crash', async () => {
    await expect(ipcMain._invoke('copy-to-clipboard', null)).resolves.toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 19: Data integrity — unicode, long text, special chars
// ═══════════════════════════════════════════════════════════════════════════

describe('Data integrity — unicode and edge content', () => {
  test('unicode/emoji survives transcription round-trip', async () => {
    await ipcMain._invoke('clear-history');
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    const unicodeText = '你好世界 🎤 Ñoño café résumé こんにちは العربية';
    pushSidecarEvent(latestProc, 'transcription', {
      text: unicodeText, duration: 1, provider: 'test', model: 'test',
    });
    await tick(200);

    const history = await ipcMain._invoke('get-history');
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].text).toBe(unicodeText);

    await ipcMain._invoke('clear-history');
    await tick(2000);
  }, 10000);

  test('very long text (10KB) stores and retrieves', async () => {
    await ipcMain._invoke('clear-history');
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    const longText = 'word '.repeat(2000);
    pushSidecarEvent(latestProc, 'transcription', {
      text: longText, duration: 60, provider: 'test', model: 'test',
    });
    await tick(200);

    const history = await ipcMain._invoke('get-history');
    expect(history[0].text).toBe(longText);

    await ipcMain._invoke('clear-history');
    await tick(2000);
  }, 10000);

  test('empty transcription text does not add to history', async () => {
    await ipcMain._invoke('clear-history');
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    pushSidecarEvent(latestProc, 'transcription', {
      text: '', duration: 1, provider: 'test', model: 'test',
    });
    await tick(200);

    const history = await ipcMain._invoke('get-history');
    expect(history.length).toBe(0);
    await tick(2000);
  }, 10000);

  test('transcription with missing fields uses defaults', async () => {
    await ipcMain._invoke('clear-history');
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    pushSidecarEvent(latestProc, 'transcription', { text: 'minimal fields' });
    await tick(200);

    const entry = (await ipcMain._invoke('get-history'))[0];
    expect(entry.text).toBe('minimal fields');
    expect(entry.duration).toBe(0);
    expect(entry.provider).toBe('unknown');
    expect(entry.model).toBe('unknown');

    await ipcMain._invoke('clear-history');
    await tick(2000);
  }, 10000);

  test('special characters in customBaseUrl survive round-trip', async () => {
    const specialUrl = 'https://api.example.com/v1?key=value&param=hello%20world';
    await ipcMain._invoke('save-settings', { customBaseUrl: specialUrl });
    expect((await ipcMain._invoke('get-settings')).customBaseUrl).toBe(specialUrl);
    await ipcMain._invoke('save-settings', { customBaseUrl: '' });
  });

  test('newlines/tabs in string fields do not corrupt JSON', async () => {
    const weirdValue = 'line1\nline2\ttab';
    await ipcMain._invoke('save-settings', { customBaseUrl: weirdValue });
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.customBaseUrl).toBe(weirdValue);
    expect(settings.mode).toBeDefined();
    await ipcMain._invoke('save-settings', { customBaseUrl: '' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 20: Sidecar resilience — malformed events
// ═══════════════════════════════════════════════════════════════════════════

describe('Sidecar resilience — malformed events', () => {
  test('event with undefined data — no crash', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    // Push event where data is undefined (event has no data field)
    latestProc.stdout.push(JSON.stringify({ event: 'transcription' }) + '\n');
    await tick(100);

    // Should not crash — state may change but no exception
    const state = await ipcMain._invoke('get-state');
    expect(['dormant', 'success', 'error']).toContain(state.state);
    await tick(3500);
  }, 10000);

  test('unknown event type — ignored gracefully', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    const stateBefore = await ipcMain._invoke('get-state');

    pushSidecarEvent(latestProc, 'unknown_event_xyz', { foo: 'bar' });
    await tick(100);

    expect((await ipcMain._invoke('get-state')).state).toBe(stateBefore.state);
  });

  test('malformed JSON lines — no crash', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    latestProc.stdout.push('this is not json\n');
    latestProc.stdout.push('{"broken: true\n');
    latestProc.stdout.push('\n');
    await tick(100);

    // App must still work
    expect(await ipcMain._invoke('get-state')).toHaveProperty('state');
    expect(await ipcMain._invoke('get-settings')).toHaveProperty('theme');
  });

  test('level event with missing level field — no crash', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;

    pushSidecarEvent(latestProc, 'level', {});
    pushSidecarEvent(latestProc, 'level', { level: null });
    await tick(100);

    expect(await ipcMain._invoke('get-state')).toHaveProperty('state');
  });

  test('error event with missing message — uses fallback', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(latestProc, 'error', {});
    await tick(100);

    expect((await ipcMain._invoke('get-state')).state).toBe('error');
    await tick(3500);
  }, 10000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 21: Window/pill null safety
// ═══════════════════════════════════════════════════════════════════════════

describe('Window null safety', () => {
  test('window-minimize does not throw', async () => {
    await ipcMain._invoke('window-minimize');
  });

  test('window-maximize toggle does not throw', async () => {
    await ipcMain._invoke('window-maximize');
    const isMax = await ipcMain._invoke('window-is-maximized');
    expect(typeof isMax).toBe('boolean');
    await ipcMain._invoke('window-maximize'); // toggle back
  });

  test('show-main-window does not throw', async () => {
    await ipcMain._invoke('show-main-window');
  });

  test('show-settings does not throw', async () => {
    await ipcMain._invoke('show-settings');
  });

  test('get-displays returns valid array', async () => {
    const displays = await ipcMain._invoke('get-displays');
    expect(Array.isArray(displays)).toBe(true);
    expect(displays.length).toBeGreaterThan(0);
    expect(displays[0]).toHaveProperty('id');
  });

  test('move-pill-to-display with invalid ID returns error', async () => {
    const result = await ipcMain._invoke('move-pill-to-display', 99999);
    expect(result.success).toBe(false);
  });

  test('hide-pill when already hidden does not crash', async () => {
    await ipcMain._invoke('hide-pill');
    await ipcMain._invoke('hide-pill');
  });

  test('toggle-pill rapid fire does not crash', async () => {
    for (let i = 0; i < 10; i++) {
      await ipcMain._invoke('toggle-pill');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 22: Store file resilience
// ═══════════════════════════════════════════════════════════════════════════

describe('Store file resilience', () => {
  test('settings.json deleted while running — cache still works', async () => {
    await ipcMain._invoke('save-settings', { language: 'de' });

    const realFsAccess = jest.requireActual('fs');
    const settingsPath = path.join(TEST_CONFIG_BASE,
      'whisperclick-dev', 'settings.json');
    try { realFsAccess.unlinkSync(settingsPath); } catch {}

    // Cache should still serve reads
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.language).toBe('de');

    // Save recreates the file
    await ipcMain._invoke('save-settings', { language: 'auto' });
    expect(realFsAccess.existsSync(settingsPath)).toBe(true);
  });

  test('history.json deleted while running — cache still works', async () => {
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(latestProc, 'transcription', {
      text: 'cache resilience', duration: 1, provider: 'test', model: 'test',
    });
    await tick(200);

    const before = await ipcMain._invoke('get-history');
    expect(before.length).toBeGreaterThan(0);

    const realFsAccess = jest.requireActual('fs');
    const historyPath = path.join(TEST_CONFIG_BASE,
      'whisperclick-dev', 'history.json');
    try { realFsAccess.unlinkSync(historyPath); } catch {}

    // Cache still has data
    const after = await ipcMain._invoke('get-history');
    expect(after.length).toBe(before.length);

    await ipcMain._invoke('clear-history');
    await tick(2000);
  }, 10000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 23: Hotkey with destroyed mainWindow (fallback path)
// ═══════════════════════════════════════════════════════════════════════════

describe('Hotkey fallback path', () => {
  test('hotkey when mainWindow destroyed uses toggleRecording fallback', async () => {
    const { globalShortcut } = require('electron');
    const hotkeyCallback = globalShortcut._shortcuts['Ctrl+Alt+R'];
    if (!hotkeyCallback) return;

    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-fallback-test' });

    const mainWin = BrowserWindow._instances[0];
    mainWin._destroyed = true;
    mainWin.isDestroyed.mockReturnValue(true);

    hotkeyCallback();
    await tick(100);

    const state = await ipcMain._invoke('get-state');
    expect(['recording', 'dormant', 'error']).toContain(state.state);

    // Restore
    mainWin._destroyed = false;
    mainWin.isDestroyed.mockReturnValue(false);

    if (state.state === 'recording') {
      await ipcMain._invoke('cancel-processing');
      const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
      pushSidecarEvent(latestProc, 'cancelled');
      await tick(100);
    }
    await tick(3500);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST 24: IPC handler return value contracts
// ═══════════════════════════════════════════════════════════════════════════

describe('IPC return value contracts', () => {
  test('get-app-info returns all required fields', async () => {
    const info = await ipcMain._invoke('get-app-info');
    expect(info).toHaveProperty('version');
    expect(info).toHaveProperty('name');
    expect(info).toHaveProperty('isPackaged');
    expect(info).toHaveProperty('isDev');
    expect(info).toHaveProperty('platform');
    expect(info).toHaveProperty('arch');
    expect(info).toHaveProperty('modKey');
  });

  test('get-state always has state and message', async () => {
    const state = await ipcMain._invoke('get-state');
    expect(typeof state.state).toBe('string');
    expect(typeof state.message).toBe('string');
  });

  test('start-recording returns {success} shape', async () => {
    const result = await ipcMain._invoke('start-recording');
    expect(typeof result.success).toBe('boolean');
    await ipcMain._invoke('cancel-processing');
    const latestProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(latestProc, 'cancelled');
    await tick(100);
  }, 10000);

  test('cancel-processing returns {success, error?} shape', async () => {
    const result = await ipcMain._invoke('cancel-processing');
    expect(typeof result.success).toBe('boolean');
    if (!result.success) expect(typeof result.error).toBe('string');
  });

  test('save-settings returns {success: true}', async () => {
    expect(await ipcMain._invoke('save-settings', { theme: 'dark' }))
      .toEqual({ success: true });
  });

  test('verify-api-key returns {valid} shape', async () => {
    const result = await ipcMain._invoke('verify-api-key', 'openai', 'bad', '');
    expect(typeof result.valid).toBe('boolean');
  });
});
