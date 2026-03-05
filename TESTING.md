# Testing — WhisperClick Electron

## Quick Start

```bash
npm test                  # All unit + integration tests (261 tests, ~5s)
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only
npm run test:e2e          # E2E tests (13 tests, launches mock sidecar)
npm test -- --coverage    # Coverage report + threshold enforcement
```

## Test Architecture

```
tests/
  mocks/
    electron.js           # Mock for require('electron') — all Electron APIs
    mock-sidecar.py       # Mock Python engine for E2E tests
  helpers/
    test-utils.js         # Temp dir, pollUntil helper
  unit/
    store.test.js         # 34 tests — atomic writes, encryption, history
    sidecar.test.js       # 23 tests — JSON protocol, timeouts, lifecycle
    tray.test.js          # 12 tests — PNG generation, state colors
    preload.test.js       # 78 tests — API translation maps, key routing
    main-ipc.test.js      # 102 tests — all IPC handlers, state machine, callbacks
  integration/
    recording-flow.test.js # 12 tests — state transitions, sidecar restart
  e2e/
    app.e2e.test.js       # 13 tests — mock sidecar JSON protocol
```

**Total: 261 Jest + 13 E2E = 274 tests**

## Coverage Summary

| File | Statements | Branches | Lines |
|------|-----------|----------|-------|
| **main.js** | 91% | 72% | 94% |
| **store.js** | 100% | 100% | 100% |
| **sidecar.js** | 100% | 87% | 100% |
| **preload.js** | 100% | 98% | 100% |
| **tray.js** | 94% | 71% | 96% |
| **Overall** | 93% | 75% | 95% |

## Coverage Thresholds (enforced in jest.config.js)

If any of these drop, `npm test -- --coverage` fails:

| Scope | Statements | Branches | Functions | Lines |
|-------|-----------|----------|-----------|-------|
| Global | 85% | 60% | 80% | 88% |
| store.js | 100% | 100% | — | — |
| sidecar.js | 100% | — | — | — |
| preload.js | 100% | — | — | — |

## What's Tested

### main.js (102 tests in main-ipc.test.js)

- **All 20+ IPC handlers** — success and error paths
- **Settings side effects** — theme, alwaysOnTop, autoStart, hotkey re-registration
- **Close-to-tray** — `closeBehavior=tray` hides window, `closeBehavior=quit` allows close
- **Hotkey + toggleRecording** — routes through mainWindow JS; falls back to direct toggle when window destroyed; full dormant→recording→processing cycle
- **Pill lifecycle** — showPill toggle creates/destroys pill window; toggle-pill handler
- **Pill-context-menu click handlers** — Start Recording, Show WhisperClick, Settings, Hide Pill
- **Tray callbacks** — onShow, onStartStop, onSettings, onQuit
- **Sidecar events** — transcription (with history + autoPaste), translation, error, cancelled, level, download progress
- **configureSidecar field completeness** — verifies all 10 configure fields with correct values including API key selection (gemini vs openai)
- **Translation autoPaste** — translation event copies translated text to clipboard when autoPaste is enabled
- **Broadcasts reach pillWindow** — state-update and level-update events forwarded to pill window
- **Sidecar restart backoff** — 3 restarts with increasing delay (1s/2s/3s), stops after max
- **Sidecar not running guards** — all proxy handlers return errors when sidecar is dead
- **State recovery** — error→dormant after 3s, success→dormant after 1.5s
- **Export transcription** — dialog cancel + successful file write
- **Audio playback** — missing entry, missing file, successful base64 encoding

## What's NOT Tested (and why)

### Can't test in Jest — wrong tool

| Code | Lines | Reason |
|------|-------|--------|
| Single instance lock | 10-11 | Requires launching two real Electron processes. Would need a separate E2E test with two `electron .` spawns. Low risk — uses Electron's built-in `requestSingleInstanceLock()`. |
| `simulatePaste()` macOS | 584-586 | Platform-specific AppleScript execution. Can't test on Windows. Would need macOS CI runner. |
| `second-instance` event | 593-596 | Requires two real Electron processes. Same limitation as single instance lock. |
| `will-quit` event | 747-749 | App lifecycle event from Electron. Our mock's `app.on` captures the callback but triggering it properly requires the real Electron event loop. |
| `window-all-closed` | 754-756 | Platform-specific behavior (`process.platform !== 'darwin'`). Requires real Electron lifecycle. |

### `toggleRecording()` fallback paths — same pattern, 3 call sites

Lines 255, 496, 614 are the same code: `else { toggleRecording(); }`. This fallback fires when `mainWindow` is destroyed and a recording toggle is requested from the pill-toggle-recording handler (255), pill-context-menu Start Recording click (496), or tray onStartStop callback (614). The `mainWindow` branch is tested at all 3 sites. The `toggleRecording()` fallback is tested through the hotkey handler (same exact pattern, same function call). Testing the fallback at every call site would require destroying mainWindow mid-test which breaks subsequent tests.

### Marginal value — catch blocks and trivially correct code

| Code | Lines | Reason |
|------|-------|--------|
| `mainWindow.on('closed', () => { mainWindow = null })` | 67-69 | One-line null assignment. Tested indirectly through showPill toggle test which relies on this working. |
| `registerHotkey` catch block | 146-148 | Returns false on exception. Only fires if Electron's `globalShortcut.register` throws, which our mock doesn't simulate. |
| `stop-recording` 120s timeout | 363-365 | Would require a 120s test or extremely careful fake timer manipulation while sidecar events are also using timers. |
| `get-audio` generic catch | 432 | Catches unexpected fs errors (permissions, disk failure). The specific fs errors (missing file, missing entry) are tested. |
| `sidecar.start()` initial catch | 742 | Catches spawn failure on app startup. Would need to make `spawn()` throw, which breaks all other tests that depend on the sidecar starting. |
| `updateTrayMenu` (tray.js) | 105-106 | Placeholder function — code comment says "for now this is a placeholder". Does nothing. |

## How the Mock Works

`tests/mocks/electron.js` intercepts `require('electron')` via Jest's `moduleNameMapper`. Key patterns:

- **BrowserWindow._instances** — tracks all created windows for assertion
- **Tray._instances** — tracks tray instances for accessing context menu
- **ipcMain._invoke(channel, ...args)** — calls registered handlers directly
- **globalShortcut._shortcuts** — stores hotkey callbacks for direct invocation
- **mainWin._listeners['close']** — stores event handlers for testing close-to-tray
- **safeStorage** — encrypt/decrypt with `encrypted:` prefix

## Adding New Tests

1. For new IPC handlers: add to `main-ipc.test.js`, call via `ipcMain._invoke('channel', args)`
2. For sidecar events: use `pushSidecarEvent(proc, 'event-name', { data })` + `await tick(50)`
3. For sidecar command responses: use `autoRespondSidecar(proc, { command: { result: 'ok' } })`
4. For state-dependent tests: push a sidecar event to set desired state first
5. **Order matters**: sidecar-killing tests must stay at the end of main-ipc.test.js
