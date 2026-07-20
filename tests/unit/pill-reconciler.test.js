/**
 * R4 — pill self-heal. Verifies that a vanished pill is recreated both by the
 * ~4s reconciler interval and by the render-process-gone handler, with
 * `showPill` as the source of truth. Isolated module sandbox.
 */
const os = require('os');
const path = require('path');
const realFs = jest.requireActual('fs');

const TEST_CONFIG_BASE = realFs.mkdtempSync(path.join(os.tmpdir(), 'wc-pill-'));

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

// Spy on setInterval BEFORE requiring main so we capture the reconciler callback.
const setIntervalSpy = jest.spyOn(global, 'setInterval');

const { app, ipcMain, BrowserWindow } = require('electron');
app.getPath = (name) => (name === 'userData' ? TEST_CONFIG_BASE : os.tmpdir());

require('../../platforms/electron/main');
app._triggerReady();

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** Live pill windows (identified by the pill preload). */
function livePills() {
  return BrowserWindow._instances.filter(
    (w) =>
      w.opts &&
      w.opts.webPreferences &&
      String(w.opts.webPreferences.preload).includes('preload-pill') &&
      !w._destroyed
  );
}

afterAll(() => {
  try { realFs.rmSync(TEST_CONFIG_BASE, { recursive: true, force: true }); } catch {}
});

describe('R4 pill self-heal', () => {
  beforeAll(async () => {
    await tick(50);
    // showPill is the source of truth — turn it on so the pill should exist.
    await ipcMain._invoke('save-settings', { showPill: true });
    await tick(20);
  });

  test('a ~4s reconciler interval is scheduled at startup', () => {
    const reconciler = setIntervalSpy.mock.calls.find((c) => c[1] === 4000);
    expect(reconciler).toBeDefined();
    expect(typeof reconciler[0]).toBe('function');
  });

  test('reconciler recreates the pill after it vanishes', async () => {
    expect(livePills().length).toBeGreaterThan(0); // pill exists while showPill=true
    const reconcilerFn = setIntervalSpy.mock.calls.find((c) => c[1] === 4000)[0];

    // Simulate the pill vanishing (renderer crash / display loss).
    livePills().forEach((w) => { w._destroyed = true; });
    expect(livePills().length).toBe(0);

    reconcilerFn(); // the ~4s tick fires
    await tick(20);

    expect(livePills().length).toBeGreaterThan(0); // healed
  });

  test('render-process-gone on the pill triggers immediate recreation', async () => {
    const pill = livePills()[livePills().length - 1];
    const goneCall = pill.webContents.on.mock.calls.find((c) => c[0] === 'render-process-gone');
    expect(goneCall).toBeDefined();

    pill._destroyed = true;
    goneCall[1]({}, { reason: 'crashed' }); // fire the crash handler
    await tick(20);

    expect(livePills().length).toBeGreaterThan(0); // healed immediately
  });

  test('does NOT recreate the pill when showPill is false', async () => {
    await ipcMain._invoke('save-settings', { showPill: false });
    await tick(20);
    livePills().forEach((w) => { w._destroyed = true; });

    const reconcilerFn = setIntervalSpy.mock.calls.find((c) => c[1] === 4000)[0];
    reconcilerFn();
    await tick(20);

    expect(livePills().length).toBe(0); // stays gone — source of truth respected
  });
});
