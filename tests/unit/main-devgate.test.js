/**
 * R10 safety regression guard. The startup orphan sweep must NOT run in dev:
 * the dev engine is `python`, so every engine.exe on the machine belongs to a
 * different (packaged) install, and sweeping there would kill a bystander's
 * live engine. (Observed in live testing 2026-06-03 — a dev run killed the
 * installed app's engine.exe.) Isolated module sandbox.
 */
const os = require('os');
const path = require('path');
const realFs = jest.requireActual('fs');

const TEST_CONFIG_BASE = realFs.mkdtempSync(path.join(os.tmpdir(), 'wc-devgate-'));

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

const { app } = require('electron');
const { execFile } = require('child_process');

app.getPath = (name) => (name === 'userData' ? TEST_CONFIG_BASE : os.tmpdir());
app.isPackaged = false; // dev mode

require('../../platforms/electron/main');
app._triggerReady();

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

afterAll(() => {
  try { realFs.rmSync(TEST_CONFIG_BASE, { recursive: true, force: true }); } catch {}
});

describe('R10 dev safety gate', () => {
  test('orphan sweep is NOT invoked at startup in dev (no engine query, no taskkill)', async () => {
    await tick(60);
    const ranSweep = execFile.mock.calls.some((c) => c[0] === 'powershell' || c[0] === 'tasklist' || c[0] === 'taskkill');
    expect(ranSweep).toBe(false);
  });
});
