/**
 * logger.js — Lightweight file logger for debugging packaged builds.
 *
 * Writes timestamped entries to debug.log in the app's config directory.
 * Rotates at MAX_LOG_SIZE (5MB) — renames current to debug.log.1 and starts fresh.
 * Disabled by default; enable via settings.debugLogging = true.
 */

const fs = require('fs');
const path = require('path');

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

let _logPath = null;
let _enabled = false;
let _isDev = false;
let _fd = null;

function init(configDir, enabled, isDev) {
  // Close previous session if any
  _close();
  _logPath = path.join(configDir, 'debug.log');
  _isDev = !!isDev;
  // Always enable logging in dev mode
  _enabled = _isDev || !!enabled;
  if (_enabled) _open();
}

function setEnabled(enabled) {
  _enabled = !!enabled;
  if (_enabled && !_fd) _open();
  if (!_enabled && _fd) _close();
}

function _open() {
  if (!_logPath) return;
  try {
    // Rotate if over size limit
    try {
      const stat = fs.statSync(_logPath);
      if (stat.size >= MAX_LOG_SIZE) {
        const rotated = _logPath + '.1';
        try { fs.unlinkSync(rotated); } catch { /* ok */ }
        fs.renameSync(_logPath, rotated);
      }
    } catch { /* file doesn't exist yet, that's fine */ }

    _fd = fs.openSync(_logPath, 'a');
    _write('LOG', 'Debug logging started');
  } catch {
    _fd = null;
  }
}

function _close() {
  if (_fd) {
    try { fs.closeSync(_fd); } catch { /* ignore */ }
    _fd = null;
  }
}

function _write(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  // Always print to console in dev mode
  if (_isDev) console.log(line);
  if (!_fd) return;
  try {
    fs.writeSync(_fd, line + '\n');
  } catch {
    // If write fails, close and give up
    _close();
  }
}

function info(msg) {
  if (_enabled) _write('INFO', msg);
}

function warn(msg) {
  if (_enabled) _write('WARN', msg);
}

function error(msg) {
  if (_enabled) _write('ERR ', msg);
}

function state(from, to, message) {
  if (_enabled) {
    const extra = message ? ` (${message})` : '';
    _write('STATE', `${from} → ${to}${extra}`);
  }
}

function ipc(channel, detail) {
  if (_enabled) {
    const extra = detail ? `: ${detail}` : '';
    _write('IPC', `${channel}${extra}`);
  }
}

function tray(action, detail) {
  if (_enabled) {
    const extra = detail ? `: ${detail}` : '';
    _write('TRAY', `${action}${extra}`);
  }
}

function sidecar(event, detail) {
  if (_enabled) {
    const extra = detail ? `: ${detail}` : '';
    _write('SIDECAR', `${event}${extra}`);
  }
}

module.exports = { init, setEnabled, info, warn, error, state, ipc, tray, sidecar };
