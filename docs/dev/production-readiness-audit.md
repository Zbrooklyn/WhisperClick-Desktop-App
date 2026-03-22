# Production Readiness Audit — WhisperClick Electron

> Created: 2026-03-22
> Context: After completing 5-phase state machine refactor (correctness), this audit
> identifies remaining reliability and efficiency gaps before the app is truly
> production-ready on Electron.

## What's Been Fixed (State Management — Correctness)

- State desync bugs eliminated via formal state machine
- Single source of truth — `sm.state` in main process is the only authority
- All entry points gated through `canAcceptAction()`
- 538 tests including 78 torture scenarios covering every abuse pattern
- Sidecar auto-recovery on stale recording state
- Pill is a dumb terminal — zero local state
- Frontend derives all UI from state-update events
- Event-driven transitions with timer fallbacks

## What Hasn't Been Addressed

### 1. Startup

**1a. Cold start time**
- How long from double-click to ready? We've never measured it.
- Electron loads Chromium + Node.js runtime. Python sidecar spawns separately.
- User sees nothing until the main window renders. The sidecar takes additional
  seconds to initialize (Python import time + model loading for local mode).
- No splash screen, no loading indicator during startup.

**1b. Memory footprint at launch**
- Electron + Chromium + Node + Python sidecar = 4+ processes before the user does anything.
- On a 16GB machine (i7-1065G7) this may be fine, but on 8GB machines it could be noticeable.
- We've never measured baseline memory usage at idle.

**1c. Startup with corrupt settings**
- If `settings.json` is corrupted (power loss mid-write, disk error), does the app crash or
  recover gracefully?
- The `Store` class may throw on JSON.parse of a corrupt file.
- No validation/recovery logic for malformed settings.

**1d. Single-instance lock race with installed version**
- Hit this multiple times during development — installed WhisperClick grabs the lock,
  dev instance silently exits with no error message.
- In production: if the user tries to open a second instance, they get no feedback.
  The second instance just dies silently. Should show a "WhisperClick is already running"
  message or focus the existing window.

### 2. Memory During Use

**2a. Recording session memory leaks**
- Do audio buffers get freed after each recording?
- The sidecar uses `sounddevice` for capture — does the Python process grow over time?
- IPC listeners: the `stop-recording` handler registers `once()` listeners on every stop.
  The stress test checks for listener leaks (50 cycles), but we've never profiled actual
  renderer memory.

**2b. History DOM node accumulation**
- History grows to 500 entries. When entries are added, are old DOM nodes cleaned up
  or just scrolled off-screen?
- The frontend renders history as HTML elements. 500 entries with audio visualizers
  could be significant DOM weight.

**2c. Renderer memory**
- The 4800-line inline JS file loads entirely into one renderer process.
- No code splitting, no lazy loading, no dynamic imports.
- All settings panels, history UI, visualizer, onboarding — all loaded at startup
  whether needed or not.

**2d. Pill window overhead**
- The pill is a separate BrowserWindow = separate Chromium renderer process.
- It's tiny (424 lines) but still a full renderer with its own V8 isolate.
- Always running when pill is visible, even when doing nothing.

### 3. Background/Idle Behavior

**3a. CPU usage when idle**
- Should be near zero when sitting in system tray, but is it?
- Any `setInterval` or `setTimeout` that keeps running when the app is idle?
- The auto-updater check, any polling loops, animation frames.

**3b. Idle timers and wake prevention**
- The fallback timers (1.5s success, 3s error, 6s enter button) only fire after
  active use, not continuously. Good.
- But are there any timers from other parts of the code (visualizer, onboarding,
  settings debounce) that tick continuously?

**3c. Sidecar idle memory**
- The Python sidecar process sits in memory doing nothing when not recording.
- It imports `sounddevice`, `numpy`, and potentially `faster-whisper` (torch) for
  local mode — these imports alone can be 100-200MB.
- The sidecar has no "sleep" or "unload" mode.

**3d. Auto-updater polling**
- `checkForUpdatesQuietly()` is called 10 seconds after startup.
- How often does it re-check? If it polls every few minutes, that's network + CPU
  activity in the background.

### 4. Sidecar Reliability

**4a. No heartbeat mechanism**
- If the sidecar process hangs (not crashes — hangs), the main process has no way
  to detect it until the 120-second transcription timeout fires.
- A hung sidecar means: recording appears to work (state says recording), the user
  stops, processing spinner appears, then 120 seconds of nothing before timeout.
- This is the biggest single reliability gap in the app.

**4b. Zombie processes after crash**
- When the sidecar crashes and restarts (up to 3 times), does the old process
  always get cleaned up?
- On Windows, `process.kill()` may not always terminate cleanly.
- On Linux/macOS, signal handling differs — SIGTERM vs SIGKILL.
- We've never verified that no zombie Python processes accumulate over time.

**4c. Stdin/stdout buffer overflow**
- The sidecar communicates via JSON over stdin/stdout.
- During recording, `broadcastLevel` sends level updates throttled to every 50ms.
- Rapid level updates + transcription responses + error messages could back up the
  stdout buffer if the main process is busy.
- No flow control or backpressure mechanism.

**4d. Python import size for local mode**
- `faster-whisper` pulls in torch/ctranslate2 — these add 200-500MB to the
  process memory.
- Even if the user is using API mode, the imports may still happen at sidecar
  startup (lazy vs eager import).
- The PyInstaller bundle for production includes everything.

### 5. Disk/IO

**5a. Audio file cleanup**
- History entries reference audio files. When entries are deleted (clear history,
  capacity truncation at 500), are the corresponding audio files deleted?
- Over time, orphaned audio files could accumulate and consume significant disk space.

**5b. Settings write atomicity**
- If the app is killed or power is lost during a settings save, is the file corrupted?
- Current implementation: `fs.writeFileSync()` — overwrites the file in place.
- Atomic write pattern: write to temp file, then rename. We're not doing this.
- Corruption means: settings lost, API keys lost, user has to reconfigure.

**5c. Log file management**
- Log rotation works (5MB cap, renames to `.1`).
- But only keeps 1 rotated file. If the user enables debug logging long-term,
  the log file is capped at 10MB total (current + rotated).
- Is the rotated file ever deleted? Only on next rotation.

**5d. History file size**
- 500 entries with text, metadata, and audio file paths.
- The JSON file itself shouldn't be large, but audio files on disk could be.
- No configurable retention policy — it's always 500 entries.

### 6. Battery/Power

**6a. Two processes always running**
- Electron main + renderer + GPU + utility + Python sidecar.
- On a laptop (user's machine is i7-1065G7, 15.7GB RAM), this matters for battery.
- No "low power mode" that could suspend the sidecar when not needed.

**6b. Recording level polling**
- During recording, the sidecar sends audio level updates.
- `broadcastLevel` is throttled to one update per 50ms = 20 updates/second.
- Each update triggers: main process handler → renderer IPC → pill IPC → DOM update.
- That's 40 IPC messages/second + 20 DOM updates in main window + 20 in pill.

**6c. Visualizer animation**
- The audio visualizer in the main window uses `requestAnimationFrame` or
  `setInterval` during recording.
- Is it stopped when the window is hidden/minimized?
- If not, it's burning CPU on invisible animations.

### 7. Security

**7a. API keys in memory**
- API keys are encrypted on disk via `safeStorage`, but they exist in plaintext in
  the Node.js process memory while the app is running.
- A memory dump could expose them.
- This is standard for Electron apps but worth noting.

**7b. No CSP (Content Security Policy)**
- The main window and pill window may not have strict CSP headers.
- Without CSP, XSS in a loaded page could access Node.js APIs (mitigated by
  contextIsolation, but defense-in-depth is better).

**7c. Preload script surface area**
- The main window preload exposes ~40 methods via `window.pywebview.api`.
- Each is an attack surface if XSS is achieved.
- The pill preload is minimal (4 methods) — good.

---

## Phased Plan

### Phase R1 — Measure (don't fix, just measure)

Establish baselines. No code changes. Just data.

1. **Startup time**: Measure cold start (app launch to `did-finish-load` event)
2. **Memory baseline**: Task Manager snapshot at idle after startup (all processes)
3. **Memory after 10 recordings**: Same snapshot after 10 record/transcribe cycles
4. **CPU at idle**: 5-minute CPU observation with app in tray doing nothing
5. **CPU during recording**: CPU observation during a 30-second recording
6. **Sidecar memory**: Python process memory at idle and during recording
7. **Audio file disk usage**: Total disk space used by audio files after 50 recordings
8. **History file size**: Size of history.json at 500 entries

**Deliverable**: `docs/dev/baseline-measurements.md` with numbers

### Phase R2 — Critical Reliability Fixes

Fix the issues most likely to cause user-facing problems.

1. **Sidecar heartbeat**: Main sends ping every 5s, sidecar responds with pong.
   If 3 pings are missed, declare sidecar hung and restart it. This closes the
   biggest reliability gap.
2. **Settings write atomicity**: Write to `.tmp` file, then rename over the original.
   Prevents corruption from power loss or crash.
3. **Corrupt settings recovery**: Wrap `JSON.parse` in try/catch. If settings file
   is corrupt, back it up and start fresh with defaults. Log a warning.
4. **Audio file cleanup**: When history entries are deleted (clear, truncation),
   delete the corresponding audio files from disk.
5. **Silent second-instance handling**: When single-instance lock fails, show a
   notification or focus the existing window instead of silently exiting.

**Deliverable**: Code changes + tests for each fix

### Phase R3 — Efficiency Improvements

Reduce resource usage for battery-constrained users.

1. **Sidecar lazy imports**: In API mode, don't import torch/faster-whisper.
   Only import heavy local-mode dependencies when local mode is activated.
2. **Visualizer pause when hidden**: Stop animation frames when main window is
   hidden or minimized. Resume on show.
3. **Level broadcast reduction**: Reduce from 20/s to 10/s during recording.
   Human perception of audio level animation doesn't need 50ms updates.
4. **Auto-updater interval**: Verify the check interval. If it's frequent,
   reduce to once per hour or on-demand.
5. **Idle sidecar suspension**: After 5 minutes of no recording, send sidecar
   a "sleep" command to release audio device handles and reduce memory.

**Deliverable**: Measurable reduction in CPU/memory from Phase R1 baselines

### Phase R4 — Hardening

Defense-in-depth and long-term reliability.

1. **CSP headers**: Add strict Content-Security-Policy to both windows.
2. **Zombie process cleanup**: On app quit, enumerate and kill any orphaned
   Python processes. On startup, check for stale sidecar processes.
3. **Memory leak detection**: Add a periodic (every 5 min) memory usage log
   entry. If memory grows >50% from baseline, log a warning.
4. **Configurable history retention**: Let users set max entries (100/250/500)
   and max audio retention (7d/30d/forever).
5. **Startup performance**: Defer non-critical initialization (history load,
   auto-updater, pill creation) until after the main window renders.

**Deliverable**: Hardened app with monitoring, ready for code signing

---

## Priority Justification

| Phase | Why this order |
|-------|---------------|
| R1 (Measure) | Can't fix what you can't see. Baselines first. |
| R2 (Reliability) | Sidecar hang + settings corruption = data loss risk. Fix before efficiency. |
| R3 (Efficiency) | Battery/CPU matters for a desktop app that runs all day. |
| R4 (Hardening) | Defense-in-depth after correctness + reliability + efficiency are solid. |

---

## Relationship to Existing Work

| Concern | Status |
|---------|--------|
| State management correctness | DONE — Phases 1-5 of state machine refactor |
| State abuse resilience | DONE — 78 torture tests |
| Code signing | TRACKED in ROADMAP.md Phase F2 (separate from this audit) |
| Premium features | TRACKED in ROADMAP.md (separate from this audit) |
| Linux CI test failures | TRACKED in ROADMAP.md Phase F1 |

---

*Document created: 2026-03-22*
*Next action: Phase R1 (Measure) — establish baselines before fixing anything*
