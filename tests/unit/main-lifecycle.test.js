/**
 * Lifecycle wiring tests for main.js (R5 force-reap on quit, R10 startup
 * orphan sweep). Kept in its own file so it gets a fresh Jest module sandbox
 * and does not interfere with the stateful choreography in main-ipc.test.js.
 */
const os = require('os');
const path = require('path');
const realFs = jest.requireActual('fs');

const TEST_CONFIG_BASE = realFs.mkdtempSync(path.join(os.tmpdir(), 'wc-life-'));

// --- Mock child_process: capture spawn (sidecar) + execFile (orphan sweep) ---
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
      proc.pid = 12345;
      return proc;
    }),
    exec: jest.fn(),
    // Default: report "no engines running" so the sweep is a no-op no-shell.
    execFile: jest.fn((cmd, args, cb) => cb(null, '')),
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

const { app, BrowserWindow } = require('electron');
const { spawn, execFile } = require('child_process');

app.getPath = (name) => (name === 'userData' ? TEST_CONFIG_BASE : os.tmpdir());

require('../../platforms/electron/main');
app._triggerReady();

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

afterAll(() => {
  try { realFs.rmSync(TEST_CONFIG_BASE, { recursive: true, force: true }); } catch {}
});

describe('R10: startup orphan sweep', () => {
  test('runs tasklist to sweep stale engines during startup', async () => {
    await tick(50); // let the sweep promise resolve and start() fire
    const ranTasklist = execFile.mock.calls.some((c) => c[0] === 'tasklist');
    expect(ranTasklist).toBe(true);
  });

  test('sidecar is started after the sweep completes', async () => {
    await tick(50);
    expect(spawn).toHaveBeenCalled(); // engine spawned post-sweep
  });
});

describe('R5: will-quit force-reaps the engine child', () => {
  test('will-quit handler kills the sidecar process synchronously', async () => {
    await tick(50);
    const proc = spawn.mock.results[0].value;
    proc.kill.mockClear();

    const willQuitCall = app.on.mock.calls.find((c) => c[0] === 'will-quit');
    expect(willQuitCall).toBeDefined();
    const willQuit = willQuitCall[1];

    willQuit(); // synchronous force reap — no timers advanced

    expect(proc.kill).toHaveBeenCalled();
  });
});
