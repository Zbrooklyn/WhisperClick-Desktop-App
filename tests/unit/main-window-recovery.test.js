/**
 * Main-window crash recovery (area #5). The pill self-heals on renderer crash
 * (R4); the main window must too — otherwise a renderer crash (GPU reset, OOM,
 * "Aw, Snap") leaves a blank window dead until manual restart. Isolated sandbox.
 */
const os = require('os');
const path = require('path');
const realFs = jest.requireActual('fs');

const TEST_CONFIG_BASE = realFs.mkdtempSync(path.join(os.tmpdir(), 'wc-winrec-'));

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

const { app, BrowserWindow } = require('electron');
app.getPath = (name) => (name === 'userData' ? TEST_CONFIG_BASE : os.tmpdir());

require('../../platforms/electron/main');
app._triggerReady();

afterAll(() => {
  try { realFs.rmSync(TEST_CONFIG_BASE, { recursive: true, force: true }); } catch {}
});

// The main window = the BrowserWindow built with the main preload (not the pill).
function mainWin() {
  return BrowserWindow._instances.find(
    (w) =>
      w.opts &&
      w.opts.webPreferences &&
      String(w.opts.webPreferences.preload).includes('preload.js') &&
      !String(w.opts.webPreferences.preload).includes('pill')
  );
}
function goneHandler(win) {
  const call = win.webContents.on.mock.calls.find((c) => c[0] === 'render-process-gone');
  return call && call[1];
}

describe('main window crash recovery', () => {
  test('registers a render-process-gone handler', () => {
    const win = mainWin();
    expect(win).toBeDefined();
    expect(goneHandler(win)).toBeInstanceOf(Function);
  });

  test('does NOT reload on a clean exit', () => {
    const win = mainWin();
    win.reload.mockClear();
    goneHandler(win)({}, { reason: 'clean-exit' });
    expect(win.reload).not.toHaveBeenCalled();
  });

  test('reloads on a renderer crash, but not again within the 10s loop guard', () => {
    const win = mainWin();
    win.reload.mockClear();
    goneHandler(win)({}, { reason: 'crashed' });
    expect(win.reload).toHaveBeenCalledTimes(1); // recovered

    goneHandler(win)({}, { reason: 'crashed' }); // immediate second crash
    expect(win.reload).toHaveBeenCalledTimes(1); // guarded — no tight crash-loop
  });

  test('does NOT reload once the app is quitting', () => {
    // will-quit sets isQuitting=true; a late renderer crash must not reload.
    const willQuit = app.on.mock.calls.find((c) => c[0] === 'will-quit')[1];
    willQuit();
    const win = mainWin();
    win.reload.mockClear();
    goneHandler(win)({}, { reason: 'crashed' });
    expect(win.reload).not.toHaveBeenCalled();
  });
});
