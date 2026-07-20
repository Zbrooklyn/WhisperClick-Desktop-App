const { execFile } = require('child_process');
const path = require('path');

/**
 * True if `file` lives inside directory `dir` (path-ownership check).
 * Uses path.relative so it can't be fooled by sibling prefixes
 * (e.g. `...\resources` vs `...\resources-other`).
 */
function isUnder(dir, file) {
  if (!dir || !file) return false;
  // win32-only sweep; lowercase so Windows' case-insensitive paths compare
  // correctly (e.g. C:\Program Files vs c:\program files).
  const rel = path.relative(dir.toLowerCase(), file.toLowerCase());
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Kill orphaned `engine.exe` processes left by a prior crashed/hard-killed run
 * of THIS install — orphans pile up, each holding the mic and burning CPU
 * ("multiple WhisperClick processes" / bog-down).
 *
 * Ownership is proven by executable PATH: only engines whose ExecutablePath
 * lives under our own `ownDir` (the install's resourcesPath, where the bundled
 * engine-bin/engine.exe lives) are eligible. This guarantees the sweep cannot
 * kill:
 *   - the live engine we just started (excluded via keepPid),
 *   - a DIFFERENT packaged install's engine (its path is under a different dir),
 *   - a dev instance's engine (dev runs `python`, not engine.exe under ownDir),
 *   - any unrelated third-party `engine.exe` (different path),
 *   - an engine whose path can't be read (spared — ownership unprovable).
 *
 * Windows-only. No-op off win32, when no ownDir is known, or when execFile is
 * unavailable.
 *
 * @param {object}      [opts]
 * @param {number|null} [opts.keepPid]  PID to spare (the engine we just started).
 * @param {string}      [opts.ownDir]   Our install marker dir (default process.resourcesPath).
 * @param {string}      [opts.platform] process.platform — injectable for tests.
 * @param {function}    [opts.exec]     child_process.execFile — injectable for tests.
 * @returns {Promise<{swept:number[], spared:number[], skipped:boolean}>}
 */
function sweepStaleEngines({
  keepPid = null,
  ownDir = process.resourcesPath,
  platform = process.platform,
  exec = execFile,
} = {}) {
  return new Promise((resolve) => {
    if (platform !== 'win32') { resolve({ swept: [], spared: [], skipped: true }); return; }
    if (typeof exec !== 'function') { resolve({ swept: [], spared: [], skipped: false }); return; }
    // No ownership marker → we cannot prove what's ours → never sweep.
    if (!ownDir) { resolve({ swept: [], spared: [], skipped: false }); return; }

    // tasklist can't report paths; query PID + ExecutablePath together via CIM.
    const psQuery =
      "Get-CimInstance Win32_Process -Filter \"Name='engine.exe'\" | " +
      "ForEach-Object { \"$($_.ProcessId)`t$($_.ExecutablePath)\" }";

    exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', psQuery], (err, stdout) => {
      if (err) { resolve({ swept: [], spared: [], skipped: false }); return; }

      const targets = [];
      const spared = [];
      for (const line of String(stdout).split(/\r?\n/)) {
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const pid = parseInt(line.slice(0, tab).trim(), 10);
        const exePath = line.slice(tab + 1).trim();
        if (!pid) continue;
        if (pid === keepPid) { spared.push(pid); continue; }      // the live engine
        if (!exePath || !isUnder(ownDir, exePath)) { spared.push(pid); continue; } // not ours
        targets.push(pid);
      }

      if (targets.length === 0) { resolve({ swept: [], spared, skipped: false }); return; }

      let pending = targets.length;
      const swept = [];
      for (const pid of targets) {
        exec('taskkill', ['/F', '/PID', String(pid)], (killErr) => {
          if (!killErr) swept.push(pid);
          if (--pending === 0) resolve({ swept, spared, skipped: false });
        });
      }
    });
  });
}

module.exports = { sweepStaleEngines, isUnder };
