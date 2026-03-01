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

    // Find Python — prefer venv if it exists alongside engine
    const engineDir = path.dirname(this.enginePath);
    const venvPython = path.join(engineDir, '..', 'venv', 'Scripts', 'python.exe');
    const pythonCmd = require('fs').existsSync(venvPython) ? venvPython : 'python';

    this.proc = spawn(pythonCmd, ['-u', this.enginePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: engineDir,
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

  stop() {
    if (this.proc) {
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
  }

  restart() {
    this.stop();
    setTimeout(() => this.start(), 500);
  }

  get isRunning() {
    return this.proc !== null;
  }
}

module.exports = Sidecar;
