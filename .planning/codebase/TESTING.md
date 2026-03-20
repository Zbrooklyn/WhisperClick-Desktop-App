# TESTING.md — WhisperClick Electron Test Infrastructure

Jest test suite, mock infrastructure, test categories, key testing patterns, and coverage thresholds.

## Test Suite Overview

- **Test runner:** Jest 30.2.0
- **Test environment:** Node.js (no Chromium, no browser simulation)
- **Test count:** ~460 total tests across 11 test files (6,841 lines of test code)
- **Primary command:** `npm test` (runs all tests with `--forceExit`)
- **Coverage requirement:** Global 85% statements, 60% branches (enforced by Jest config)

### Test File Breakdown

| File | Type | Count | Lines | Purpose |
|------|------|-------|-------|---------|
| `tests/unit/main-ipc.test.js` | Unit/Integration | ~350 | 1,875 | IPC handlers, settings, recording flow, sidecar protocol |
| `tests/stress/stress.test.js` | Stress | ~70 | 1,887 | Concurrent IPC, rapid state transitions, store contention, memory |
| `tests/unit/preload.test.js` | Unit | ~70 | 657 | Field translation, API shim, event polling |
| `tests/unit/sidecar.test.js` | Unit | ~40 | 379 | Sidecar lifecycle, JSON protocol, request/response matching |
| `tests/integration/recording-flow.test.js` | Integration | ~12 | 342 | End-to-end recording: start → processing → transcription |
| `tests/unit/store.test.js` | Unit | ~30 | 329 | Settings persistence, atomic writes, fallback recovery |
| `tests/unit/state-machine.test.js` | Unit | ~30 | 353 | State transitions, illegal moves, event ordering |
| `tests/e2e/app.e2e.test.js` | E2E | ~13 | 351 | Full app startup, window creation, tray, mock sidecar |
| `tests/unit/tray.test.js` | Unit | ~25 | 340 | Tray menu, balloon notifications, icon updates |
| `tests/unit/updater.test.js` | Unit | ~10 | 199 | Update checking, channel selection, version parsing |
| `tests/unit/logger.test.js` | Unit | ~5 | 129 | Log filtering, file output |

**Total: ~460 tests, 6,841 lines of test code**

## Mock Infrastructure

### Comprehensive Electron Mock (`tests/mocks/electron.js`)

Located at: `/c/Users/Owner/Downloads/AI_Projects/projects/WhisperClick Electron/tests/mocks/electron.js` (7.4K)

**Purpose:** Jest's `moduleNameMapper` redirects all `require('electron')` calls to this mock. Provides minimal stubs for all Electron APIs used:

**Mocked Modules:**

```javascript
// tests/mocks/electron.js

// safeStorage — API key encryption
const safeStorage = {
  isEncryptionAvailable: () => encryptionAvailable,
  encryptString: (plain) => Buffer.from('encrypted:' + plain),
  decryptString: (buf) => { /* decrypt logic */ },
  _setAvailable: (val) => { encryptionAvailable = val; },
  _reset: () => { encryptionAvailable = true; },
};

// nativeImage — icon handling
const nativeImage = {
  createFromBuffer: jest.fn((buf) => ({ /* stub */ })),
  createFromPath: jest.fn(() => ({ /* stub */ })),
};

// Tray — system tray icon
class Tray {
  static _instances = [];
  constructor(icon) { ... }
  setToolTip(tip) { ... }
  setContextMenu(menu) { ... }
  setImage(img) { ... }
  on(event, fn) { ... }
  emit(event, ...args) { ... }
}

// Menu — context menus
class Menu {
  static buildFromTemplate(template) { ... }
}

// BrowserWindow — main and pill windows
class BrowserWindow {
  static _instances = [];
  constructor(opts) { ... }
  loadFile(path) { ... }
  show() { ... }
  hide() { ... }
  close() { ... }
  webContents = { executeJavaScript(...) { ... } };
}

// app — application lifecycle
const app = {
  getVersion: () => '2.1.2',
  getPath: (name) => { /* stub */ },
  isPackaged: false,
  requestSingleInstanceLock: () => true,
  quit: jest.fn(),
  whenReady: () => Promise.resolve(),
  _triggerReady: () => { /* trigger ready callback */ },
};

// ipcMain — main process IPC
const ipcMain = {
  handle: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
  _invoke: (channel, ...args) => { /* invoke handler */ },
};

// ipcRenderer — renderer process IPC
const ipcRenderer = {
  invoke: jest.fn(),
  send: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
};

// clipboard, globalShortcut, screen, dialog — stubs
```

**Configuration in `jest.config.js`:**

```javascript
module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^electron$': '<rootDir>/tests/mocks/electron.js',
    '^electron-updater$': '<rootDir>/tests/mocks/electron-updater.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'],
  testTimeout: 10000,
  // ... coverage thresholds
};
```

### Child Process Mocking

Each test file that needs sidecar simulation mocks `child_process.spawn()`:

```javascript
// tests/unit/main-ipc.test.js (lines 16-31)
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
  };
});
```

**Why PassThrough streams:**
- Allows tests to write to `stdin` and read from `stdout` asynchronously
- No real Python process is spawned
- Tests can simulate sidecar responses by pushing JSON lines to `stdout`

### File System Mocking

Tests mock `fs` to return real file operations (no sandbox issues) but fake venv checks:

```javascript
// tests/unit/main-ipc.test.js (lines 34-44)
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
```

**Why this pattern:**
- Tests use real filesystem (no jest.mock for all fs operations)
- Fakes the venv check so sidecar falls back to spawning Python directly (for tests)
- Tests create real temp directories for config storage

## Test Categories

### Unit Tests (399 tests)

**Location:** `tests/unit/` directory

**Coverage:**
- `main-ipc.test.js` (~350 tests) — Every IPC handler, error cases, sidecar protocol
- `preload.test.js` (~70 tests) — Field translation, API shim, event polling
- `sidecar.test.js` (~40 tests) — Sidecar lifecycle, JSON parsing, request/response
- `store.test.js` (~30 tests) — Settings read/write, atomic writes, fallback recovery
- `state-machine.test.js` (~30 tests) — State transitions, illegal moves
- `tray.test.js` (~25 tests) — Tray menu, balloons, icon updates
- `updater.test.js` (~10 tests) — Update channel selection
- `logger.test.js` (~5 tests) — Log filtering

**Pattern — IPC handler testing in `main-ipc.test.js`:**

```javascript
// Require main.js with mocks already in place
require('../../electron/main');

// Trigger app.whenReady to initialize store, sidecar, windows
app._triggerReady();

// Test an IPC handler via ipcMain._invoke()
test('save-settings merges with existing', async () => {
  const patch = { theme: 'light', hotkey: 'Ctrl+Shift+T' };
  const result = await ipcMain._invoke('save-settings', patch);
  expect(result.success).toBe(true);

  const settings = store.getSettings();
  expect(settings.theme).toBe('light');
  expect(settings.hotkey).toBe('Ctrl+Shift+T');
  expect(settings.autoPaste).toBe(true);  // unchanged
});
```

### Integration Tests (12 tests)

**Location:** `tests/integration/recording-flow.test.js` (342 lines)

**Scope:** End-to-end recording flow with realistic sidecar interaction

**Pattern — Recording flow with auto-responder:**

```javascript
// tests/integration/recording-flow.test.js

test('start → process → transcription → history update', async () => {
  // Start recording
  const startResult = await ipcMain._invoke('start-recording');
  expect(startResult.success).toBe(true);

  // Simulate sidecar processing event
  pushSidecarEvent(proc, 'processing', { stage: 'processing' });
  await tick(50);

  // Auto-respond to sidecar's stop_rec command
  const unsubscribe = autoRespondSidecar(proc, {
    stop_rec: { result: 'ok' }
  });

  // Stop recording (waits for sidecar transcription event)
  const stopResult = await ipcMain._invoke('stop-recording');

  // Simulate transcription response from sidecar
  pushSidecarEvent(proc, 'transcription', {
    text: 'hello world',
    language: 'en'
  });
  await tick(50);

  expect(stopResult.success).toBe(true);

  // Verify history was updated
  const history = store.getHistory();
  expect(history.length).toBeGreaterThan(0);
  expect(history[0].text).toBe('hello world');

  unsubscribe();
});
```

### E2E Tests (13 tests)

**Location:** `tests/e2e/app.e2e.test.js` (351 lines)

**Scope:** Full app startup with mock sidecar, window creation, tray

**Key difference from unit tests:** Spawns a mock sidecar process via `spawn()` (mocked) and fully initializes the app:

```javascript
// tests/e2e/app.e2e.test.js

test('app initializes and creates windows', async () => {
  // main.js is required with mocks in place
  require('../../electron/main');

  // Trigger app.whenReady
  app._triggerReady();

  // Verify main window was created
  expect(BrowserWindow._instances.length).toBeGreaterThan(0);

  // Verify sidecar was started
  const proc = spawn.mock.results[0].value;
  expect(proc.pid).toBe(12345);

  // Verify tray was created
  expect(Tray._instances.length).toBeGreaterThan(0);
});
```

### Stress Tests (70 tests)

**Location:** `tests/stress/stress.test.js` (1,887 lines)

**Scope:** System under load — concurrent IPC calls, rapid state transitions, memory stability

**Patterns:**

```javascript
// 1. Concurrent IPC calls (settings read/save while recording)
test('concurrent reads and writes', async () => {
  const promises = [];
  for (let i = 0; i < 50; i++) {
    promises.push(ipcMain._invoke('get-settings'));
    promises.push(ipcMain._invoke('save-settings', { theme: 'light' }));
  }
  const results = await Promise.all(promises);
  results.forEach(r => expect(r.success).toBe(true));
});

// 2. Rapid state transitions (start/stop/cancel spam)
test('rapid toggle spam', async () => {
  for (let i = 0; i < 100; i++) {
    const start = await ipcMain._invoke('start-recording');
    if (start.success) {
      const stop = await ipcMain._invoke('stop-recording');
      // or cancel
    }
  }
  const state = store.getState();
  expect(['dormant', 'recording', 'processing']).toContain(state);
});

// 3. Store contention (rapid history updates)
test('concurrent history mutations', async () => {
  const promises = [];
  for (let i = 0; i < 50; i++) {
    promises.push(
      ipcMain._invoke('add-history', { text: 'entry ' + i })
    );
  }
  await Promise.all(promises);
  const history = store.getHistory();
  expect(history.length).toBe(50);
});

// 4. Late transcription (stop-recording timeout edge case)
test('transcription arrives after timeout', async () => {
  // This tests the 120s timeout in stop-recording handler
});
```

## Key Testing Patterns

### Pattern 1: Auto-Responder for Sidecar Commands

**Helper function** in `main-ipc.test.js` (lines 72-89):

```javascript
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
```

**Usage:**
```javascript
const unsubscribe = autoRespondSidecar(proc, {
  list_models: { result: 'ok', models: ['base', 'small'] },
  download_model: { result: 'ok' },
});
// ... run tests ...
unsubscribe();
```

**Why this pattern:**
- Tests need to simulate sidecar responses without spawning real Python
- Each sidecar command has an `id` field; responses must match the `id`
- `setImmediate()` ensures responses are async, not synchronous
- Listeners are cleaned up after tests to avoid memory leaks

### Pattern 2: Pushing Sidecar Events

**Helper function** in `main-ipc.test.js` (lines 91-94):

```javascript
function pushSidecarEvent(proc, event, data = {}) {
  proc.stdout.push(JSON.stringify({ event, data }) + '\n');
}
```

**Usage:**
```javascript
pushSidecarEvent(proc, 'processing', { stage: 'processing' });
await tick(100);  // Wait for async handling

pushSidecarEvent(proc, 'transcription', {
  text: 'hello',
  language: 'en',
  timestamp: Date.now()
});
await tick(100);
```

**Why this pattern:**
- Sidecar sends event-style messages (no `id`, no response expected)
- Main process listens via `sidecar.on('event-name', handler)`
- Tests can simulate realistic sidecar events (processing, transcription, error)

### Pattern 3: Tick Helper for Async Processing

**Helper function** in `main-ipc.test.js` (lines 96-99):

```javascript
function tick(ms = 30) {
  return new Promise(r => setTimeout(r, ms));
}
```

**Usage:**
```javascript
pushSidecarEvent(proc, 'transcription', { text: 'hello' });
await tick(50);  // Give main process time to process the event

const history = store.getHistory();
expect(history[0].text).toBe('hello');
```

**Why this pattern:**
- Node.js event loop and Promise resolution are asynchronous
- Events pushed to mock streams don't immediately trigger handlers
- `tick()` gives the event loop a chance to process events
- `await tick(50)` is safer than `await tick(0)` (guarantees at least one full cycle)

### Pattern 4: Strict Auto-Responder

**Variant function** in `main-ipc.test.js` (lines 101-120):

```javascript
function autoRespondSidecarStrict(proc, commandResponses = {}) {
  const handler = (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        const cmd = msg.command;
        if (commandResponses[cmd]) {  // Only respond to known commands
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
```

**Difference from `autoRespondSidecar`:**
- `autoRespondSidecar` responds to ALL commands with `{ result: 'ok' }` by default
- `autoRespondSidecarStrict` only responds to commands in `commandResponses`, ignores others
- Use strict when you want to verify specific command handling without broad defaults

### Pattern 5: Setup/Teardown for Temp Dirs

**In each test file:**

```javascript
const realFs = jest.requireActual('fs');
const TEST_CONFIG_BASE = realFs.mkdtempSync(path.join(os.tmpdir(), 'wc-ipc-'));

beforeEach(() => {
  // Tests start fresh
});

afterEach(() => {
  // Clean up temp dir
  realFs.rmSync(TEST_CONFIG_BASE, { recursive: true, force: true });
});
```

**Why:** Each test should start with a clean config directory. Store reads/writes hit real filesystem via the mock.

## Coverage Thresholds

**Enforced by `jest.config.js`:**

```javascript
coverageThreshold: {
  global: {
    statements: 85,
    branches: 60,
    functions: 80,
    lines: 88,
  },
  './electron/store.js': {
    statements: 100,
    branches: 100,
  },
  './electron/sidecar.js': {
    statements: 100,
  },
  './electron/preload.js': {
    statements: 100,
  },
},
```

**Meaning:**
- **Global:** 85% of statements, 60% of branches, 80% of functions, 88% of lines must be covered
- **Critical modules:**
  - `store.js` (persistence) — 100% coverage required
  - `sidecar.js` (process management) — 100% coverage required
  - `preload.js` (security bridge) — 100% coverage required

**Checking coverage:**
```bash
npm test -- --coverage
```

Outputs coverage report in `coverage/` directory. Missing lines are highlighted.

## Test Execution

### Run All Tests
```bash
npm test
```
Runs Jest with `--forceExit` (terminates background timers after tests complete).

### Run Unit Tests Only
```bash
npm run test:unit
```
Runs `tests/unit/` directory only.

### Run Integration Tests Only
```bash
npm run test:integration
```
Runs `tests/integration/` directory only.

### Run E2E Tests Only
```bash
npm run test:e2e
```
Runs `tests/e2e/app.e2e.test.js` (expects Node environment).

### Check Coverage
```bash
npm test -- --coverage
```
Generates coverage report, exits with code 1 if thresholds not met.

## Adding New Tests

### For New IPC Handlers

1. Add handler test to `tests/unit/main-ipc.test.js`
2. Use `ipcMain._invoke(channel, ...args)` to call the handler
3. Verify return shape is `{ success: true }` or `{ success: false, error: ... }`
4. Test error cases (missing args, sidecar not running, etc.)

Example:
```javascript
test('new-handler validates input', async () => {
  const result = await ipcMain._invoke('new-handler', invalidInput);
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/invalid/i);
});
```

### For Sidecar Interactions

1. Use `autoRespondSidecar()` to mock sidecar responses
2. Use `pushSidecarEvent()` to simulate sidecar events
3. Use `await tick(50)` to give async handlers time to process
4. Test command/response matching and event ordering

Example:
```javascript
test('handler processes sidecar response', async () => {
  const cleanup = autoRespondSidecar(proc, {
    my_command: { result: 'ok', data: { count: 42 } }
  });

  const result = await ipcMain._invoke('my-handler');
  expect(result.success).toBe(true);
  expect(result.count).toBe(42);

  cleanup();
});
```

### For State Machine Transitions

1. Get the state machine instance from `main.js` exports or state
2. Verify transitions are legal
3. Test that illegal transitions are prevented

Example:
```javascript
test('cannot start recording if already recording', async () => {
  await ipcMain._invoke('start-recording');
  const result = await ipcMain._invoke('start-recording');  // Already running
  expect(result.success).toBe(false);
});
```

## Known Test Limitations

1. **No Chromium simulation** — Tests run in Node, not in the Chromium renderer. UI tests must use Playwright (not yet integrated into Jest suite).
2. **No file watching** — Tests don't verify fs.watch() for settings changes.
3. **No real Python sidecar** — All sidecar responses are mocked. Integration with real Python engine happens in E2E only.
4. **No hotkey testing** — Global hotkey registration is tested, but actual OS hotkey binding is mocked.
5. **No tray interaction** — Tray menu is built and tested, but click simulation requires system integration.

## Files Reference

- **`jest.config.js`** — Jest configuration, module mapper, coverage thresholds (643 bytes)
- **`tests/mocks/electron.js`** — Comprehensive Electron API mock (7.4K)
- **`tests/mocks/electron-updater.js`** — Auto-updater mock (566 bytes)
- **`tests/unit/main-ipc.test.js`** — IPC handlers, sidecar protocol, settings (1,875 lines)
- **`tests/unit/preload.test.js`** — Field translation, API shim (657 lines)
- **`tests/unit/sidecar.test.js`** — Process management, JSON protocol (379 lines)
- **`tests/unit/store.test.js`** — Persistence, atomic writes (329 lines)
- **`tests/unit/state-machine.test.js`** — State transitions (353 lines)
- **`tests/unit/tray.test.js`** — System tray (340 lines)
- **`tests/unit/updater.test.js`** — Auto-updater (199 lines)
- **`tests/unit/logger.test.js`** — Logging (129 lines)
- **`tests/integration/recording-flow.test.js`** — End-to-end recording (342 lines)
- **`tests/e2e/app.e2e.test.js`** — Full app startup (351 lines)
- **`tests/stress/stress.test.js`** — Concurrent operations, memory (1,887 lines)
- **`tests/helpers/test-utils.js`** — Shared helper functions (e.g., `createTempDir`)

