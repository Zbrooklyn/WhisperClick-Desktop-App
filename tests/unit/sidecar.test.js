const { PassThrough } = require('stream');
const EventEmitter = require('events');
const Sidecar = require('../../platforms/electron/sidecar');

// Mock child_process.spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock fs.existsSync for venvPython check
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => false),
}));

const { spawn } = require('child_process');

/** Create a fake child process with PassThrough streams */
function createFakeProc() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = jest.fn(() => {
    proc.emit('exit', null);
  });
  proc.pid = 12345;
  return proc;
}

let fakeProc;

beforeEach(() => {
  spawn.mockClear();
  fakeProc = createFakeProc();
  spawn.mockReturnValue(fakeProc);
});

afterEach(() => {
  jest.restoreAllMocks();
  // Ensure fake timers are always restored to prevent worker exit warnings
  try { jest.useRealTimers(); } catch {}
  // Destroy any lingering stdin streams
  if (fakeProc && fakeProc.stdin) {
    fakeProc.stdin.destroy();
    fakeProc.stdout.destroy();
    fakeProc.stderr.destroy();
  }
});

// ── Lifecycle ───────────────────────────────────────────────────────────

describe('lifecycle', () => {
  test('start spawns a child process', () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(sc.isRunning).toBe(true);
  });

  test('start is no-op when already running', () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();
    sc.start(); // second call
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test('isRunning reflects process state', () => {
    const sc = new Sidecar('/path/to/engine.py');
    expect(sc.isRunning).toBe(false);
    sc.start();
    expect(sc.isRunning).toBe(true);
    fakeProc.emit('exit', 0);
    expect(sc.isRunning).toBe(false);
  });

  test('stop sends quit command via stdin', () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    const written = [];
    fakeProc.stdin.on('data', (d) => written.push(d.toString()));

    sc.stop();
    expect(written.some(line => line.includes('"quit"'))).toBe(true);
  });

  test('stop force-kills after 2 seconds', () => {
    jest.useFakeTimers();
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    // Prevent kill from triggering exit (so proc stays non-null for the force-kill check)
    fakeProc.kill = jest.fn();

    sc.stop();
    jest.advanceTimersByTime(2000);
    expect(fakeProc.kill).toHaveBeenCalled();
    jest.useRealTimers();
  });
});

// ── JSON protocol ───────────────────────────────────────────────────────

describe('JSON protocol', () => {
  test('send writes JSON line to stdin', async () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    const written = [];
    fakeProc.stdin.on('data', (d) => written.push(d.toString()));

    // Don't await — just fire it off, we only care about what was written
    const p = sc.send('ping');

    // Respond immediately so the promise resolves
    fakeProc.stdout.push(JSON.stringify({ id: 1, result: 'pong' }) + '\n');
    await p;

    const lastMsg = JSON.parse(written[written.length - 1].trim());
    expect(lastMsg.command).toBe('ping');
    expect(lastMsg.id).toBeDefined();
  });

  test('resolves on matching id response', async () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    const promise = sc.send('ping');

    // Respond with matching id
    fakeProc.stdout.push(JSON.stringify({ id: 1, result: 'pong' }) + '\n');

    const result = await promise;
    expect(result.result).toBe('pong');
  });

  test('rejects on error response', async () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    const promise = sc.send('bad_cmd');
    fakeProc.stdout.push(JSON.stringify({ id: 1, error: 'Unknown command' }) + '\n');

    await expect(promise).rejects.toThrow('Unknown command');
  });

  test('ignores non-matching ids', async () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    const promise = sc.send('ping');

    // Push a response with wrong id
    fakeProc.stdout.push(JSON.stringify({ id: 999, result: 'wrong' }) + '\n');
    // Push correct response
    fakeProc.stdout.push(JSON.stringify({ id: 1, result: 'right' }) + '\n');

    const result = await promise;
    expect(result.result).toBe('right');
  });
});

// ── Events ──────────────────────────────────────────────────────────────

describe('events', () => {
  test('event-style messages are emitted', (done) => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    sc.on('ready', (data) => {
      expect(data).toEqual({ version: '1.0' });
      done();
    });

    fakeProc.stdout.push(JSON.stringify({ event: 'ready', data: { version: '1.0' } }) + '\n');
  });

  test('stderr is emitted', (done) => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    sc.on('stderr', (msg) => {
      expect(msg).toContain('warning');
      done();
    });

    fakeProc.stderr.push('warning: something happened');
  });

  test('exit event includes code', (done) => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    sc.on('exit', (code) => {
      expect(code).toBe(1);
      done();
    });

    fakeProc.emit('exit', 1);
  });
});

// ── Timeouts ────────────────────────────────────────────────────────────

describe('timeouts', () => {
  test('60s timeout for normal commands', async () => {
    jest.useFakeTimers();
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    const promise = sc.send('ping');
    jest.advanceTimersByTime(60001);

    await expect(promise).rejects.toThrow('timed out');
    jest.useRealTimers();
  });

  test('600s timeout for download_model', async () => {
    jest.useFakeTimers();
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    const promise = sc.send('download_model', { model_name: 'base' });

    // 60s should NOT time out
    jest.advanceTimersByTime(60001);
    // Flush microtasks
    await Promise.resolve();

    // Still pending — verify no rejection yet
    let settled = false;
    promise.then(() => { settled = true; }).catch(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    // 600s should time out
    jest.advanceTimersByTime(540000);
    await expect(promise).rejects.toThrow('timed out');
    jest.useRealTimers();
  });

  test('timed-out request removed from pending map', async () => {
    jest.useFakeTimers();
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    sc.send('ping').catch(() => {});

    expect(sc._pendingRequests.size).toBe(1);
    jest.advanceTimersByTime(60001);
    await Promise.resolve();
    expect(sc._pendingRequests.size).toBe(0);
    jest.useRealTimers();
  });
});

// ── Exit cleanup ────────────────────────────────────────────────────────

describe('exit cleanup', () => {
  test('all pending requests are rejected on exit', async () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    const p1 = sc.send('cmd1');
    const p2 = sc.send('cmd2');

    fakeProc.emit('exit', 1);

    await expect(p1).rejects.toThrow('exited');
    await expect(p2).rejects.toThrow('exited');
  });

  test('pending map is cleared on exit', () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    sc.send('cmd1').catch(() => {});
    sc.send('cmd2').catch(() => {});

    expect(sc._pendingRequests.size).toBe(2);
    fakeProc.emit('exit', 0);
    expect(sc._pendingRequests.size).toBe(0);
  });
});

// ── Restart ─────────────────────────────────────────────────────────────

describe('restart', () => {
  test('restart calls stop then schedules start', () => {
    jest.useFakeTimers();
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();
    expect(spawn).toHaveBeenCalledTimes(1);

    // Prevent kill from triggering exit
    fakeProc.kill = jest.fn();

    sc.restart();

    // stop() sends quit + schedules force-kill at 2s
    // restart() schedules start() at 500ms
    // But start() is a no-op while proc is still non-null

    // Simulate the process exiting (which sets proc = null)
    fakeProc.emit('exit', 0);

    // Set up new proc for the restart
    const fakeProc2 = createFakeProc();
    spawn.mockReturnValue(fakeProc2);

    // Advance past the 500ms restart delay
    jest.advanceTimersByTime(500);

    expect(spawn).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────

describe('edge cases', () => {
  test('send throws when sidecar is not running', async () => {
    const sc = new Sidecar('/path/to/engine.py');
    // Don't call start
    await expect(sc.send('ping')).rejects.toThrow('not running');
  });

  test('malformed JSON from stdout is silently ignored', () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    // Push garbage — should not throw
    expect(() => {
      fakeProc.stdout.push('this is not json\n');
      fakeProc.stdout.push('{incomplete json\n');
      fakeProc.stdout.push('\n');
    }).not.toThrow();
  });

  test('concurrent sends track separate ids', async () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    const p1 = sc.send('cmd1');
    const p2 = sc.send('cmd2');
    const p3 = sc.send('cmd3');

    expect(sc._pendingRequests.size).toBe(3);

    // Respond to each with their respective id
    fakeProc.stdout.push(JSON.stringify({ id: 1, result: 'r1' }) + '\n');
    fakeProc.stdout.push(JSON.stringify({ id: 2, result: 'r2' }) + '\n');
    fakeProc.stdout.push(JSON.stringify({ id: 3, result: 'r3' }) + '\n');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.result).toBe('r1');
    expect(r2.result).toBe('r2');
    expect(r3.result).toBe('r3');
    expect(sc._pendingRequests.size).toBe(0);
  });

  test('null exit code does not reject pending (graceful exit)', () => {
    const sc = new Sidecar('/path/to/engine.py');
    sc.start();

    sc.send('ping').catch(() => {});
    // null exit code is passed when killed
    fakeProc.emit('exit', null);
    expect(sc._pendingRequests.size).toBe(0);
    expect(sc.isRunning).toBe(false);
  });

  test('stop on already-stopped sidecar is safe', () => {
    const sc = new Sidecar('/path/to/engine.py');
    // Never started — stop should be a no-op
    expect(() => sc.stop()).not.toThrow();
  });
});
