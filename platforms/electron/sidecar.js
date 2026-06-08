const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const EventEmitter = require('events');

class Sidecar extends EventEmitter {
  constructor(enginePath) {
    super();
    this.enginePath = enginePath;
    this.proc = null;
    this.rl = null;
    this._pendingRequests = new Map();
    this._nextId = 1;
  }

  start() {
    if (this.proc) return;

    const fs = require('fs');
    const engineDir = path.dirname(this.enginePath);
    let cmd, args, cwd;

    // Production: use bundled PyInstaller binary
    if (process.resourcesPath) {
      const bin = process.platform === 'win32' ? 'engine.exe' : 'engine';
      const bundled = path.join(process.resourcesPath, 'engine-bin', bin);
      if (fs.existsSync(bundled)) {
        cmd = bundled;
        args = [];
        cwd = path.dirname(bundled);
      }
    }

    // Development: use Python. Resolution order:
    //  1. WHISPERCLICK_PYTHON env (explicit override — e2e harness, power users)
    //  2. a sibling virtualenv next to the engine (.venv or venv, either layout)
    //  3. bare 'python' on PATH (last resort; can fail on Windows if absent)
    if (!cmd) {
      const isWin = process.platform === 'win32';
      const venvPy = (root) => isWin
        ? path.join(root, 'Scripts', 'python.exe')
        : path.join(root, 'bin', 'python');
      const candidates = [
        process.env.WHISPERCLICK_PYTHON,
        venvPy(path.join(engineDir, '..', '.venv')),
        venvPy(path.join(engineDir, '..', 'venv')),
        venvPy(path.join(engineDir, '.venv')),
        venvPy(path.join(engineDir, 'venv')),
      ].filter(Boolean);
      cmd = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } })
        || 'python';
      args = ['-u', this.enginePath];
      cwd = engineDir;
    }

    this.proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });

    this.rl = readline.createInterface({ input: this.proc.stdout });

    this.rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        // Event-style messages (no id)
        if (msg.event) {
          this.emit(msg.event, msg.data);
          return;
        }
        // Response to a request
        if (msg.id && this._pendingRequests.has(msg.id)) {
          const { resolve, reject } = this._pendingRequests.get(msg.id);
          this._pendingRequests.delete(msg.id);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg);
        }
      } catch {
        // Non-JSON output — ignore
      }
    });

    this.proc.stderr.on('data', (data) => {
      this.emit('stderr', data.toString());
    });

    this.proc.on('exit', (code) => {
      this.proc = null;
      this.rl = null;
      // Reject all pending requests
      for (const [id, { reject }] of this._pendingRequests) {
        reject(new Error(`Sidecar exited with code ${code}`));
      }
      this._pendingRequests.clear();
      this.emit('exit', code);
    });
  }

  // Commands that may take a long time (model downloads, etc.)
  static LONG_TIMEOUT_COMMANDS = new Set(['download_model']);

  async send(command, payload = {}) {
    if (!this.proc) throw new Error('Sidecar not running');
    const id = this._nextId++;
    const msg = JSON.stringify({ id, command, ...payload });
    const timeout = Sidecar.LONG_TIMEOUT_COMMANDS.has(command) ? 600000 : 60000;

    return new Promise((resolve, reject) => {
      this._pendingRequests.set(id, { resolve, reject });
      this.proc.stdin.write(msg + '\n');

      setTimeout(() => {
        if (this._pendingRequests.has(id)) {
          this._pendingRequests.delete(id);
          reject(new Error(`Sidecar command "${command}" timed out`));
        }
      }, timeout);
    });
  }

  stop({ force = false } = {}) {
    if (!this.proc) return;

    if (force) {
      // Synchronous, guaranteed reap. Used on app quit: a deferred timer can be
      // skipped if the app process exits first, leaving an orphaned engine
      // child holding the mic. Kill immediately instead.
      try { this.proc.kill(); } catch { /* ignore */ }
      this.proc = null;
      return;
    }

    try {
      this.proc.stdin.write(JSON.stringify({ id: 0, command: 'quit' }) + '\n');
    } catch { /* ignore */ }
    setTimeout(() => {
      if (this.proc) {
        this.proc.kill();
        this.proc = null;
      }
    }, 2000);
  }

  restart() {
    this.stop();
    setTimeout(() => this.start(), 500);
  }

  get isRunning() {
    return this.proc !== null;
  }

  // The engine child's OS pid (or null when not running). Used by the startup
  // orphan sweep to spare the live engine while killing stale ones.
  get pid() {
    return this.proc ? this.proc.pid : null;
  }
}

module.exports = Sidecar;
