/**
 * F2 — premium availability vs. entitlement, in a PACKAGED build.
 *
 * premiumOn() used to mean "the premium module is on disk", so a paid installer
 * with no licence key still executed every premium IPC handler. The renderer
 * grayed those features out, but nothing behind the IPC boundary enforced
 * anything. These tests hold the two questions apart:
 *
 *   available  = modules packed + user hasn't disabled premium  (licence-blind,
 *                so the licence form can still render and accept a key)
 *   on         = available AND a valid signed licence
 *
 * Own file: app.isPackaged must be true before main.js is required, and the
 * stateful choreography in main-ipc.test.js assumes the dev default (false).
 */
const os = require('os');
const path = require('path');
const realFs = jest.requireActual('fs');

const TEST_CONFIG_BASE = realFs.mkdtempSync(path.join(os.tmpdir(), 'wc-ent-'));

// Licence status is driven from here so a test can flip entitlement. Mirrors the
// real getLicenseStatus contract in premium/pro-license.js.
// `mock`-prefixed so Jest allows the factory below to close over them.
const mockFREE = { tier: 'free', valid: false, expiresAt: null, offlineGrace: false, email: null, reason: 'no-license' };
const mockPRO = { tier: 'pro', valid: true, expiresAt: null, offlineGrace: false, email: 'e@x.com', reason: 'ok' };
const mockLicense = { status: mockFREE };

jest.mock('../../platforms/electron/premium/pro-license', () => ({
  getLicenseStatus: () => mockLicense.status,
  activate: async () => { mockLicense.status = mockPRO; return { ok: true, tier: 'pro' }; },
  deactivate: async () => { mockLicense.status = mockFREE; return { ok: true }; },
}));

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
      proc.pid = 4242;
      return proc;
    }),
    exec: jest.fn(),
    execFile: jest.fn((cmd, args, cb) => cb(null, '')),
  };
});

const { app, ipcMain } = require('electron');
app.getPath = (name) => (name === 'userData' ? TEST_CONFIG_BASE : os.tmpdir());
// The whole point: a shipped build, not a dev tree. Must be set before require.
app.isPackaged = true;
process.resourcesPath = path.join(TEST_CONFIG_BASE, 'resources');

require('../../platforms/electron/main');
app._triggerReady();

afterAll(() => {
  try { realFs.rmSync(TEST_CONFIG_BASE, { recursive: true, force: true }); } catch {}
});

const OFF = 'Premium features are off.';

describe('packaged build, no licence', () => {
  test('a premium feature is refused', async () => {
    const res = await ipcMain._invoke('diarize', { id: 'nope' });
    expect(res).toEqual({ success: false, error: OFF });
  });

  test('licence activation is still reachable — you can enter a key', async () => {
    // Gating activation on entitlement would mean needing a licence to enter
    // your licence. This must not regress to 'licensing-unavailable'.
    const res = await ipcMain._invoke('pro-activate', 'SOME-KEY');
    expect(res.error).not.toBe('licensing-unavailable');
    expect(res.ok).toBe(true);
  });
});

describe('packaged build, valid licence', () => {
  test('the same premium feature now runs', async () => {
    // Activation above flipped the mocked status AND must have invalidated the
    // entitlement cache; if it did not, this still returns OFF.
    const res = await ipcMain._invoke('diarize', { id: 'nope' });
    expect(res.error).not.toBe(OFF);
    expect(res).toEqual({ success: false, error: 'No stored audio for this transcript.' });
  });

  test('deactivating closes it again', async () => {
    const off = await ipcMain._invoke('pro-deactivate');
    expect(off.ok).toBe(true);
    const res = await ipcMain._invoke('diarize', { id: 'nope' });
    expect(res).toEqual({ success: false, error: OFF });
  });
});
