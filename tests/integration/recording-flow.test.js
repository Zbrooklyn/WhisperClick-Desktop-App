/**
 * Integration tests for recording flow state machine and sidecar restart.
 *
 * Strategy: Rather than requiring main.js (which has heavy side effects and
 * module-level execution), we replicate the state machine logic and test it
 * against the real Sidecar class with mocked child_process.
 */

const { PassThrough } = require('stream');
const EventEmitter = require('events');
const { clipboard } = require('electron');
const { createTempDir, cleanupTempDir } = require('../helpers/test-utils');
const Store = require('../../electron/store');
const Sidecar = require('../../electron/sidecar');

// Mock child_process.spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  exec: jest.fn(),
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn((p) => {
    // Return false for venvPython check in sidecar, true for real FS ops
    if (p && p.includes('venv')) return false;
    return jest.requireActual('fs').existsSync(p);
  }),
}));

const { spawn } = require('child_process');

function createFakeProc() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = jest.fn();
  proc.pid = 99999;
  return proc;
}

/**
 * Mini state machine that mirrors main.js logic.
 * This is the integration surface we're testing.
 */
class RecordingFlowHarness {
  constructor(store, sidecar) {
    this.store = store;
    this.sidecar = sidecar;
    this.appState = 'dormant';
    this.isQuitting = false;
    this.stateHistory = [];
    this.sidecarRestartCount = 0;
    this.maxRestarts = 3;
    this.broadcastedStates = [];

    this._setupListeners();
  }

  _setState(state) {
    this.appState = state;
    this.stateHistory.push(state);
    this.broadcastedStates.push(state);
  }

  _setupListeners() {
    this.sidecar.on('ready', () => {
      this.sidecarRestartCount = 0;
    });

    this.sidecar.on('transcription', (data) => {
      this._setState('success');
      if (data.text) {
        this.store.addHistory({
          text: data.text,
          timestamp: new Date().toISOString(),
          duration: data.duration || 0,
          provider: data.provider || 'unknown',
          translation: data.translation || '',
        });

        const settings = this.store.getSettings();
        if (settings.autoPaste && data.text) {
          clipboard.writeText(data.text);
        }
      }
      // Transition back to dormant after delay
      setTimeout(() => this._setState('dormant'), 1500);
    });

    this.sidecar.on('translation', (data) => {
      if (data.text) {
        const history = this.store.getHistory();
        if (history.length > 0) {
          this.store.updateHistory(history[0].id, { translation: data.text });
        }
      }
    });

    this.sidecar.on('cancelled', () => {
      this._setState('dormant');
    });

    this.sidecar.on('error', (data) => {
      this._setState('error');
      setTimeout(() => this._setState('dormant'), 3000);
    });

    this.sidecar.on('exit', (code) => {
      if (this.isQuitting) return;
      if (code !== 0 && code !== null && this.sidecarRestartCount < this.maxRestarts) {
        this.sidecarRestartCount++;
        const delay = 1000 * this.sidecarRestartCount;
        setTimeout(() => {
          if (this.isQuitting) return;
          try { this.sidecar.start(); } catch {}
        }, delay);
      }
    });
  }

  async startRecording() {
    if (this.appState !== 'dormant') return;
    this._setState('recording');
    if (this.sidecar.isRunning) {
      await this.sidecar.send('start_rec');
    }
  }

  async stopRecording() {
    if (this.appState !== 'recording') return;
    this._setState('processing');
    if (this.sidecar.isRunning) {
      await this.sidecar.send('stop_rec');
    }
  }

  async cancelRecording() {
    if (this.sidecar.isRunning) {
      await this.sidecar.send('cancel');
    }
  }
}

// ─── Test Setup ───────────────────────────────────────────────────────────

let tmpDir, store, sidecar, fakeProc, harness;

beforeEach(() => {
  jest.useFakeTimers();
  spawn.mockClear();

  tmpDir = createTempDir();
  store = new Store(tmpDir);

  fakeProc = createFakeProc();
  spawn.mockReturnValue(fakeProc);

  sidecar = new Sidecar('/mock/engine.py');
  sidecar.start();

  harness = new RecordingFlowHarness(store, sidecar);
});

afterEach(() => {
  jest.useRealTimers();
  cleanupTempDir(tmpDir);
  if (fakeProc) {
    fakeProc.stdin.destroy();
    fakeProc.stdout.destroy();
    fakeProc.stderr.destroy();
  }
});

// ── State transitions ───────────────────────────────────────────────────

describe('state transitions', () => {
  test('dormant → recording → processing → success → dormant', async () => {
    // Start recording
    const startPromise = harness.startRecording();
    fakeProc.stdout.push(JSON.stringify({ id: 1, result: 'ok' }) + '\n');
    await startPromise;
    expect(harness.appState).toBe('recording');

    // Stop recording (transitions to processing)
    const stopPromise = harness.stopRecording();
    fakeProc.stdout.push(JSON.stringify({ id: 2, result: 'ok' }) + '\n');
    await stopPromise;
    expect(harness.appState).toBe('processing');

    // Sidecar sends transcription → success
    fakeProc.stdout.push(JSON.stringify({
      event: 'transcription',
      data: { text: 'hello world', duration: 1.0 },
    }) + '\n');

    // Wait for event to propagate
    await Promise.resolve();
    expect(harness.appState).toBe('success');

    // After 1500ms → dormant
    jest.advanceTimersByTime(1500);
    expect(harness.appState).toBe('dormant');
  });

  test('error → dormant after 3 seconds', () => {
    fakeProc.stdout.push(JSON.stringify({
      event: 'error',
      data: { message: 'Something failed' },
    }) + '\n');

    expect(harness.appState).toBe('error');
    jest.advanceTimersByTime(3000);
    expect(harness.appState).toBe('dormant');
  });

  test('cancel → dormant immediately', () => {
    harness._setState('recording');
    fakeProc.stdout.push(JSON.stringify({ event: 'cancelled' }) + '\n');
    expect(harness.appState).toBe('dormant');
  });

  test('recording start is no-op when not dormant', async () => {
    harness._setState('processing');
    await harness.startRecording();
    expect(harness.appState).toBe('processing');
  });

  test('stop recording is no-op when not recording', async () => {
    expect(harness.appState).toBe('dormant');
    await harness.stopRecording();
    expect(harness.appState).toBe('dormant');
  });
});

// ── Sidecar events ──────────────────────────────────────────────────────

describe('sidecar events', () => {
  test('transcription adds entry to history', () => {
    fakeProc.stdout.push(JSON.stringify({
      event: 'transcription',
      data: { text: 'test transcription', duration: 2.0, provider: 'openai' },
    }) + '\n');

    const history = store.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].text).toBe('test transcription');
    expect(history[0].provider).toBe('openai');
  });

  test('autoPaste copies transcription to clipboard', () => {
    // Default settings have autoPaste: true
    clipboard._reset();

    fakeProc.stdout.push(JSON.stringify({
      event: 'transcription',
      data: { text: 'paste this' },
    }) + '\n');

    expect(clipboard.readText()).toBe('paste this');
  });

  test('translation updates most recent history entry', () => {
    // First add a transcription
    fakeProc.stdout.push(JSON.stringify({
      event: 'transcription',
      data: { text: 'hello' },
    }) + '\n');

    // Then update with translation
    fakeProc.stdout.push(JSON.stringify({
      event: 'translation',
      data: { text: 'hola' },
    }) + '\n');

    const history = store.getHistory();
    expect(history[0].translation).toBe('hola');
  });

  test('error event sets error state', () => {
    fakeProc.stdout.push(JSON.stringify({
      event: 'error',
      data: { message: 'API error' },
    }) + '\n');

    expect(harness.appState).toBe('error');
  });
});

// ── Auto-restart with backoff ───────────────────────────────────────────

describe('auto-restart', () => {
  test('non-zero exit triggers restart with increasing backoff', () => {
    const fakeProc2 = createFakeProc();
    spawn.mockReturnValue(fakeProc2);

    // First crash
    fakeProc.emit('exit', 1);
    expect(harness.sidecarRestartCount).toBe(1);

    // After 1s delay, restart should happen
    jest.advanceTimersByTime(1000);
    expect(spawn).toHaveBeenCalledTimes(2); // original + 1 restart

    // Second crash
    const fakeProc3 = createFakeProc();
    spawn.mockReturnValue(fakeProc3);
    fakeProc2.emit('exit', 1);
    expect(harness.sidecarRestartCount).toBe(2);

    // After 2s delay
    jest.advanceTimersByTime(2000);
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  test('stops restarting after 3 attempts', () => {
    // Crash 3 times
    for (let i = 0; i < 3; i++) {
      const nextProc = createFakeProc();
      spawn.mockReturnValue(nextProc);
      fakeProc.emit('exit', 1);
      jest.advanceTimersByTime(5000); // enough for any backoff
      fakeProc = nextProc;
    }

    // 4th crash — should NOT restart
    const spawnCountBefore = spawn.mock.calls.length;
    fakeProc.emit('exit', 1);
    jest.advanceTimersByTime(10000);
    expect(spawn.mock.calls.length).toBe(spawnCountBefore);
  });

  test('no restart when isQuitting is true', () => {
    harness.isQuitting = true;
    const spawnCountBefore = spawn.mock.calls.length;

    fakeProc.emit('exit', 1);
    jest.advanceTimersByTime(5000);

    expect(spawn.mock.calls.length).toBe(spawnCountBefore);
  });
});
