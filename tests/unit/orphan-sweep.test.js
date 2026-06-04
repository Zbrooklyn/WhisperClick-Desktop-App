const { sweepStaleEngines } = require('../../platforms/electron/orphan-sweep');

/**
 * Build a fake execFile that responds based on the command:
 *  - 'tasklist' -> calls back with the provided CSV stdout (or an error)
 *  - 'taskkill' -> records the killed pid; errors for pids in `failKills`
 */
function makeExec({ tasklistOut = '', tasklistErr = null, failKills = [] } = {}) {
  const killed = [];
  const exec = jest.fn((cmd, args, cb) => {
    if (cmd === 'tasklist') {
      cb(tasklistErr, tasklistOut);
    } else if (cmd === 'taskkill') {
      const pid = parseInt(args[args.indexOf('/PID') + 1], 10);
      if (failKills.includes(pid)) cb(new Error('access denied'));
      else { killed.push(pid); cb(null, ''); }
    }
  });
  exec._killed = killed;
  return exec;
}

const CSV = (...pids) =>
  pids.map(p => `"engine.exe","${p}","Console","1","45,000 K"`).join('\r\n') + '\r\n';

describe('sweepStaleEngines', () => {
  test('no-op on non-win32 (never shells out)', async () => {
    const exec = makeExec();
    const res = await sweepStaleEngines({ platform: 'darwin', exec });
    expect(res).toEqual({ swept: [], skipped: true });
    expect(exec).not.toHaveBeenCalled();
  });

  test('kills every engine.exe when nothing is kept', async () => {
    const exec = makeExec({ tasklistOut: CSV(101, 202) });
    const res = await sweepStaleEngines({ keepPid: null, platform: 'win32', exec });
    expect(res.swept.sort()).toEqual([101, 202]);
    expect(exec._killed.sort()).toEqual([101, 202]);
  });

  test('spares the live engine (keepPid)', async () => {
    const exec = makeExec({ tasklistOut: CSV(101, 202, 303) });
    const res = await sweepStaleEngines({ keepPid: 202, platform: 'win32', exec });
    expect(res.swept.sort()).toEqual([101, 303]);
    expect(exec._killed).not.toContain(202);
  });

  test('no engines running -> nothing swept', async () => {
    const exec = makeExec({ tasklistOut: '\r\n' });
    const res = await sweepStaleEngines({ platform: 'win32', exec });
    expect(res).toEqual({ swept: [], skipped: false });
  });

  test('tasklist error -> swept empty, not skipped', async () => {
    const exec = makeExec({ tasklistErr: new Error('boom') });
    const res = await sweepStaleEngines({ platform: 'win32', exec });
    expect(res).toEqual({ swept: [], skipped: false });
  });

  test('a failed kill is excluded from swept but does not abort the sweep', async () => {
    const exec = makeExec({ tasklistOut: CSV(101, 202), failKills: [101] });
    const res = await sweepStaleEngines({ platform: 'win32', exec });
    expect(res.swept).toEqual([202]);
  });

  test('ignores malformed tasklist lines', async () => {
    const exec = makeExec({ tasklistOut: 'garbage line\r\n"engine.exe","777","Console","1","1 K"\r\n' });
    const res = await sweepStaleEngines({ platform: 'win32', exec });
    expect(res.swept).toEqual([777]);
  });
});
