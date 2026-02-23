# WhisperClick V3 — Testing Strategy

## Why This Approach

WhisperClick is a **pywebview desktop app** — the frontend (HTML/JS) communicates with the Python backend through a native bridge (`window.pywebview.api`). This architecture means:

- **Browser-based tools (Playwright, Selenium) can't test the full app.** Opening `index.html` in a browser gives you a dead UI — no settings, no history, no recording, no microphones. The native bridge doesn't exist outside pywebview.
- **The backend IS the app.** Every user action flows through `src/backend/api.py`. If the backend API works, the app works. The frontend is a thin UI layer on top.
- **pywinauto can verify the window exists** but can't interact with pywebview's internal DOM. It sees the window as a single opaque control.

So the testing strategy is:

1. **Direct backend API testing** — import and call every function, verify contracts
2. **Unit testing** — exercise individual modules (recorder, transcription, config, models)
3. **Edge case + stress testing** — invalid inputs, rapid state changes, boundary conditions
4. **pywinauto window verification** — confirm the app launched and is visible
5. **Manual UI testing** — user-driven checklist for visual/interaction verification

---

## Test Tools

### `tools/v3_full_test.py` — Comprehensive Test Suite (89 tests)

The primary test suite. Tests every backend API function, unit tests each module, runs edge cases, and verifies the UI window via pywinauto.

**What it tests:**

| Section | Tests | What's Covered |
|---------|-------|----------------|
| 1. Settings | 7 | get/save roundtrip, required keys, close behavior, empty dict, key preservation |
| 2. Models | 6 | list, expected entries, required fields, set valid/invalid, download progress |
| 3. Microphones | 4 | list, field structure, set valid device, set invalid device |
| 4. Languages | 6 | list, auto-detect exists, English exists, set/get roundtrip |
| 5. History | 11 | CRUD cycle, append/delete/clear, empty text, XSS content, fake ID |
| 6. Clipboard | 4 | normal text, empty string, special chars, unicode |
| 7. Recording | 7 | start, audio level range, cancel, level after cancel, stop+transcribe |
| 8. API Keys | 7 | get all, get per provider, unknown provider, verify dummy/empty key |
| 9. Transcription | 6 | mode switching, model switching, language switching, cancel flow |
| 10. Audio Recorder | 12 | device list, initial state, record cycle, WAV output, duration |
| 11. Config | 5 | load, dir exists, files exist, save+reload roundtrip |
| 12. Model Manager | 5 | model info, size field, downloaded check, downloaded list |
| 13. Edge Cases | 7 | None values, unknown keys, mode switching, rapid start/cancel x3 |
| 14. UI Window | 2 | window visible, title correct |
| **Total** | **89** | |

**How to run:**

```bash
# App must be running first
cd "WhisperClick V3"
python src/main.py &

# Then run the test suite
python tools/v3_full_test.py
```

Or if using V2's venv (no local venv):

```bash
../whisper-stt-v2/venv/Scripts/python.exe tools/v3_full_test.py
```

**Output format:**

```
  PASS  get_settings returns dict
  PASS  settings has all required keys
  FAIL  some_test -> AssertionError: expected X got Y

  Total:  89
  Passed: 89
  Failed: 0
  Warns:  0
```

Exit code 0 = all passed, 1 = failures exist.

**Key design decisions:**

- Tests are **non-destructive** — history items created during testing are deleted afterward
- Tests are **idempotent** — running twice produces the same result
- Each test is a single lambda or function — failures are isolated and don't cascade
- XSS payloads are tested as input data to verify they're handled safely
- Rapid start/cancel stress test catches race conditions in the recording pipeline
- Audio recorder unit tests run independently from the API layer

---

### `tools/full_smoke_test.py` — Smoke Test Harness (9 tests + manual checklist)

The original V2 smoke test, updated for V3. Lighter than `v3_full_test.py` — intended for quick validation after builds.

**What it tests:**

1. Backend API can be imported and instantiated
2. `get_settings()` returns all required keys
3. `save_settings()` roundtrip with hotkey
4. `get_models()` returns all expected model names
5. `get_microphones()` returns list, set first device
6. `get_history()` returns list
7. `copy_to_clipboard()` works
8. Headed window launch — spawns the app process, waits for visible window via pywinauto
9. Window rectangle has non-zero dimensions

**How to run:**

```bash
python tools/full_smoke_test.py --timeout 25
```

**Output:** JSON report with `automated_passed`, `automated_failed`, and `manual_checklist`.

**Note:** This test launches its own app process. Don't run it while the app is already running (single-instance lock will prevent the second launch).

---

### `tools/ui_smoke_test.py` — UI Visibility Test

Minimal headed test that only checks:

1. App process can be launched
2. Window titled "WhisperClick" becomes visible within timeout
3. Optional screenshot capture

**How to run:**

```bash
python tools/ui_smoke_test.py --timeout 20 --screenshot
```

Screenshots saved to `tmp/ui-smoke-{timestamp}.png`.

---

## Venv Resolution

All test scripts support two venv locations:

1. **Local:** `WhisperClick V3/venv/Scripts/python.exe` (preferred)
2. **Fallback:** `whisper-stt-v2/venv/Scripts/python.exe` (sibling project)

The fallback allows testing V3 before setting up its own venv.

---

## What Each Layer Tests

```
┌─────────────────────────────────────────────┐
│           Manual UI Testing                  │
│  (user clicks, visual verification)          │
├─────────────────────────────────────────────┤
│         pywinauto Window Check               │
│  (window visible, title correct, dimensions) │
├─────────────────────────────────────────────┤
│        Backend API Integration Tests         │
│  (every api.method() called + verified)      │
├─────────────────────────────────────────────┤
│          Module Unit Tests                   │
│  (AudioRecorder, TranscriptionService,       │
│   config, models — independent of Api)       │
├─────────────────────────────────────────────┤
│        Edge Case & Stress Tests              │
│  (invalid input, rapid cycles, XSS payloads) │
└─────────────────────────────────────────────┘
```

### What automated tests CAN verify

- Every backend function returns the expected type and shape
- Settings, history, and config round-trip correctly through disk persistence
- Audio recording starts, produces data, and stops cleanly
- API key verification correctly rejects invalid keys
- Invalid inputs (bad model names, fake device IDs, empty strings) don't crash
- Rapid start/cancel cycles don't leave the app in a stuck state
- The app window is visible and has the correct title
- XSS payloads in history text don't break storage or retrieval

### What automated tests CANNOT verify

- Visual correctness (CSS rendering, layout, animations)
- Transcription quality (accuracy of speech-to-text output)
- Sound playback (tones play at correct times, correct volume)
- Hotkey behavior across focused/minimized/hidden window states
- Pill widget visual states (dormant/hover/recording animations)
- Tray icon appearance and menu interactions
- Installer/portable packaging on clean machines
- Real API provider behavior (OpenAI/Gemini with valid keys)

These require the **manual checklist** below.

---

## Manual Test Checklist

Run after all automated tests pass. Requires microphone, display, and optionally a valid API key.

### Core Recording

- [ ] Local mode: record a short phrase, verify transcript appears in history
- [ ] Local mode: record 30+ seconds, verify no memory spike or UI freeze
- [ ] API mode (OpenAI): record, verify transcript in history
- [ ] API mode (Gemini): record, verify transcript in history
- [ ] Translation mode: record, verify transcript + translation sections
- [ ] Cancel during recording: timer resets to 00:00, no stuck state
- [ ] Cancel during processing: returns to idle cleanly

### History

- [ ] Search: type query, cards filter in real-time
- [ ] Search: clear query, all cards return
- [ ] Search: no results shows "No results found" message
- [ ] Click history card: detail modal opens with full text
- [ ] Export TXT: downloads file with correct content
- [ ] Copy text: clipboard contains transcript
- [ ] Delete card: removed from list and persisted
- [ ] Clear all: confirmation dialog, then empty state

### Settings

- [ ] Mode toggle (Local/API) persists across restart
- [ ] Model selector shows only downloaded models as usable
- [ ] Language picker changes transcription language
- [ ] Hotkey capture: record combo, save, verify works globally
- [ ] Sound toggle: tones play/mute correctly
- [ ] Always-on-top: window stays above others when enabled
- [ ] Close behavior: "tray" minimizes to tray, "quit" exits
- [ ] Start-with-Windows: registry entry created/removed
- [ ] Theme toggle: persists across restart

### API Keys

- [ ] Paste valid OpenAI key: shows "Verified"
- [ ] Paste invalid key: shows "Invalid"
- [ ] Paste valid Gemini key: shows "Verified"
- [ ] Keys persist across app restart (keyring storage)

### Tray

- [ ] Tray icon visible when minimized to tray
- [ ] Show: brings window to front
- [ ] Record: starts recording from tray
- [ ] Settings: opens window with settings visible
- [ ] Quit: exits app, no ghost tray icon

### Pill Widget

- [ ] Enable in settings, minimize: pill appears
- [ ] Click pill: starts recording
- [ ] Stop button: stops and transcribes
- [ ] Cancel (X): cancels recording
- [ ] Right-click: context menu works (show, paste, settings, hide)
- [ ] Audio visualizer: bars animate during recording

### Edge Cases

- [ ] Unplug microphone during recording: no crash, shows error
- [ ] Switch microphone while recording: recording restarts on new device
- [ ] Close window during processing: app minimizes to tray, processing continues
- [ ] Rapid click record/stop: no stuck state or duplicate transcripts

---

## Adding New Tests

To add a test to `v3_full_test.py`:

```python
test("descriptive name", lambda: some_assertion_that_returns_truthy)
```

For tests that need setup/teardown:

```python
def my_complex_test():
    # setup
    api.append_history_item("test data")
    try:
        # verify
        assert len(api.get_history()) > 0
        return True
    finally:
        # cleanup
        api.delete_history(api.get_history()[0]["id"])

test("my complex test", my_complex_test)
```

Group related tests under a `section("Title")` call.

---

## CI Integration

The test suite can be integrated into CI with:

```yaml
- name: Run WhisperClick V3 tests
  run: |
    cd projects/WhisperClick\ V3
    python src/main.py &
    sleep 5
    python tools/v3_full_test.py
    kill %1
```

Note: `full_smoke_test.py` and `ui_smoke_test.py` require a headed desktop session (they launch the app and check for a visible window). They will fail in headless CI environments.

`v3_full_test.py` sections 1-13 work headless (backend-only). Section 14 (pywinauto window check) requires a headed session but gracefully skips if pywinauto is unavailable.

---

*Last updated: 2026-02-19*
