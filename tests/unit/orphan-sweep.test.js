const { sweepStaleEngines, isUnder } = require('../../platforms/electron/orphan-sweep');

// Our install marker (resourcesPath) and engine paths relative to it.
const OWN = 'C:\\Program Files\\WhisperClick\\resources';
const ownEngine = (pid) => ({ pid, path: OWN + '\\engine-bin\\engine.exe' });
const otherInstallEngine = (pid) => ({ pid, path: 'C:\\Program Files\\WhisperClick2\\resources\\engine-bin\\engine.exe' });
const unrelatedEngine = (pid) => ({ pid, path: 'C:\\Tools\\SomethingElse\\engine.exe' });
const unknownPathEngine = (pid) => ({ pid, path: '' });

/**
 * Fake execFile:
 *  - 'powershell' -> CIM-style "PID\tPATH" lines for the given engines (or error)
 *  - 'taskkill'   -> records the killed pid; errors for pids in failKills
 */
function makeExec({ engines = [], psErr = null, failKills = [] } = {}) {
  const killed = [];
  const exec = jest.fn((cmd, args, cb) => {
    if (cmd === 'powershell') {
      const out = engines.map((e) => `${e.pid}\t${e.path}`).join('\r\n') + '\r\n';
      cb(psErr, out);
    } else if (cmd === 'taskkill') {
      const pid = parseInt(args[args.indexOf('/PID') + 1], 10);
      if (failKills.includes(pid)) cb(new Error('access denied'));
      else { killed.push(pid); cb(null, ''); }
    }
  });
  exec._killed = killed;
  return exec;
}

const run = (opts) => sweepStaleEngines({ platform: 'win32', ownDir: OWN, ...opts });

describe('isUnder (path ownership)', () => {
  test('engine under our resources is owned', () => {
    expect(isUnder(OWN, OWN + '\\engine-bin\\engine.exe')).toBe(true);
  });
  test('case-insensitive on Windows paths', () => {
    expect(isUnder(OWN.toUpperCase(), OWN.toLowerCase() + '\\engine-bin\\engine.exe')).toBe(true);
  });
  test('different install is NOT owned', () => {
    expect(isUnder(OWN, 'C:\\Program Files\\WhisperClick2\\resources\\engine-bin\\engine.exe')).toBe(false);
  });
  test('sibling-prefix dir is NOT owned (no false prefix match)', () => {
    expect(isUnder(OWN, 'C:\\Program Files\\WhisperClick\\resources-other\\engine.exe')).toBe(false);
  });
});

describe('sweepStaleEngines — path-scoped', () => {
  test('no-op on non-win32', async () => {
    const exec = makeExec();
    const res = await sweepStaleEngines({ platform: 'darwin', ownDir: OWN, exec });
    expect(res).toEqual({ swept: [], spared: [], skipped: true });
    expect(exec).not.toHaveBeenCalled();
  });

  test('no-op when no ownership marker (ownDir missing)', async () => {
    const exec = makeExec({ engines: [ownEngine(101)] });
    const res = await sweepStaleEngines({ platform: 'win32', ownDir: undefined, exec });
    expect(res).toEqual({ swept: [], spared: [], skipped: false });
    expect(exec).not.toHaveBeenCalled(); // never even queries
  });

  // (1) same-app stale engine gets swept
  test('sweeps a stale engine from THIS install', async () => {
    const exec = makeExec({ engines: [ownEngine(101)] });
    const res = await run({ keepPid: null, exec });
    expect(res.swept).toEqual([101]);
    expect(exec._killed).toEqual([101]);
  });

  // (2) current live engine is spared
  test('spares the live engine (keepPid) even though it is ours', async () => {
    const exec = makeExec({ engines: [ownEngine(101), ownEngine(202)] });
    const res = await run({ keepPid: 202, exec });
    expect(res.swept).toEqual([101]);
    expect(res.spared).toContain(202);
    expect(exec._killed).not.toContain(202);
  });

  // (3) different packaged install is spared
  test("spares a DIFFERENT install's engine (path not under ownDir)", async () => {
    const exec = makeExec({ engines: [ownEngine(101), otherInstallEngine(900)] });
    const res = await run({ keepPid: null, exec });
    expect(res.swept).toEqual([101]);
    expect(res.spared).toContain(900);
    expect(exec._killed).not.toContain(900);
  });

  // (5) unrelated engine.exe is spared
  test('spares an unrelated third-party engine.exe', async () => {
    const exec = makeExec({ engines: [unrelatedEngine(700)] });
    const res = await run({ keepPid: null, exec });
    expect(res.swept).toEqual([]);
    expect(res.spared).toContain(700);
    expect(exec._killed).toEqual([]);
  });

  test('spares an engine whose path is unreadable (ownership unprovable)', async () => {
    const exec = makeExec({ engines: [unknownPathEngine(500)] });
    const res = await run({ keepPid: null, exec });
    expect(res.swept).toEqual([]);
    expect(res.spared).toContain(500);
  });

  test('mixed reality: kills only our orphans, spares everything else', async () => {
    const exec = makeExec({
      engines: [ownEngine(101), ownEngine(202), otherInstallEngine(900), unrelatedEngine(700), unknownPathEngine(500)],
    });
    const res = await run({ keepPid: 202, exec });
    expect(res.swept).toEqual([101]);            // only our non-live orphan
    expect(res.spared.sort((a, b) => a - b)).toEqual([202, 500, 700, 900]);
  });

  test('powershell query error -> nothing swept', async () => {
    const exec = makeExec({ psErr: new Error('boom') });
    const res = await run({ exec });
    expect(res).toEqual({ swept: [], spared: [], skipped: false });
  });

  test('a failed taskkill is excluded from swept but does not abort', async () => {
    const exec = makeExec({ engines: [ownEngine(101), ownEngine(202)], failKills: [101] });
    const res = await run({ keepPid: null, exec });
    expect(res.swept).toEqual([202]);
  });
});
