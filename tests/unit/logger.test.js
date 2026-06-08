const fs = require('fs');
const path = require('path');
const os = require('os');

let log;
let tmpDir;

beforeEach(() => {
  // Fresh module for each test — resets internal state
  jest.resetModules();
  log = require('../../platforms/electron/logger');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-log-'));
});

afterEach(() => {
  // Clean up temp files
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
});

function readLog() {
  return fs.readFileSync(path.join(tmpDir, 'debug.log'), 'utf8');
}

describe('logger', () => {
  test('does not write when disabled', () => {
    log.init(tmpDir, false);
    log.info('should not appear');
    expect(fs.existsSync(path.join(tmpDir, 'debug.log'))).toBe(false);
  });

  test('writes when enabled', () => {
    log.init(tmpDir, true);
    log.info('hello world');
    const content = readLog();
    expect(content).toContain('[INFO] hello world');
    expect(content).toContain('[LOG] Debug logging started');
  });

  test('setEnabled toggles logging on', () => {
    log.init(tmpDir, false);
    log.info('before');
    expect(fs.existsSync(path.join(tmpDir, 'debug.log'))).toBe(false);
    log.setEnabled(true);
    log.info('after');
    const content = readLog();
    expect(content).toContain('[INFO] after');
    expect(content).not.toContain('[INFO] before');
  });

  test('setEnabled toggles logging off', () => {
    log.init(tmpDir, true);
    log.info('first');
    log.setEnabled(false);
    log.info('second');
    const content = readLog();
    expect(content).toContain('[INFO] first');
    expect(content).not.toContain('[INFO] second');
  });

  test('warn writes WARN level', () => {
    log.init(tmpDir, true);
    log.warn('caution');
    expect(readLog()).toContain('[WARN] caution');
  });

  test('error writes ERR level', () => {
    log.init(tmpDir, true);
    log.error('failure');
    expect(readLog()).toContain('[ERR ] failure');
  });

  test('state writes STATE level with transition', () => {
    log.init(tmpDir, true);
    log.state('dormant', 'recording', 'hotkey');
    const content = readLog();
    expect(content).toContain('[STATE] dormant → recording (hotkey)');
  });

  test('state without message omits parenthetical', () => {
    log.init(tmpDir, true);
    log.state('recording', 'processing');
    const content = readLog();
    expect(content).toMatch(/\[STATE\] recording → processing\n/);
  });

  test('ipc writes IPC level', () => {
    log.init(tmpDir, true);
    log.ipc('start-recording', 'state=dormant');
    expect(readLog()).toContain('[IPC] start-recording: state=dormant');
  });

  test('tray writes TRAY level', () => {
    log.init(tmpDir, true);
    log.tray('toggle-recording', 'state=dormant');
    expect(readLog()).toContain('[TRAY] toggle-recording: state=dormant');
  });

  test('sidecar writes SIDECAR level', () => {
    log.init(tmpDir, true);
    log.sidecar('ready', 'pushing config');
    expect(readLog()).toContain('[SIDECAR] ready: pushing config');
  });

  test('rotates log file at MAX_LOG_SIZE', () => {
    log.init(tmpDir, true);
    // Write enough data to exceed 5MB
    const logPath = path.join(tmpDir, 'debug.log');
    // Close the logger's fd first, then bloat the file, then re-init
    log.setEnabled(false);
    fs.writeFileSync(logPath, 'x'.repeat(6 * 1024 * 1024));
    // Re-init triggers rotation check
    jest.resetModules();
    log = require('../../platforms/electron/logger');
    log.init(tmpDir, true);
    // Old file should be rotated
    expect(fs.existsSync(logPath + '.1')).toBe(true);
    // New log should be fresh (much smaller)
    const newSize = fs.statSync(logPath).size;
    expect(newSize).toBeLessThan(1024);
  });

  test('lines include ISO timestamps', () => {
    log.init(tmpDir, true);
    log.info('timestamp check');
    const content = readLog();
    // ISO 8601 pattern: [2026-03-12T...]
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('dev-mode console output is suppressed under jest (no leaked logs)', () => {
    // In dev mode the logger mirrors to console.log. Under jest an app timer
    // can log after a test ends ("Cannot log after tests are done") and spam
    // output. JEST_WORKER_ID is always set in a jest worker, so the console
    // mirror must stay silent here while still writing to the file.
    expect(process.env.JEST_WORKER_ID).toBeDefined();
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      log.init(tmpDir, true, true); // enabled + isDev
      log.info('dev line');
      expect(spy).not.toHaveBeenCalled();
      expect(readLog()).toContain('[INFO] dev line');
    } finally {
      spy.mockRestore();
    }
  });
});
