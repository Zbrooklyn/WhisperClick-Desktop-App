# WhisperClick Electron — Free Version Edge Case Audit

> Audit date: 2026-03-08

## TLDR: There is no free tier enforcement at all

The premium directories (`electron/premium/`, `src/frontend/premium/`) are empty placeholders with only README.md files. There is **zero** code anywhere that distinguishes free from premium, tracks usage, gates features, or validates licenses. Every feature is fully available to every user. The audit below covers all the gaps and edge cases this creates.

---

## 1. No Monetization Infrastructure Exists

| Missing | Impact |
|---------|--------|
| **No usage tracking** | No minute counter, transcription counter, word counter, or daily/weekly/monthly reset. Can't enforce limits. |
| **No license key storage** | `store.js` DEFAULT_SETTINGS has no `licenseKey`, `plan`, `tier`, or `activatedAt` field |
| **No license validation** | No Ed25519 verification, no server call, no cached token, no offline check |
| **No feature gating** | Every feature (translation, all models, all providers, export, audio playback, pill, auto-paste) is available |
| **No premium module loader** | ROADMAP P0 describes "dynamic `require()`, plugin registry, or conditional imports" — none exist |
| **No upgrade prompts** | No UI anywhere suggesting a premium version or showing an upgrade path |
| **No telemetry/analytics** | No way to know how many users you have, what they use, or where they hit limits |
| **No separate build pipeline** | One build produces one binary — no mechanism for free vs. premium variants |

---

## 2. No Incentive to Upgrade (Everything Is Free)

Looking at what competitors gate in their free tiers:

| Competitor | Free Limit | WhisperClick Equivalent |
|------------|-----------|------------------------|
| Wispr Flow | 2K words/week | **Unlimited** |
| Superwhisper | Small models only | **All 6 models** (tiny through large) |
| Otter.ai | 300 min/month | **Unlimited** |
| Descript | 1 hour free | **Unlimited** |

**Edge case:** When you eventually ship premium, existing free users already have everything. You'd have to *take features away*, which is much harder psychologically than never giving them in the first place.

---

## 3. Recording & Transcription Edge Cases

### No max recording length
- `AudioRecorder._buffer` is an unbounded list of numpy arrays
- A 1-hour recording at 16kHz mono float32 = ~230 MB of RAM, plus the wav conversion doubles it
- No warning, no soft cap, no hard cap
- **Risk:** OOM crash on long recordings, especially on your i7 with 16GB RAM running other apps

### No minimum recording duration
- A 0.1s accidental tap will send ~1,600 samples to the API
- OpenAI/Gemini will return garbage or empty text
- Creates a useless history entry with an audio file on disk
- **No guard in `engine.py` or `main.js`** — the stop handler always fires transcription

### OpenAI 25MB file size limit
- Long recordings get compressed to OGG/Opus (`_compress_audio`), but there's no size check
- If the compressed audio still exceeds 25MB (roughly 2+ hours), the API will reject it
- The error will be a generic "Transcription failed" — not a helpful "recording too long" message

### Translation uses a different model/endpoint
- Transcription uses `whisper-1` (or GPT-4o-transcribe), but translation uses `gpt-4o-mini` via chat completions
- These are **different billing categories** — a user on a tight OpenAI budget could be surprised
- No warning in the UI that "Both" mode makes two API calls

### Concurrent recording race
- `_recording` flag in `engine.py` is a plain bool — no mutex
- If two `start_rec` commands arrive on the same stdin line (unlikely but possible with fast hotkey double-press), both could pass the `if _recording` check before either sets `_recording = True`
- The main process does have an `appState` guard, but the toggle path through `executeJavaScript('triggerTrustedHotkeyToggle()')` is async

### API quota exhaustion
- If OpenAI returns 429 (rate limit), the error message is "OpenAI rate limit reached. Wait a moment and try again."
- But if the user's **credits are completely exhausted** (payment failed, free trial expired), the response might be 402 or 403 with a different body — not handled specifically
- Gemini free tier has RPD (requests per day) limits — the error message won't mention this

---

## 4. History Edge Cases

### ID collision
- History IDs are `Date.now().toString()` (`store.js:135`)
- If two transcriptions complete within the same millisecond (e.g., quick recording followed by sidecar restart), IDs collide
- `deleteHistory(id)` and `updateHistory(id, updates)` would affect the wrong entry

### Orphaned audio files
- `deleteHistory(id)` removes the JSON entry but **does not delete the associated audio file** on disk
- `clearHistory()` wipes all entries but **audio files remain** in `~/.config/whisperclick/audio/`
- The only cleanup is `_cleanup_expired_audio()` by retention period — if set to "forever" (0 days), files accumulate indefinitely
- A user who records 10 transcriptions/day for a year = ~3,650 OGG files on disk, never cleaned

### All 500 entries loaded at once
- `getHistory()` reads the entire JSON file and parses all 500 entries
- Frontend receives all 500 in one IPC call
- If entries contain long text (meeting transcriptions), this could be several MB of JSON
- No pagination, no lazy loading

### Audio file path stored as absolute
- History entries store `audio_file: "/Users/foo/.config/whisperclick/audio/123.ogg"`
- If the user moves their home directory, reinstalls to a different user, or the path changes, audio playback breaks silently
- The `get-audio` handler checks `fs.existsSync()` but returns a generic "Audio file not found" error

---

## 5. Settings Edge Cases

### Factory reset doesn't clean up runtime state
- `reset-settings` handler (`main.js:327`) calls `store.resetAll()` and closes the pill
- But it **does not**: re-register the hotkey (old hotkey stays active), reconfigure sidecar, update window always-on-top, update login item settings
- After reset, the hotkey is still the old one until the app restarts

### Factory reset during recording
- If a user triggers factory reset while recording, the appState is not reset
- The recording continues, sidecar still thinks it's recording, but settings are default
- Could cause state desync between frontend, main process, and sidecar

### Settings save race condition
- `save-settings` handler does `const prev = store.getSettings(); const settings = { ...prev, ...patch }; store.saveSettings(settings);`
- Two overlapping saves could cause one to overwrite the other
- Example: frontend saves theme change at the same moment tray menu toggles sound — one of the two changes could be lost
- No file locking or optimistic concurrency

### API keys fallback to environment variables
- `transcription.py:168`: `api_key = self._api_key or os.getenv("OPENAI_API_KEY", "")`
- `transcription.py:322`: same pattern for translation
- If a developer has `OPENAI_API_KEY` set from another tool, WhisperClick silently uses it
- The UI shows "no key configured" but transcription works — confusing

### `updateChannel` reset on factory reset
- Factory reset changes `updateChannel` back to default (empty string, which derives from version)
- A beta tester who factory-resets might get switched to stable channel unexpectedly

---

## 6. Window & UI Edge Cases

### Pill position not persisted
- Pill position is calculated from display workArea each time (`createPillWindow`)
- If a user drags the pill to their preferred position, it resets to bottom-center on next app launch
- No `pillX`/`pillY` in store settings

### Pill on disconnected display
- `createPillWindow` uses `screen.getPrimaryDisplay()` — always primary
- But `move-pill-to-display` moves it to an arbitrary display
- If that display is disconnected, the pill becomes invisible (off-screen)
- No recovery mechanism — user must re-enable pill from settings (main window)

### Main window size not persisted
- Window size is calculated as 22% of display width on each launch
- If a user resizes the window, it resets on next launch
- No `windowBounds` saved in store

### Pill visibility edge case: window hidden + pill disabled
- If main window is hidden (close-to-tray) AND pill is disabled, the user has **no visible UI**
- The only way to restore is clicking the tray icon
- If the tray icon is hidden by Windows (overflow area), the app appears "stuck"

---

## 7. Auto-Paste Edge Cases

### Target capture timing
- `capture_fg` captures the foreground window **before recording starts** (triggered by hotkey/pill)
- If the user switches apps during a 30-second recording, the paste goes to the **original** app, not the current one
- No way for the user to know or change the paste target

### `keybd_event` limitations
- `keybd_event` is Win32 legacy API — it doesn't work with:
  - Elevated (admin) processes (unless WhisperClick is also elevated)
  - Some UWP/WinUI3 apps
  - Remote desktop targets
  - Apps that use raw input
- No fallback mechanism, no error detection — the paste just silently fails

### macOS paste uses AppleScript
- `exec('osascript -e ...')` — spawns a child process for each paste
- If macOS has restricted automation permissions, the keystroke fails silently
- No permission request or error feedback

### No paste for Linux
- `simulatePaste()` only handles `win32` and `darwin`
- Linux users get no auto-paste at all, but the setting toggle still shows in the UI

---

## 8. Security / Circumvention Edge Cases

### No build-time code integrity
- All code is unobfuscated JS + Python source
- `preload.js`, `main.js`, `store.js` can be trivially edited in-place
- Any future license check in these files can be patched out with a text editor

### Store is plain JSON
- `settings.json` is human-readable (API keys are encrypted, but all other fields are plain)
- A hypothetical `isPremium: true` flag could be manually set
- No signed settings file, no HMAC, no integrity verification

### Sidecar is replaceable
- The Python engine has no signing or integrity check
- `WHISPERCLICK_ENGINE_PATH` env var lets anyone point to a modified sidecar
- A cracked version could simply set this env var to bypass any engine-side checks

### Gemini API key in URL query parameter
- `engine.py:275`: `url = f"{base_url}/models/{model}:generateContent?key={api_key}"`
- `engine.py:522`: `url = f"{base_url}/models?key={encoded_key}"`
- Standard for Google APIs, but keys in URLs can appear in logs, error traces, and crash reports
- The code does redact keys in error messages (`safe_body = error_body[:300].replace(api_key, "***")`), but only in some paths

---

## 9. Sidecar / Engine Edge Cases

### Engine log grows unbounded
- `engine.py:29`: `sys.stderr = open(os.path.join(_log_dir, "engine.log"), "a")`
- Opened in append mode, never rotated
- Heavy usage over months could create a multi-MB log file
- No log rotation, no size cap

### No resource check before model download
- Downloading the "large" model (3GB) doesn't check available disk space
- Loading it doesn't check available RAM (~5GB needed per FEATURES.md)
- Failure would be a cryptic `MemoryError` or OS kill, not a helpful message

### Sidecar restart doesn't notify user
- On crash + restart, `broadcastError('Backend crashed — recording lost')` fires
- But the 3-second error toast may not be visible if the main window is hidden
- The pill gets the error but its tooltip auto-hides
- After 3 failed restarts, the permanent "Backend failed to start — restart the app" message appears — but again only as a 3-second toast

### `list_mics` during recording
- `AudioRecorder.list_devices()` calls `sd.query_devices()` while an `InputStream` is active
- On some audio backends (WASAPI exclusive mode), this can cause the active stream to stutter
- No guard in the engine or main process

---

## 10. Update Edge Cases

### No downgrade path
- If a premium build breaks something, there's no way to go back to the free version cleanly
- electron-updater only goes forward
- Settings from a premium build may contain fields the free version doesn't understand (currently handled by spread + defaults, but fragile)

### No update verification
- Downloaded updates are verified by electron-updater's built-in signature check
- But without code signing (Phase F2), this signature check is effectively self-signed
- A MITM on the update URL could push a malicious binary

---

## 11. Cross-Platform Edge Cases

### Linux has no auto-paste
Already mentioned above — `simulatePaste()` has no Linux branch.

### macOS: no sidecar binary path for dev
- `sidecar.js:36`: looks for `venv/Scripts/python.exe` (Windows path)
- On macOS dev, the path would be `venv/bin/python` — this is not handled
- Works in production (bundled binary) but dev testing on Mac would fail

### Windows: `keybd_event` UIPI
- On Windows, `keybd_event` from a non-elevated process cannot send to an elevated one
- If a user is typing in an admin terminal and stops recording, the paste silently fails

---

## Summary: Top 10 Most Impactful Edge Cases to Address

| # | Edge Case | Severity | Why |
|---|-----------|----------|-----|
| 1 | **No usage tracking infrastructure** | Critical | Can't monetize without it. Must decide free limits before premium launch. |
| 2 | **No max recording length** | High | OOM crash on long recordings, API file size rejection |
| 3 | **Orphaned audio files on delete/clear** | Medium | Silent disk space leak, never cleaned if retention = forever |
| 4 | **No minimum recording duration guard** | Medium | Accidental taps waste API calls and create junk history |
| 5 | **Factory reset doesn't reset runtime state** | Medium | Hotkey, sidecar config, always-on-top desync after reset |
| 6 | **Settings save race condition** | Medium | Overlapping saves can lose changes |
| 7 | **Pill position not persisted** | Low | Annoying UX — user drags pill every session |
| 8 | **Auto-paste targets wrong app** | Low | Common enough scenario during longer recordings |
| 9 | **Engine log grows unbounded** | Low | Disk space over months of heavy use |
| 10 | **History ID collision** | Low | Rare but can corrupt data when it happens |
