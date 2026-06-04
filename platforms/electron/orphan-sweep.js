const { execFile } = require('child_process');

/**
 * Kill stale `engine.exe` processes left over from a previous run (a crash, a
 * hard kill, or a quit that skipped reaping). Orphaned engines pile up, each
 * holding the mic and burning CPU — a direct cause of "multiple WhisperClick
 * processes" and general bog-down.
 *
 * Windows-only: production ships a PyInstaller `engine.exe`. In dev the engine
 * runs as `python`, which we deliberately do NOT sweep (it could match an
 * unrelated Python process), so this is a no-op off win32.
 *
 * @param {object}   [opts]
 * @param {number|null} [opts.keepPid]  PID to spare (the engine we just started), if any.
 * @param {string}   [opts.platform]    process.platform — injectable for tests.
 * @param {function} [opts.exec]        child_process.execFile — injectable for tests.
 * @returns {Promise<{swept:number[], skipped:boolean}>}
 *          `swept` = pids killed; `skipped` = true when not applicable (non-win32).
 */
function sweepStaleEngines({ keepPid = null, platform = process.platform, exec = execFile } = {}) {
  return new Promise((resolve) => {
    if (platform !== 'win32') {
      resolve({ swept: [], skipped: true });
      return;
    }

    // Defensive: if no usable execFile is available (e.g. a test harness that
    // stubs child_process without it), skip rather than throw.
    if (typeof exec !== 'function') {
      resolve({ swept: [], skipped: false });
      return;
    }

    exec(
      'tasklist',
      ['/FI', 'IMAGENAME eq engine.exe', '/FO', 'CSV', '/NH'],
      (err, stdout) => {
        if (err) {
          resolve({ swept: [], skipped: false });
          return;
        }

        const pids = [];
        for (const line of String(stdout).split(/\r?\n/)) {
          // CSV rows look like: "engine.exe","1234","Console","1","45,000 K"
          const m = line.match(/^"engine\.exe","(\d+)"/i);
          if (m) {
            const pid = parseInt(m[1], 10);
            if (pid && pid !== keepPid) pids.push(pid);
          }
        }

        if (pids.length === 0) {
          resolve({ swept: [], skipped: false });
          return;
        }

        let pending = pids.length;
        const swept = [];
        for (const pid of pids) {
          exec('taskkill', ['/F', '/PID', String(pid)], (killErr) => {
            if (!killErr) swept.push(pid);
            if (--pending === 0) resolve({ swept, skipped: false });
          });
        }
      }
    );
  });
}

module.exports = { sweepStaleEngines };
