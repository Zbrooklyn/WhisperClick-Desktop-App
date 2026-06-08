/**
 * Integration-level tests for every IPC handler in main.js.
 *
 * Strategy: require main.js with all Electron APIs mocked, trigger the
 * app.whenReady callback, then test each handler via ipcMain._invoke().
 */

const os = require('os');
const path = require('path');
const realFs = jest.requireActual('fs');

// Create a real temp dir for the store
const TEST_CONFIG_BASE = realFs.mkdtempSync(path.join(os.tmpdir(), 'wc-ipc-'));

// --- Mock child_process (for sidecar) ---
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
      proc.pid = 12345;
      return proc;
    }),
    exec: jest.fn(),
    // R10: orphan-sweep uses execFile. Stub it to report "no engines running"
    // so the startup sweep is a safe no-op in tests (never runs real taskkill).
    execFile: jest.fn((cmd, args, cb) => cb(null, '')),
  };
});

// --- Mock fs: real fs except venv check ---
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn((p) => {
      if (typeof p === 'string' && p.includes('venv')) return false;
      return actual.existsSync(p);
    }),
  };
});

// Configure electron mock before requiring main.js
const { app, ipcMain, clipboard, globalShortcut, BrowserWindow, dialog, Menu, Tray } = require('electron');
const { spawn } = require('child_process');

// Override app.getPath to use our real temp dir
app.getPath = (name) => {
  if (name === 'userData') return TEST_CONFIG_BASE;
  return os.tmpdir();
};

// Require main.js — registers all handlers and whenReady callback
require('../../platforms/electron/main');

// Trigger app.whenReady — initializes store, sidecar, windows, tray
app._triggerReady();

// Capture the fake sidecar process created during ready
const initialFakeProc = spawn.mock.results[0].value;

// Capture the mainWindow (first BrowserWindow created during ready)
const mainWin = BrowserWindow._instances[0];

/**
 * Set up auto-responder on the sidecar's stdin.
 * Returns a cleanup function to remove the listener.
 */
function autoRespondSidecar(proc, commandResponses = {}) {
  const handler = (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        const cmd = msg.command;
        const template = commandResponses[cmd] || { result: 'ok' };
        const response = { ...template, id: msg.id };
        setImmediate(() => {
          try { proc.stdout.push(JSON.stringify(response) + '\n'); } catch {}
        });
      } catch {}
    }
  };
  proc.stdin.on('data', handler);
  return () => proc.stdin.removeListener('data', handler);
}

/** Push a sidecar event (e.g. transcription, error) to the fake proc's stdout */
function pushSidecarEvent(proc, event, data = {}) {
  proc.stdout.push(JSON.stringify({ event, data }) + '\n');
}

/** Wait for async processing to settle */
function tick(ms = 30) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Auto-respond ONLY to specific sidecar commands (ignores unmatched commands).
 * Unlike autoRespondSidecar which responds to ALL commands with a default,
 * this only responds to commands listed in commandResponses.
 */
function autoRespondSidecarStrict(proc, commandResponses = {}) {
  const handler = (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        const cmd = msg.command;
        if (commandResponses[cmd]) {
          const template = commandResponses[cmd];
          const response = { ...template, id: msg.id };
          setImmediate(() => {
            try { proc.stdout.push(JSON.stringify(response) + '\n'); } catch {}
          });
        }
        // If command not in commandResponses, silently ignore it
      } catch {}
    }
  };
  proc.stdin.on('data', handler);
  return () => proc.stdin.removeListener('data', handler);
}

// ── Boot sidecar (Phase 2: sidecar must be ready for recording tests) ────
// Install a permanent STRICT auto-responder for 'configure' only (fires on every
// ready event). This doesn't interfere with test-specific autoResponders for other commands.
let _bootCleanup;
beforeAll(async () => {
  _bootCleanup = autoRespondSidecarStrict(initialFakeProc, {
    configure: { result: 'ok' },
  });
  pushSidecarEvent(initialFakeProc, 'ready', { version: '1.0' });
  await tick(50);
  await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-test-key' });
});

// ─── Cleanup ──────────────────────────────────────────────────────────────

afterAll(() => {
  if (_bootCleanup) _bootCleanup();
  try { realFs.rmSync(TEST_CONFIG_BASE, { recursive: true, force: true }); } catch {}
  try { initialFakeProc.stdin.destroy(); } catch {}
  try { initialFakeProc.stdout.destroy(); } catch {}
  try { initialFakeProc.stderr.destroy(); } catch {}
});

// ── Helper: ensure sidecar is ready + API key set ───────────────────────
// Phase 2 state machine requires sidecar running AND API key for start-recording.
async function ensureSidecarReadyAndApiKey() {
  pushSidecarEvent(initialFakeProc, 'ready', { version: '1.0' });
  await tick(50);
  await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-test-key' });
}

// ── Settings handlers ───────────────────────────────────────────────────

describe('settings handlers', () => {
  test('get-settings returns settings with defaults', async () => {
    const result = await ipcMain._invoke('get-settings');
    expect(result.mode).toBe('api');
    expect(result.provider).toBe('openai');
    expect(result.theme).toBe('dark');
    expect(result.hotkey).toBe('Ctrl+Alt+R');
  });

  test('save-settings merges patch with existing', async () => {
    await ipcMain._invoke('save-settings', { theme: 'light' });
    const result = await ipcMain._invoke('get-settings');
    expect(result.theme).toBe('light');
    expect(result.mode).toBe('api'); // default preserved
  });

  test('save-settings wires autoStart', async () => {
    app.setLoginItemSettings.mockClear();
    await ipcMain._invoke('save-settings', { autoStart: true });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({ openAtLogin: true })
    );
  });

  test('save-settings re-registers hotkey on change', async () => {
    globalShortcut.register.mockClear();
    await ipcMain._invoke('save-settings', { hotkey: 'Ctrl+Shift+X' });
    expect(globalShortcut.register).toHaveBeenCalledWith(
      'Ctrl+Shift+X',
      expect.any(Function)
    );
  });

  test('save-settings returns success', async () => {
    const result = await ipcMain._invoke('save-settings', { soundEnabled: false });
    expect(result).toEqual({ success: true });
  });

  test('save-settings encrypts API keys on disk', async () => {
    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-test-key' });
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.openaiApiKey).toBe('sk-test-key'); // decrypted on read

    // Dev config dir is com.whisperclick.dev (matches main.js); the old
    // 'whisperclick-dev' name was stale and made this test falsely fail,
    // hiding whether API keys are actually encrypted at rest.
    const configDir = path.join(TEST_CONFIG_BASE, 'com.whisperclick.dev');
    const raw = JSON.parse(realFs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
    expect(raw.openaiApiKey).toMatch(/^enc:/);
  });

  // Reset theme for subsequent tests
  afterAll(async () => {
    await ipcMain._invoke('save-settings', { theme: 'dark', hotkey: 'Ctrl+Alt+R' });
  });
});

// ── History handlers ────────────────────────────────────────────────────

describe('factory reset handler', () => {
  test('reset-settings clears settings and history', async () => {
    // Add some data first
    await ipcMain._invoke('save-settings', { theme: 'light' });
    const result = await ipcMain._invoke('reset-settings');
    expect(result).toEqual({ success: true });

    // Verify settings are back to defaults
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.theme).toBe('dark');
    expect(settings.onboardingComplete).toBe(false);

    // Verify history is cleared
    const history = await ipcMain._invoke('get-history');
    expect(history).toEqual([]);
  });
});

describe('history handlers', () => {
  beforeAll(async () => {
    await ipcMain._invoke('clear-history');
  });

  test('get-history returns empty array initially', async () => {
    const result = await ipcMain._invoke('get-history');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('clear-history empties the list', async () => {
    const result = await ipcMain._invoke('clear-history');
    expect(result).toEqual([]);
  });

  test('delete-history with non-existent id is safe', async () => {
    const result = await ipcMain._invoke('delete-history', 'nonexistent');
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── State handler ───────────────────────────────────────────────────────

describe('state handler', () => {
  test('get-state returns current app state', async () => {
    const result = await ipcMain._invoke('get-state');
    expect(result.state).toBeDefined();
    expect(['dormant', 'recording', 'processing', 'success', 'error']).toContain(result.state);
  });
});

// ── Model handlers (sidecar proxy) ──────────────────────────────────────

describe('model handlers', () => {
  test('list-models returns models from sidecar', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      list_models: { models: [{ name: 'base', downloaded: true }] },
    });
    const result = await ipcMain._invoke('list-models');
    cleanup();
    expect(result.models).toEqual([{ name: 'base', downloaded: true }]);
  });

  test('download-model proxies to sidecar', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      download_model: { result: 'ok' },
    });
    const result = await ipcMain._invoke('download-model', 'small');
    cleanup();
    expect(result.result).toBe('ok');
  });

  test('delete-model proxies to sidecar', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      delete_model: { result: 'ok' },
    });
    const result = await ipcMain._invoke('delete-model', 'tiny');
    cleanup();
    expect(result.result).toBe('ok');
  });
});

// ── Microphone handlers ─────────────────────────────────────────────────

describe('microphone handlers', () => {
  test('list-mics returns devices from sidecar', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      list_mics: { devices: [{ id: 0, name: 'Default' }] },
    });
    const result = await ipcMain._invoke('list-mics');
    cleanup();
    expect(result.devices).toEqual([{ id: 0, name: 'Default' }]);
  });

  test('set-mic proxies device id', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      set_mic: { result: 'ok' },
    });
    const result = await ipcMain._invoke('set-mic', 1);
    cleanup();
    expect(result.result).toBe('ok');
  });
});

// ── API key verification ────────────────────────────────────────────────

describe('API key verification', () => {
  test('empty key returns invalid', async () => {
    const result = await ipcMain._invoke('verify-api-key', '', '');
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/No key/i);
  });

  test('whitespace-only key returns invalid', async () => {
    const result = await ipcMain._invoke('verify-api-key', 'openai', '   ');
    expect(result.valid).toBe(false);
  });

  test('valid key proxied to sidecar when running', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      verify_key: { valid: true, success: true },
    });
    const result = await ipcMain._invoke('verify-api-key', 'openai', 'sk-test');
    cleanup();
    expect(result.valid).toBe(true);
  });

  test('sidecar error falls through to format check', async () => {
    // Respond with an error so the handler catches and falls through
    const cleanup = autoRespondSidecar(initialFakeProc, {
      verify_key: { error: 'Network error' },
    });
    // sk- prefix should pass format check even when sidecar errors
    const result = await ipcMain._invoke('verify-api-key', 'openai', 'sk-valid');
    cleanup();
    expect(result.valid).toBe(true);
  });
});

// ── Recording handlers ──────────────────────────────────────────────────

describe('recording handlers', () => {
  beforeAll(async () => {
    await ensureSidecarReadyAndApiKey();
  });

  test('start-recording succeeds with sidecar response', async () => {
    // Ensure dormant before starting
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    const cleanup = autoRespondSidecar(initialFakeProc, {
      start_rec: { result: 'ok' },
    });
    const result = await ipcMain._invoke('start-recording');
    cleanup();
    expect(result.success).toBe(true);
  });

  test('cancel-processing sends cancel command', async () => {
    // Phase 2: must be in recording/processing state to cancel
    const cleanup = autoRespondSidecar(initialFakeProc, {
      start_rec: { result: 'ok' },
      cancel: { result: 'ok' },
    });
    // Ensure dormant first, then start recording so cancel has something to cancel
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    await ipcMain._invoke('start-recording');
    const result = await ipcMain._invoke('cancel-processing');
    cleanup();
    expect(result.success).toBe(true);
  });

  test('cancel-processing resets state to dormant immediately', async () => {
    // Ensure dormant first
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    // Put app in recording state first
    const cleanup = autoRespondSidecar(initialFakeProc, {
      start_rec: { result: 'ok' },
      cancel: { result: 'ok' },
    });
    await ipcMain._invoke('start-recording');
    const stateBeforeCancel = await ipcMain._invoke('get-state');
    expect(stateBeforeCancel.state).toBe('recording');

    await ipcMain._invoke('cancel-processing');
    cleanup();
    const stateAfterCancel = await ipcMain._invoke('get-state');
    expect(stateAfterCancel.state).toBe('dormant');
  });
});

// ── Clipboard handlers ──────────────────────────────────────────────────

describe('clipboard handlers', () => {
  test('copy-to-clipboard writes text', async () => {
    clipboard._reset();
    const result = await ipcMain._invoke('copy-to-clipboard', 'test clipboard');
    expect(result).toEqual({ success: true });
    expect(clipboard.readText()).toBe('test clipboard');
  });

  test('paste-last-transcript fails with empty history', async () => {
    await ipcMain._invoke('clear-history');
    const result = await ipcMain._invoke('paste-last-transcript');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No transcriptions/);
  });
});

// ── Window handlers ─────────────────────────────────────────────────────

describe('window handlers', () => {
  test('window-minimize does not throw', async () => {
    await ipcMain._invoke('window-minimize');
  });

  test('window-maximize does not throw', async () => {
    await ipcMain._invoke('window-maximize');
  });

  test('window-close does not throw', async () => {
    await ipcMain._invoke('window-close');
  });

  test('window-is-maximized returns boolean', async () => {
    const result = await ipcMain._invoke('window-is-maximized');
    expect(typeof result).toBe('boolean');
  });
});

// ── Display handlers ────────────────────────────────────────────────────

describe('display handlers', () => {
  test('get-displays returns display list with labels', async () => {
    const result = await ipcMain._invoke('get-displays');
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toEqual(expect.objectContaining({
      id: expect.any(Number),
      label: expect.stringContaining('Display'),
    }));
  });
});

// ── App info ────────────────────────────────────────────────────────────

describe('app info', () => {
  test('get-app-info returns version, platform, and modKey', async () => {
    const result = await ipcMain._invoke('get-app-info');
    expect(result.version).toBe('2.0.1');
    expect(result.platform).toBe(process.platform);
    expect(result.isDev).toBe(true);
    expect(['Ctrl', 'Cmd']).toContain(result.modKey);
  });
});

// ── Pill handlers ───────────────────────────────────────────────────────

describe('pill handlers', () => {
  test('toggle-pill returns boolean', async () => {
    const result = await ipcMain._invoke('toggle-pill');
    expect(typeof result).toBe('boolean');
  });
});

// ════════════════════════════════════════════════════════════════════════
// NEW TESTS — filling coverage gaps in main.js
// ════════════════════════════════════════════════════════════════════════

// ── save-settings window effects ────────────────────────────────────────

describe('save-settings window effects', () => {
  test('theme change updates window background and overlay', async () => {
    mainWin.setBackgroundColor.mockClear();
    mainWin.setTitleBarOverlay.mockClear();
    await ipcMain._invoke('save-settings', { theme: 'light' });
    expect(mainWin.setBackgroundColor).toHaveBeenCalledWith('#FAFAF9');
    expect(mainWin.setTitleBarOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ color: '#F5F5F4', symbolColor: '#78716C' })
    );
    // Reset
    await ipcMain._invoke('save-settings', { theme: 'dark' });
  });

  test('alwaysOnTop wired to mainWindow', async () => {
    mainWin.setAlwaysOnTop.mockClear();
    await ipcMain._invoke('save-settings', { alwaysOnTop: true });
    expect(mainWin.setAlwaysOnTop).toHaveBeenCalledWith(true);
    // Reset
    await ipcMain._invoke('save-settings', { alwaysOnTop: false });
  });
});

// ── verify-api-key format rejections ────────────────────────────────────

describe('verify-api-key format checks', () => {
  test('rejects bad OpenAI key format in fallback', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      verify_key: { error: 'offline' },
    });
    const result = await ipcMain._invoke('verify-api-key', 'openai', 'badkey');
    cleanup();
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/sk-/);
  });

  test('rejects bad Gemini key format in fallback', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      verify_key: { error: 'offline' },
    });
    const result = await ipcMain._invoke('verify-api-key', 'gemini', 'badkey');
    cleanup();
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/AIza/);
  });

  test('format-only fallback does NOT claim a valid-format key is verified', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      verify_key: { error: 'offline' },
    });
    const result = await ipcMain._invoke('verify-api-key', 'gemini', 'AIza-test-key');
    cleanup();
    // Honest: format looks fine but we could not actually verify it.
    expect(result.valid).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.formatValid).toBe(true);
    expect(result.message).toMatch(/could not verify/i);
  });
});

// ── hotkey registration failure surfacing ───────────────────────────────
describe('hotkey registration failure', () => {
  const { Notification } = require('electron');

  test('surfaces a notification when a hotkey cannot be registered', async () => {
    Notification._clear();
    // Force the next globalShortcut.register to report failure (e.g. taken).
    globalShortcut.register.mockReturnValueOnce(false);
    await ipcMain._invoke('save-settings', { hotkey: 'Ctrl+Alt+F9' });
    const titles = Notification._instances.map(n => n.opts.title || '');
    expect(titles.some(t => /shortcut unavailable/i.test(t))).toBe(true);
  });
});

// ── stop-recording handler ──────────────────────────────────────────────

describe('stop-recording handler', () => {
  // Phase 2: stop-recording requires recording->processing transition.
  // Each test must start from recording state.
  beforeAll(async () => {
    await ensureSidecarReadyAndApiKey();
  });

  async function startRecordingForStop() {
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    const startCleanup = autoRespondSidecarStrict(initialFakeProc, {
      start_rec: { result: 'ok' },
    });
    await ipcMain._invoke('start-recording');
    await tick(20);
    startCleanup();
  }

  test('resolves with transcription text on transcription event', async () => {
    await startRecordingForStop();
    const cleanup = autoRespondSidecar(initialFakeProc, {
      stop_rec: { result: 'ok' },
    });
    const promise = ipcMain._invoke('stop-recording');
    await tick(50);
    pushSidecarEvent(initialFakeProc, 'transcription', { text: 'hello world' });
    const result = await promise;
    cleanup();
    expect(result.success).toBe(true);
    expect(result.text).toBe('hello world');
  });

  test('resolves with error on sidecar error event', async () => {
    await startRecordingForStop();
    const cleanup = autoRespondSidecar(initialFakeProc, {
      stop_rec: { result: 'ok' },
    });
    const promise = ipcMain._invoke('stop-recording');
    await tick(50);
    pushSidecarEvent(initialFakeProc, 'error', { message: 'mic disconnected' });
    const result = await promise;
    cleanup();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/mic disconnected/);
  });

  test('resolves with cancelled on cancel event', async () => {
    await startRecordingForStop();
    const cleanup = autoRespondSidecar(initialFakeProc, {
      stop_rec: { result: 'ok' },
    });
    const promise = ipcMain._invoke('stop-recording');
    await tick(50);
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    const result = await promise;
    cleanup();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Cancelled/);
  });

  test('returns error when sidecar send fails', async () => {
    await startRecordingForStop();
    // Respond with an error so sidecar.send rejects
    const cleanup = autoRespondSidecar(initialFakeProc, {
      stop_rec: { error: 'Engine not ready' },
    });
    const result = await ipcMain._invoke('stop-recording');
    cleanup();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Engine not ready/);
  });
});

// ── get-audio handler ───────────────────────────────────────────────────

describe('get-audio handler', () => {
  test('returns error for non-existent history id', async () => {
    const result = await ipcMain._invoke('get-audio', 'no-such-id');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No audio/);
  });

  test('returns error when entry has no audio_file', async () => {
    // Push a transcription without audio_file to create a history entry
    await ipcMain._invoke('clear-history');
    pushSidecarEvent(initialFakeProc, 'transcription', { text: 'no audio here' });
    await tick(50);
    const history = await ipcMain._invoke('get-history');
    const entry = history.find(h => h.text === 'no audio here');
    expect(entry).toBeDefined();
    const result = await ipcMain._invoke('get-audio', entry.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No audio/);
  });

  test('returns error when audio file not found on disk', async () => {
    // Push a transcription WITH audio_file path that doesn't exist
    pushSidecarEvent(initialFakeProc, 'transcription', {
      text: 'with audio path',
      audio_file: '/nonexistent/dir/audio.wav',
    });
    await tick(50);
    const history = await ipcMain._invoke('get-history');
    const entry = history.find(h => h.text === 'with audio path');
    expect(entry).toBeDefined();
    const result = await ipcMain._invoke('get-audio', entry.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  test('returns base64 audio data for existing file', async () => {
    // Create a real temp audio file
    const tmpAudio = path.join(os.tmpdir(), 'wc-test-audio.wav');
    realFs.writeFileSync(tmpAudio, 'fake-wav-data');

    pushSidecarEvent(initialFakeProc, 'transcription', {
      text: 'real audio',
      audio_file: tmpAudio,
    });
    await tick(50);
    const history = await ipcMain._invoke('get-history');
    const entry = history.find(h => h.text === 'real audio');
    expect(entry).toBeDefined();

    const result = await ipcMain._invoke('get-audio', entry.id);
    expect(result.success).toBe(true);
    expect(result.data).toBe(Buffer.from('fake-wav-data').toString('base64'));
    expect(result.mime).toBe('audio/wav');

    realFs.unlinkSync(tmpAudio);
  });
});

// ── export-transcription handler ────────────────────────────────────────

describe('export-transcription handler', () => {
  test('returns cancelled when dialog is dismissed', async () => {
    // Default mock returns { canceled: true }
    const result = await ipcMain._invoke('export-transcription', 'some text', 'txt');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Cancelled/);
  });

  test('writes file and returns path on successful save', async () => {
    const tmpFile = path.join(os.tmpdir(), 'wc-export-test.txt');
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: tmpFile });
    const result = await ipcMain._invoke('export-transcription', 'exported text', 'txt');
    expect(result.success).toBe(true);
    expect(result.path).toBe(tmpFile);
    // Verify file was actually written
    expect(realFs.readFileSync(tmpFile, 'utf8')).toBe('exported text');
    realFs.unlinkSync(tmpFile);
  });
});

// ── show / settings / hide handlers ─────────────────────────────────────

describe('show and hide handlers', () => {
  test('show-main-window shows and focuses window', async () => {
    mainWin.show.mockClear();
    mainWin.focus.mockClear();
    await ipcMain._invoke('show-main-window');
    expect(mainWin.show).toHaveBeenCalled();
    expect(mainWin.focus).toHaveBeenCalled();
  });

  test('show-settings shows window and executes openSettingsDrawer', async () => {
    mainWin.show.mockClear();
    mainWin.focus.mockClear();
    mainWin.webContents.executeJavaScript.mockClear();
    await ipcMain._invoke('show-settings');
    expect(mainWin.show).toHaveBeenCalled();
    expect(mainWin.focus).toHaveBeenCalled();
    expect(mainWin.webContents.executeJavaScript).toHaveBeenCalledWith(
      'openSettingsDrawer()'
    );
  });

  test('hide-pill updates showPill setting to false', async () => {
    await ipcMain._invoke('hide-pill');
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.showPill).toBe(false);
    // Restore
    await ipcMain._invoke('save-settings', { showPill: true });
  });
});

// ── move-pill-to-display ────────────────────────────────────────────────

describe('move-pill-to-display', () => {
  test('moves pill to known display', async () => {
    // Display id 1 exists in the mock screen.getAllDisplays()
    const result = await ipcMain._invoke('move-pill-to-display', 1);
    expect(result.success).toBe(true);
  });

  test('returns error for unknown display id', async () => {
    const result = await ipcMain._invoke('move-pill-to-display', 999);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });
});

// ── pill-clicked ────────────────────────────────────────────────────────

describe('pill-clicked', () => {
  test('capsule click routes through mainWindow JS execution', async () => {
    mainWin._destroyed = false; // Reset from window-close test
    mainWin.webContents.executeJavaScript.mockClear();
    // Ensure sidecar is running and API key is set (validation requires both)
    pushSidecarEvent(initialFakeProc, 'ready', { version: '1.0' });
    await tick(50);
    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-test-key' });
    await ipcMain._invoke('pill-clicked', 'capsule');
    expect(mainWin.webContents.executeJavaScript).toHaveBeenCalledWith(
      'triggerTrustedHotkeyToggle()'
    );
  });
});

// ── pill-context-menu ───────────────────────────────────────────────────

describe('pill-context-menu', () => {
  let cleanupSidecar;
  beforeAll(() => {
    cleanupSidecar = autoRespondSidecar(initialFakeProc, {
      list_mics: [{ id: 0, name: 'Default Mic', is_default: true }],
    });
  });
  afterAll(() => { if (cleanupSidecar) cleanupSidecar(); });

  test('builds menu with correct items', async () => {
    Menu.buildFromTemplate.mockClear();
    await ipcMain._invoke('pill-context-menu');
    expect(Menu.buildFromTemplate).toHaveBeenCalled();
    const template = Menu.buildFromTemplate.mock.calls[0][0];
    const labels = template.filter(i => i.label).map(i => i.label);
    expect(labels).toContain('Show WhisperClick');
    expect(labels).toContain('Settings');
    expect(labels).toContain('Hide Pill');
    expect(labels).toContain('Microphone');
    expect(labels).toContain('Sound Effects');
    expect(labels).toContain('Paste Last Transcript');
    // Should have Start/Stop Recording as first item
    expect(labels[0]).toMatch(/Recording/);
  });
});

// ── sidecar event handling ──────────────────────────────────────────────

describe('sidecar event handling', () => {
  let cleanupRec;
  beforeAll(async () => {
    await ipcMain._invoke('clear-history');
    await ensureSidecarReadyAndApiKey();
    // Keep a responder for start_rec so we can put state into recording
    cleanupRec = autoRespondSidecarStrict(initialFakeProc, {
      start_rec: { result: 'ok' },
    });
  });
  afterAll(() => { if (cleanupRec) cleanupRec(); });

  // Helper: ensure recording state so transcription/error events have a valid predecessor
  async function ensureRecording() {
    // Reset to dormant first
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    await ipcMain._invoke('start-recording');
    await tick(20);
  }

  async function ensureProcessing() {
    // Get to processing state: dormant → recording → processing
    await ensureRecording();
    await ipcMain._invoke('stop-recording');
    await tick(20);
  }

  test('transcription event adds history entry', async () => {
    await ensureRecording();
    pushSidecarEvent(initialFakeProc, 'transcription', {
      text: 'sidecar transcription test',
      duration: 3.2,
      provider: 'openai',
      model: 'whisper-1',
    });
    await tick(50);
    const history = await ipcMain._invoke('get-history');
    const entry = history.find(h => h.text === 'sidecar transcription test');
    expect(entry).toBeDefined();
    expect(entry.duration).toBe(3.2);
    expect(entry.provider).toBe('openai');
  });

  test('transcription event sets state to success', async () => {
    await ensureRecording();
    pushSidecarEvent(initialFakeProc, 'transcription', { text: 'state check' });
    await tick(30);
    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('success');
  });

  test('transcription with autoPaste copies to clipboard', async () => {
    await ensureRecording();
    // autoPaste defaults to true
    clipboard._reset();
    pushSidecarEvent(initialFakeProc, 'transcription', { text: 'auto paste text' });
    await tick(30);
    expect(clipboard.readText()).toBe('auto paste text');
  });

  test('transcription broadcasts to mainWindow', async () => {
    await ensureRecording();
    mainWin.webContents.send.mockClear();
    pushSidecarEvent(initialFakeProc, 'transcription', { text: 'broadcast test' });
    await tick(30);
    expect(mainWin.webContents.send).toHaveBeenCalledWith(
      'transcription',
      expect.objectContaining({ text: 'broadcast test' })
    );
  });

  test('translation event updates most recent history entry', async () => {
    await ensureRecording();
    // Push a transcription first
    pushSidecarEvent(initialFakeProc, 'transcription', { text: 'original text' });
    await tick(50);

    // Now push a translation
    pushSidecarEvent(initialFakeProc, 'translation', { text: 'translated text' });
    await tick(50);

    const history = await ipcMain._invoke('get-history');
    const entry = history.find(h => h.text === 'original text');
    expect(entry).toBeDefined();
    expect(entry.translation).toBe('translated text');
  });

  test('error event sets error state', async () => {
    // Reset to dormant — dormant->error is valid
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    pushSidecarEvent(initialFakeProc, 'error', { message: 'test error' });
    await tick(30);
    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('error');
  });

  test('error event includes message in state', async () => {
    // Wait for any pending broadcastError timeouts (3s) from previous tests
    await tick(3100);
    // Reset to dormant first
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    pushSidecarEvent(initialFakeProc, 'error', { message: 'API key invalid' });
    await tick(30);
    const state = await ipcMain._invoke('get-state');
    expect(state.message).toBe('API key invalid');
  });

  test('state broadcast includes message field', async () => {
    // Reset to dormant first
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    mainWin.webContents.send.mockClear();
    pushSidecarEvent(initialFakeProc, 'error', { message: 'broadcast msg test' });
    await tick(30);
    expect(mainWin.webContents.send).toHaveBeenCalledWith(
      'state-update',
      expect.objectContaining({ state: 'error', message: 'broadcast msg test' })
    );
  });

  test('error event broadcasts to mainWindow', async () => {
    // Reset to dormant first
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    mainWin.webContents.send.mockClear();
    pushSidecarEvent(initialFakeProc, 'error', { message: 'broadcast error' });
    await tick(30);
    expect(mainWin.webContents.send).toHaveBeenCalledWith(
      'sidecar-error',
      expect.objectContaining({ message: 'broadcast error' })
    );
  });

  test('cancelled event resets state to dormant', async () => {
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('dormant');
  });

  test('level event broadcasts to mainWindow', async () => {
    mainWin.webContents.send.mockClear();
    pushSidecarEvent(initialFakeProc, 'level', { level: 0.75 });
    await tick(30);
    expect(mainWin.webContents.send).toHaveBeenCalledWith('level-update', 0.75);
  });

  test('model_download_progress event forwarded to mainWindow', async () => {
    mainWin.webContents.send.mockClear();
    pushSidecarEvent(initialFakeProc, 'model_download_progress', { progress: 50 });
    await tick(30);
    expect(mainWin.webContents.send).toHaveBeenCalledWith(
      'model-download-progress',
      expect.objectContaining({ progress: 50 })
    );
  });
});

// ── paste-last-transcript with history ──────────────────────────────────

describe('paste-last-transcript with history', () => {
  test('copies last transcript and returns success', async () => {
    // Ensure there's a history entry from previous sidecar event tests
    const history = await ipcMain._invoke('get-history');
    expect(history.length).toBeGreaterThan(0);

    clipboard._reset();
    const result = await ipcMain._invoke('paste-last-transcript');
    expect(result.success).toBe(true);
    expect(result.text).toBeDefined();
    expect(clipboard.readText()).toBe(result.text);
  });
});

// ── start-recording error path ──────────────────────────────────────────

describe('start-recording error path', () => {
  beforeAll(async () => {
    await ensureSidecarReadyAndApiKey();
  });

  test('returns error when sidecar send fails', async () => {
    // Ensure dormant first
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    const cleanup = autoRespondSidecar(initialFakeProc, {
      start_rec: { error: 'No mic available' },
    });
    const result = await ipcMain._invoke('start-recording');
    cleanup();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No mic/);
  });

  test('resets state to error then dormant on sidecar failure', async () => {
    // Ensure dormant first
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    const cleanup = autoRespondSidecar(initialFakeProc, {
      start_rec: { error: 'Failed' },
    });
    await ipcMain._invoke('start-recording');
    cleanup();
    const state = await ipcMain._invoke('get-state');
    // broadcastError sets 'error' first, then dormant after 3s timeout
    expect(state.state).toBe('error');
    expect(state.message).toMatch(/Failed/);
  });
});

// ── sidecar proxy error paths ───────────────────────────────────────────

describe('sidecar proxy error paths', () => {
  test('list-models catches sidecar send error', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      list_models: { error: 'Engine crashed' },
    });
    const result = await ipcMain._invoke('list-models');
    cleanup();
    expect(result.error).toMatch(/Engine crashed/);
  });

  test('download-model catches sidecar send error', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      download_model: { error: 'Disk full' },
    });
    const result = await ipcMain._invoke('download-model', 'large');
    cleanup();
    expect(result.error).toMatch(/Disk full/);
  });

  test('delete-model catches sidecar send error', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      delete_model: { error: 'File locked' },
    });
    const result = await ipcMain._invoke('delete-model', 'base');
    cleanup();
    expect(result.error).toMatch(/File locked/);
  });

  test('list-mics catches sidecar send error', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      list_mics: { error: 'Audio subsystem error' },
    });
    const result = await ipcMain._invoke('list-mics');
    cleanup();
    expect(result.error).toMatch(/Audio subsystem/);
  });

  test('set-mic catches sidecar send error', async () => {
    const cleanup = autoRespondSidecar(initialFakeProc, {
      set_mic: { error: 'Device not found' },
    });
    const result = await ipcMain._invoke('set-mic', 99);
    cleanup();
    expect(result.error).toMatch(/Device not found/);
  });

  test('cancel-processing catches sidecar send error', async () => {
    // Phase 2: must be in recording/processing state to cancel
    await ensureSidecarReadyAndApiKey();
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    const startCleanup = autoRespondSidecarStrict(initialFakeProc, {
      start_rec: { result: 'ok' },
    });
    await ipcMain._invoke('start-recording');
    startCleanup();
    const cleanup = autoRespondSidecar(initialFakeProc, {
      cancel: { error: 'Nothing to cancel' },
    });
    const result = await ipcMain._invoke('cancel-processing');
    cleanup();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Nothing to cancel/);
  });
});

// ── error state recovery ────────────────────────────────────────────────

describe('error state recovery', () => {
  beforeAll(async () => {
    // Drain any pending timers from previous tests
    await new Promise(r => setTimeout(r, 3500));
    // Ensure dormant
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
  });

  test('error state returns to dormant via ack-state', async () => {
    pushSidecarEvent(initialFakeProc, 'error', { message: 'timeout test' });
    await tick(50);

    const errorState = await ipcMain._invoke('get-state');
    expect(errorState.state).toBe('error');

    // UI acks the error — main transitions to dormant
    await ipcMain._invoke('ack-state');
    const recoveredState = await ipcMain._invoke('get-state');
    expect(recoveredState.state).toBe('dormant');
  });

  test('success state returns to dormant after 1.5 seconds', async () => {
    // Phase 2: transcription needs recording->success; set up recording first
    await ensureSidecarReadyAndApiKey();
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    const startCleanup = autoRespondSidecarStrict(initialFakeProc, {
      start_rec: { result: 'ok' },
    });
    await ipcMain._invoke('start-recording');
    startCleanup();

    pushSidecarEvent(initialFakeProc, 'transcription', { text: 'timeout recovery' });
    await tick(50);

    const successState = await ipcMain._invoke('get-state');
    expect(successState.state).toBe('success');

    // UI acks success — main transitions to dormant
    await ipcMain._invoke('ack-state');
    const dormantState = await ipcMain._invoke('get-state');
    expect(dormantState.state).toBe('dormant');
  });
});

// ── sidecar ready event ─────────────────────────────────────────────────

describe('sidecar ready event', () => {
  test('ready event triggers configure command', async () => {
    const stdinCapture = [];
    const captureHandler = (d) => stdinCapture.push(d.toString());
    initialFakeProc.stdin.on('data', captureHandler);

    const cleanup = autoRespondSidecar(initialFakeProc, {
      configure: { result: 'ok' },
    });

    pushSidecarEvent(initialFakeProc, 'ready', { version: '1.0' });
    await tick(50);

    cleanup();
    initialFakeProc.stdin.removeListener('data', captureHandler);

    const configMsg = stdinCapture.find(w => w.includes('"configure"'));
    expect(configMsg).toBeDefined();
    const parsed = JSON.parse(configMsg.trim());
    expect(parsed.command).toBe('configure');
    // Args are spread into the message (not nested under 'args')
    expect(parsed.mode).toBeDefined();
    expect(parsed.provider).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// CRITICAL GAP TESTS — close-to-tray, hotkey, pill clicks, showPill, guards
// ════════════════════════════════════════════════════════════════════════

// ── close-to-tray behavior ──────────────────────────────────────────────

describe('close-to-tray behavior', () => {
  test('close with closeBehavior=tray prevents default and hides window', async () => {
    await ipcMain._invoke('save-settings', { closeBehavior: 'tray' });
    mainWin.hide.mockClear();

    const closeHandlers = mainWin._listeners['close'];
    expect(closeHandlers).toBeDefined();
    expect(closeHandlers.length).toBeGreaterThan(0);

    const event = { preventDefault: jest.fn() };
    closeHandlers[0](event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mainWin.hide).toHaveBeenCalled();
  });

  test('close with closeBehavior=quit does NOT prevent default', async () => {
    await ipcMain._invoke('save-settings', { closeBehavior: 'quit' });
    mainWin.hide.mockClear();

    const closeHandlers = mainWin._listeners['close'];
    const event = { preventDefault: jest.fn() };
    closeHandlers[0](event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mainWin.hide).not.toHaveBeenCalled();

    // Reset to default
    await ipcMain._invoke('save-settings', { closeBehavior: 'tray' });
  });
});

// ── hotkey and toggleRecording ───────────────────────────────────────────

describe('hotkey and toggleRecording', () => {
  beforeAll(async () => {
    // Ensure we're in dormant state and mainWin is alive
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    mainWin._destroyed = false;
    // Set up valid API key so pre-validation passes
    await ipcMain._invoke('save-settings', { provider: 'openai', openaiApiKey: 'sk-test-key', mode: 'api' });
  });

  test('hotkey callback routes through mainWindow JS', () => {
    mainWin._destroyed = false;
    mainWin.webContents.executeJavaScript.mockClear();

    const hotkeyCallback = globalShortcut._shortcuts['Ctrl+Alt+R'];
    expect(hotkeyCallback).toBeDefined();

    hotkeyCallback();

    expect(mainWin.webContents.executeJavaScript).toHaveBeenCalledWith(
      'triggerTrustedHotkeyToggle()'
    );
  });

  test('hotkey falls back to toggleRecording when mainWindow destroyed', async () => {
    // Drain all pending timers (broadcastError has a 3s dormant timeout)
    await new Promise(r => setTimeout(r, 4000));

    // Force dormant state and verify
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(100);
    const preState = await ipcMain._invoke('get-state');
    expect(preState.state).toBe('dormant');

    mainWin._destroyed = true;
    mainWin.webContents.executeJavaScript.mockClear();

    const cleanup = autoRespondSidecar(initialFakeProc, {
      start_rec: { result: 'ok' },
    });

    const hotkeyCallback = globalShortcut._shortcuts['Ctrl+Alt+R'];
    hotkeyCallback();
    await tick(200);
    cleanup();

    // executeJavaScript should NOT have been called (mainWindow.isDestroyed() = true)
    expect(mainWin.webContents.executeJavaScript).not.toHaveBeenCalled();

    // toggleRecording should have changed state from dormant to recording
    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('recording');

    // Reset
    mainWin._destroyed = false;
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
  });

  test('toggleRecording from recording sends stop_rec and goes to processing', async () => {
    // Drain any pending success→dormant timers from earlier transcription tests
    await new Promise(r => setTimeout(r, 2000));

    // Ensure dormant
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);

    mainWin._destroyed = true;
    mainWin.webContents.executeJavaScript.mockClear();

    const cleanup = autoRespondSidecar(initialFakeProc, {
      start_rec: { result: 'ok' },
      stop_rec: { result: 'ok' },
    });
    const hotkeyCallback = globalShortcut._shortcuts['Ctrl+Alt+R'];

    // First toggle: dormant → recording (state set synchronously)
    hotkeyCallback();
    let state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('recording');

    // Wait for start_rec response + hotkey debounce (300ms) to expire
    await tick(350);

    // Second toggle: recording → processing (async — waits for stop_rec response)
    hotkeyCallback();
    await tick(200);

    state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('processing');

    cleanup();

    // Reset
    mainWin._destroyed = false;
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
  });
});

// ── pill state sync — pre-validation and error feedback ─────────────────

describe('pill state sync and error feedback', () => {
  beforeAll(async () => {
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);
    mainWin._destroyed = false;
  });

  test('pill-clicked capsule with no API key broadcasts error', async () => {
    // Clear API keys
    await ipcMain._invoke('save-settings', { openaiApiKey: '', geminiApiKey: '', mode: 'api', provider: 'openai' });

    mainWin.webContents.send.mockClear();
    await ipcMain._invoke('pill-clicked', 'capsule');
    await tick(30);

    expect(mainWin.webContents.send).toHaveBeenCalledWith(
      'state-update',
      expect.objectContaining({ state: 'error', message: expect.stringMatching(/API key/i) })
    );

    // Restore key for subsequent tests
    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-test-key' });
  });

  test('pill-clicked capsule with valid API key routes through to V3', async () => {
    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-test-key', mode: 'api', provider: 'openai' });
    mainWin.webContents.executeJavaScript.mockClear();

    await ipcMain._invoke('pill-clicked', 'capsule');

    expect(mainWin.webContents.executeJavaScript).toHaveBeenCalledWith(
      'triggerTrustedHotkeyToggle()'
    );
  });

  test('hotkey with no API key sets error state with message', async () => {
    await ipcMain._invoke('save-settings', { openaiApiKey: '', geminiApiKey: '', mode: 'api', provider: 'openai' });
    await tick(50);

    const hotkeyCallback = globalShortcut._shortcuts['Ctrl+Alt+R'];
    hotkeyCallback();
    await tick(30);

    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('error');
    expect(state.message).toMatch(/API key|not ready/i);

    // Restore
    await ipcMain._invoke('save-settings', { openaiApiKey: 'sk-test-key' });
    // Wait for error to clear
    await new Promise(r => setTimeout(r, 3500));
  });

  test('error message clears after timeout', async () => {
    jest.useFakeTimers();
    pushSidecarEvent(initialFakeProc, 'error', { message: 'test timeout clear' });
    await Promise.resolve();
    jest.advanceTimersByTime(100);
    await Promise.resolve();

    let state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('error');
    expect(state.message).toBe('test timeout clear');

    jest.advanceTimersByTime(3000);
    await Promise.resolve();

    state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('dormant');
    expect(state.message).toBe('');

    jest.useRealTimers();
  });

  test('get-state returns message field', async () => {
    const state = await ipcMain._invoke('get-state');
    expect(state).toHaveProperty('message');
  });
});

// ── pill-context-menu click handlers ────────────────────────────────────

describe('pill-context-menu click handlers', () => {
  let cleanupSidecar;
  beforeAll(() => {
    cleanupSidecar = autoRespondSidecar(initialFakeProc, {
      list_mics: [{ id: 0, name: 'Default Mic', is_default: true }],
    });
  });
  afterAll(() => { if (cleanupSidecar) cleanupSidecar(); });

  test('Start Recording click routes through mainWindow', async () => {
    mainWin._destroyed = false;
    mainWin.webContents.executeJavaScript.mockClear();
    Menu.buildFromTemplate.mockClear();

    await ipcMain._invoke('pill-context-menu');
    const template = Menu.buildFromTemplate.mock.calls[0][0];
    const recordItem = template.find(i => i.label && i.label.match(/Recording/));
    expect(recordItem).toBeDefined();

    recordItem.click();
    expect(mainWin.webContents.executeJavaScript).toHaveBeenCalledWith(
      'triggerTrustedHotkeyToggle()'
    );
  });

  test('Show WhisperClick click shows and focuses mainWindow', async () => {
    mainWin.show.mockClear();
    mainWin.focus.mockClear();
    Menu.buildFromTemplate.mockClear();

    await ipcMain._invoke('pill-context-menu');
    const template = Menu.buildFromTemplate.mock.calls[0][0];
    const showItem = template.find(i => i.label === 'Show WhisperClick');
    expect(showItem).toBeDefined();

    showItem.click();
    expect(mainWin.show).toHaveBeenCalled();
    expect(mainWin.focus).toHaveBeenCalled();
  });

  test('Settings click shows window and opens settings drawer', async () => {
    mainWin.show.mockClear();
    mainWin.focus.mockClear();
    mainWin.webContents.executeJavaScript.mockClear();
    Menu.buildFromTemplate.mockClear();

    await ipcMain._invoke('pill-context-menu');
    const template = Menu.buildFromTemplate.mock.calls[0][0];
    const settingsItem = template.find(i => i.label === 'Settings');
    expect(settingsItem).toBeDefined();

    settingsItem.click();
    expect(mainWin.show).toHaveBeenCalled();
    expect(mainWin.focus).toHaveBeenCalled();
    expect(mainWin.webContents.executeJavaScript).toHaveBeenCalledWith(
      'openSettingsDrawer()'
    );
  });

  test('Hide Pill click closes pill and updates showPill setting', async () => {
    Menu.buildFromTemplate.mockClear();

    await ipcMain._invoke('pill-context-menu');
    const template = Menu.buildFromTemplate.mock.calls[0][0];
    const hideItem = template.find(i => i.label === 'Hide Pill');
    expect(hideItem).toBeDefined();

    hideItem.click();

    // Verify showPill setting was updated
    const settings = await ipcMain._invoke('get-settings');
    expect(settings.showPill).toBe(false);

    // Restore
    await ipcMain._invoke('save-settings', { showPill: true });
  });
});

// ── showPill settings toggle ────────────────────────────────────────────

describe('showPill settings toggle', () => {
  test('showPill=false closes pill, showPill=true recreates it', async () => {
    // Ensure pill exists (save-settings showPill=true may have created one,
    // or one existed from app._triggerReady)
    // First, null out any destroyed pill by triggering 'closed' events
    const destroyedPills = BrowserWindow._instances.filter(
      w => w.opts.frame === false && w.opts.transparent === true && w._destroyed
    );
    destroyedPills.forEach(w => {
      if (w._listeners['closed']) w._listeners['closed'].forEach(fn => fn());
    });

    // Now ensure a pill exists
    await ipcMain._invoke('save-settings', { showPill: true });
    await tick(30);

    // Find the active pill window
    const pillWin = [...BrowserWindow._instances].reverse().find(
      w => w.opts.frame === false && w.opts.transparent === true && !w._destroyed
    );
    expect(pillWin).toBeDefined();
    pillWin.close.mockClear();

    // Close pill via showPill=false
    await ipcMain._invoke('save-settings', { showPill: false });
    expect(pillWin.close).toHaveBeenCalled();

    // Simulate the 'closed' event to null out pillWindow in main.js
    if (pillWin._listeners['closed']) {
      pillWin._listeners['closed'].forEach(fn => fn());
    }

    // Now recreate pill via showPill=true
    const countBefore = BrowserWindow._instances.length;
    await ipcMain._invoke('save-settings', { showPill: true });

    // A new pill BrowserWindow should have been created
    expect(BrowserWindow._instances.length).toBe(countBefore + 1);
    const newPill = BrowserWindow._instances[BrowserWindow._instances.length - 1];
    expect(newPill.opts.frame).toBe(false);
    expect(newPill.opts.transparent).toBe(true);
    expect(newPill.opts.alwaysOnTop).toBe(true);
    expect(newPill.loadFile).toHaveBeenCalled();
  });
});

// ── toggle-pill creates and closes pill ─────────────────────────────────

describe('toggle-pill lifecycle', () => {
  test('toggle-pill closes existing pill and returns false', async () => {
    // Ensure pill exists
    const settings = await ipcMain._invoke('get-settings');
    if (!settings.showPill) {
      await ipcMain._invoke('save-settings', { showPill: true });
    }

    const result = await ipcMain._invoke('toggle-pill');
    expect(result).toBe(false);
  });

  test('toggle-pill creates pill when none exists and returns true', async () => {
    // Null out pillWindow by triggering 'closed' on destroyed pills
    const pills = BrowserWindow._instances.filter(
      w => w.opts.frame === false && w.opts.transparent === true
    );
    pills.forEach(w => {
      if (w._listeners['closed']) w._listeners['closed'].forEach(fn => fn());
    });

    const countBefore = BrowserWindow._instances.length;
    const result = await ipcMain._invoke('toggle-pill');
    expect(result).toBe(true);
    expect(BrowserWindow._instances.length).toBe(countBefore + 1);
  });
});

// ── configureSidecar field completeness ──────────────────────────────────

describe('configureSidecar sends all settings fields', () => {
  test('ready event sends all configure fields with correct values', async () => {
    // Set specific settings so we can verify they reach the sidecar
    await ipcMain._invoke('save-settings', {
      mode: 'local',
      language: 'fr',
      localModel: 'small',
      provider: 'gemini',
      geminiApiKey: 'AIza-test-gemini-key',
      openaiApiKey: 'sk-test-openai-key',
      customBaseUrl: 'https://custom.api.com',
      apiModel: 'whisper-large-v3',
      soundEnabled: false,
      outputMode: 'translate',
      targetLanguage: 'es',
      sourceLanguage: 'ja',
      audioRetentionDays: 7,
    });

    const stdinCapture = [];
    const captureHandler = (d) => stdinCapture.push(d.toString());
    initialFakeProc.stdin.on('data', captureHandler);

    const cleanup = autoRespondSidecar(initialFakeProc, {
      configure: { result: 'ok' },
    });

    // Trigger configureSidecar via ready event
    pushSidecarEvent(initialFakeProc, 'ready', { version: '1.0' });
    await tick(50);

    cleanup();
    initialFakeProc.stdin.removeListener('data', captureHandler);

    const configMsg = stdinCapture.find(w => w.includes('"configure"'));
    expect(configMsg).toBeDefined();
    const parsed = JSON.parse(configMsg.trim());

    expect(parsed.command).toBe('configure');
    expect(parsed.mode).toBe('local');
    expect(parsed.language).toBe('fr');
    expect(parsed.model).toBe('small');
    expect(parsed.provider).toBe('gemini');
    // provider=gemini → should send gemini key, not openai key
    expect(parsed.api_key).toBe('AIza-test-gemini-key');
    expect(parsed.base_url).toBe('https://custom.api.com');
    expect(parsed.api_model).toBe('whisper-large-v3');
    expect(parsed.sound_enabled).toBe(false);
    expect(parsed.output_mode).toBe('translate');
    expect(parsed.target_language).toBe('es');
    expect(parsed.source_language).toBe('ja');
    expect(parsed.audio_retention_days).toBe(7);

    // Reset settings
    await ipcMain._invoke('save-settings', {
      mode: 'api', provider: 'openai', language: 'auto',
      localModel: '', customBaseUrl: '', apiModel: 'whisper-1',
      soundEnabled: true, outputMode: 'transcribe',
      targetLanguage: 'en', sourceLanguage: 'auto',
      audioRetentionDays: 30,
    });
  });
});

// ── translation autoPaste ───────────────────────────────────────────────

describe('translation autoPaste', () => {
  test('translation event with autoPaste copies translated text to clipboard', async () => {
    // Ensure autoPaste is on (default)
    await ipcMain._invoke('save-settings', { autoPaste: true });
    clipboard._reset();

    // Push a transcription first (so there's a history entry to update)
    pushSidecarEvent(initialFakeProc, 'transcription', { text: 'original for paste test' });
    await tick(50);

    // Now push a translation — should copy translation text to clipboard
    clipboard._reset();
    pushSidecarEvent(initialFakeProc, 'translation', { text: 'texto traducido' });
    await tick(50);

    expect(clipboard.readText()).toBe('texto traducido');
  });
});

// ── broadcastState and broadcastLevel to pillWindow ─────────────────────

describe('broadcasts reach pillWindow', () => {
  let pillWin;

  beforeAll(() => {
    // Find the most recent non-destroyed pill window
    pillWin = [...BrowserWindow._instances].reverse().find(
      w => w.opts.frame === false && w.opts.transparent === true && !w._destroyed
    );
  });

  test('pill-render broadcast reaches pillWindow on state change', async () => {
    expect(pillWin).toBeDefined();
    pillWin.webContents.send.mockClear();

    // Push a sidecar event that triggers broadcastState → renderPill
    pushSidecarEvent(initialFakeProc, 'cancelled', {});
    await tick(30);

    expect(pillWin.webContents.send).toHaveBeenCalledWith(
      'pill-render',
      expect.objectContaining({ shape: 'dormant' })
    );
  });

  test('pill-render broadcast reaches pillWindow on level update', async () => {
    expect(pillWin).toBeDefined();
    pillWin.webContents.send.mockClear();

    pushSidecarEvent(initialFakeProc, 'level', { level: 0.42 });
    await tick(30);

    expect(pillWin.webContents.send).toHaveBeenCalledWith(
      'pill-render',
      expect.objectContaining({ shape: 'recording', level: 0.42 })
    );
  });
});

// ── tray callbacks ──────────────────────────────────────────────────────

describe('tray callbacks (dynamic menu)', () => {
  let trayTemplate;
  let cleanupSidecar;

  beforeAll(async () => {
    cleanupSidecar = autoRespondSidecar(initialFakeProc, {
      list_mics: [{ id: 0, name: 'Default Mic', is_default: true }],
    });
    // Tray now uses dynamic right-click menu — simulate right-click to get the template
    const trayInstance = Tray._instances[0];
    expect(trayInstance).toBeDefined();
    await trayInstance.emit('right-click');
    expect(trayInstance.lastPopupMenu).toBeDefined();
    trayTemplate = trayInstance.lastPopupMenu._template;
    expect(trayTemplate).toBeDefined();
  });
  afterAll(() => { if (cleanupSidecar) cleanupSidecar(); });

  test('onShow callback shows and focuses mainWindow', () => {
    mainWin._destroyed = false;
    mainWin.show.mockClear();
    mainWin.focus.mockClear();

    const showItem = trayTemplate.find(i => i.label === 'Show WhisperClick');
    expect(showItem).toBeDefined();
    showItem.click();

    expect(mainWin.show).toHaveBeenCalled();
    expect(mainWin.focus).toHaveBeenCalled();
  });

  test('Start Recording item routes through mainWindow JS', () => {
    mainWin._destroyed = false;
    mainWin.webContents.executeJavaScript.mockClear();

    const recItem = trayTemplate.find(i => /start recording/i.test(i.label));
    expect(recItem).toBeDefined();
    recItem.click();

    expect(mainWin.webContents.executeJavaScript).toHaveBeenCalledWith(
      'triggerTrustedHotkeyToggle()'
    );
  });

  test('Settings item shows window and opens settings drawer', () => {
    mainWin._destroyed = false;
    mainWin.show.mockClear();
    mainWin.focus.mockClear();
    mainWin.webContents.executeJavaScript.mockClear();

    const settingsItem = trayTemplate.find(i => i.label === 'Settings');
    expect(settingsItem).toBeDefined();
    settingsItem.click();

    expect(mainWin.show).toHaveBeenCalled();
    expect(mainWin.focus).toHaveBeenCalled();
    expect(mainWin.webContents.executeJavaScript).toHaveBeenCalledWith(
      'openSettingsDrawer()'
    );
  });

  test('tray menu includes rich items (Microphone, Sound Effects, Mode)', () => {
    const labels = trayTemplate.filter(i => i.label).map(i => i.label);
    expect(labels).toContain('Microphone');
    expect(labels).toContain('Sound Effects');
    expect(labels.some(l => /^Mode:/.test(l))).toBe(true);
  });

});

// ── sidecar restart backoff ─────────────────────────────────────────────

describe('sidecar restart backoff', () => {
  test('crash during recording sets error state', async () => {
    // Put app in recording state first
    const cleanup = autoRespondSidecar(initialFakeProc, {
      start_rec: { result: 'ok' },
    });
    await ipcMain._invoke('start-recording');
    cleanup();
    expect((await ipcMain._invoke('get-state')).state).toBe('recording');

    // Emit exit — the exit handler should set error state for active recordings
    // NOTE: This is the first exit on initialFakeProc, starting the restart chain
    initialFakeProc.emit('exit', 1);
    await tick(30);

    const state = await ipcMain._invoke('get-state');
    expect(state.state).toBe('error');
    expect(state.message).toMatch(/crashed/i);

    // Wait for restart to complete before next test
    await new Promise(r => setTimeout(r, 1500));
    // Push ready event on new process so restartCount resets
    const newProc = spawn.mock.results[spawn.mock.results.length - 1].value;
    pushSidecarEvent(newProc, 'ready', { version: '1.0' });
    await tick(50);
  });

  test('non-zero exit triggers restart with increasing delay, stops after 3', () => {
    jest.useFakeTimers();
    const spawnBefore = spawn.mock.calls.length;

    // Get the current active sidecar process (from restart above)
    let proc = spawn.mock.results[spawn.mock.results.length - 1].value;

    // Crash 1 → restart after 1s (delay = 1000 * 1)
    proc.emit('exit', 1);
    jest.advanceTimersByTime(999);
    expect(spawn.mock.calls.length).toBe(spawnBefore);
    jest.advanceTimersByTime(1);
    expect(spawn.mock.calls.length).toBe(spawnBefore + 1);

    // Crash 2 → restart after 2s (delay = 1000 * 2)
    proc = spawn.mock.results[spawn.mock.results.length - 1].value;
    proc.emit('exit', 1);
    jest.advanceTimersByTime(1999);
    expect(spawn.mock.calls.length).toBe(spawnBefore + 1);
    jest.advanceTimersByTime(1);
    expect(spawn.mock.calls.length).toBe(spawnBefore + 2);

    // Crash 3 → restart after 3s (delay = 1000 * 3)
    proc = spawn.mock.results[spawn.mock.results.length - 1].value;
    proc.emit('exit', 1);
    jest.advanceTimersByTime(3000);
    expect(spawn.mock.calls.length).toBe(spawnBefore + 3);

    // Crash 4 → NO restart (max 3 exhausted)
    proc = spawn.mock.results[spawn.mock.results.length - 1].value;
    const afterThree = spawn.mock.calls.length;
    proc.emit('exit', 1);
    jest.advanceTimersByTime(10000);
    expect(spawn.mock.calls.length).toBe(afterThree);

    jest.useRealTimers();
  });

  test('clean exit (code 0) does not trigger restart', () => {
    const spawnBefore = spawn.mock.calls.length;
    // Get the last process (from crash 4 above, sidecar is dead)
    // Emit exit 0 on a fresh process to test the code 0 path
    // The guard `code !== 0` prevents restart
    const proc = spawn.mock.results[spawn.mock.results.length - 1].value;
    proc.emit('exit', 0);
    expect(spawn.mock.calls.length).toBe(spawnBefore);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// SIDECAR NOT RUNNING GUARDS — MUST BE LAST (sidecar already dead from
// restart backoff tests above)
// ══════════════════════════════════════════════════════════════════════════

describe('sidecar not running guards', () => {

  test('start-recording returns error when sidecar is down', async () => {
    const result = await ipcMain._invoke('start-recording');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not ready/i);
  });

  test('stop-recording returns error when not recording', async () => {
    const result = await ipcMain._invoke('stop-recording');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not recording/i);
  });

  test('list-models returns error when sidecar is down', async () => {
    const result = await ipcMain._invoke('list-models');
    expect(result.error).toMatch(/not running/i);
  });

  test('list-mics returns error when sidecar is down', async () => {
    const result = await ipcMain._invoke('list-mics');
    expect(result.error).toMatch(/not running/i);
  });

  test('cancel-processing returns error when not active (idempotent)', async () => {
    const result = await ipcMain._invoke('cancel-processing');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing to cancel/i);
  });

  test('verify-api-key does not report false success when sidecar is down', async () => {
    const result = await ipcMain._invoke('verify-api-key', 'openai', 'sk-valid-key');
    // Sidecar down -> cannot verify -> must NOT claim valid.
    expect(result.valid).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.formatValid).toBe(true);
    expect(result.message).toMatch(/could not verify/i);
  });
});

// ── tray onQuit — ABSOLUTE LAST (sets isQuitting=true) ──────────────────

describe('tray onQuit', () => {
  test('onQuit callback calls app.quit', async () => {
    app.quit.mockClear();
    const trayInstance = Tray._instances[0];
    // Simulate right-click to get fresh dynamic menu with Quit item
    await trayInstance.emit('right-click');
    const trayTemplate = trayInstance.lastPopupMenu._template;
    const quitItem = trayTemplate.find(i => i.label === 'Quit');
    expect(quitItem).toBeDefined();
    quitItem.click();
    expect(app.quit).toHaveBeenCalled();
  });
});
