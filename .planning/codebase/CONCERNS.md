# Technical Concerns — WhisperClick Electron

> Analyzed 2026-03-20
>
> This document catalogs technical debt, known issues, fragile areas, and architectural risks in the WhisperClick Electron codebase. See `HANDOFF.md` (Known Issues + Next Steps sections), `CHANGELOG.md` (recent bug fixes), and `docs/dev/state-machine-refactor.md` (planned refactoring).

---

## Critical Architectural Debt

### 1. Implicit State Machine — 15+ Transition Points, No Validation

**Severity**: High | **Scope**: `electron/main.js`

The app state is a single string variable (`appState`) set from 15+ locations with **zero transition validation**. This has caused a pattern of recurring state bugs:

| Bug | Root Cause | Fixed In |
|-----|-----------|----------|
| Cancel button not working during processing | 900ms debounce blocked cancel | v2.1.2 |
| "Already recording" after transcription | `success` treated as active | v2.1.1 |
| Pill widget disappearing | Broadcasts to destroyed windows | v2.1.0 |
| Phantom clock on window reopen | No state sync on show | v2.1.0 |
| App state stuck on `success` | Dormant timer skipped in button mode | v2.1.0 |
| Dormant overriding enter button | 1.5s timer broadcasting over state | v2.1.0 |

**Why this matters**: Each fix adds another guard or special case (reconciliation on window show, 5s polling, dormant override checks, isDestroyed guards). Complexity increases each time, making new bugs likely.

**Code reference**: `electron/main.js` lines 29–30 (state declaration), 183–189 (setAppState), 175–202 (broadcastState)

**Solution planned**: 5-phase state machine refactor in `feature/state-machine` branch (Phase 1 in progress). See `docs/dev/state-machine-refactor.md` for design.

---

### 2. Three Independent State Trackers — Reconciliation Overhead

**Severity**: High | **Scope**: Main process + Frontend + Pill

Three separate state variables can disagree:

| System | Variable(s) | Type | Source |
|--------|-----------|------|--------|
| **Main process** | `appState` | string | IPC handler results, sidecar events, hotkey |
| **Frontend (index.html)** | `isRecording`, `isProcessing` | boolean flags | V3 JS event handlers |
| **Pill (pill.html)** | `currentState` | string | state-update event from main |

**Problems:**
- Frontend and pill are never guaranteed to match main process
- Reconciliation mechanisms required:
  - `broadcastState()` on window show/restore (main → frontend/pill)
  - 5s polling from pill (resyncs if broadcasts missed)
  - Manual dormant overrides (pill ignoring timer-driven dormant)
  - `isDestroyed()` guards (pill can vanish mid-broadcast)

**Code references**:
- Main: `electron/main.js` lines 29 (state), 191–202 (broadcast)
- Frontend: `src/frontend/index.html` lines ~1800–1900 (isRecording/isProcessing initialization and updates)
- Pill: `src/pill/pill.html` lines ~200–300 (currentState tracking)

**Future state**: Phase 4 of refactor removes frontend boolean flags entirely. Pill becomes dumb terminal (Phase 3).

---

### 3. Five Overlapping Debounce/Guard Layers — Unpredictable Interactions

**Severity**: Medium | **Scope**: `electron/main.js`, state transitions

Five independent guard mechanisms with unclear interaction:

1. **`nextAllowedToggleAt`** — 900ms after stop, blocks new recording
2. **`lastToggleInvocationAt`** — 160ms between toggle invocations
3. **`lastToggleEventStamp`** — Deduplicate same event
4. **`HOTKEY_DEBOUNCE_MS`** (300ms) — Hotkey re-fire protection
5. **Sidecar `_recording` flag** — Python-side recording state guard

**Why this is fragile**: Cancel button was blocked by the recording debounce (v2.1.2 bug). Guards interact in ways the code doesn't document. No single place validates "can accept action X now?"

**Solution planned**: Phase 2 of state machine refactor replaces all 5 with single `canAcceptAction()` function.

---

## Performance & Scale Concerns

### 4. Monolithic Frontend — 5,103 Lines of Inline HTML/JS/CSS

**Severity**: Medium | **Scope**: `src/frontend/index.html`

The entire V3 frontend is in one file: HTML, CSS, and JS all inline (no bundler, no code splitting).

**Metrics:**
- **5,103 total lines** in `src/frontend/index.html`
- **~4,800+ lines of inline `<script>`** (all frontend logic)
- **~150 lines of inline `<style>`** (Tailwind CSS pre-built)
- **Lucide icon library** bundled in (`js/lucide.min.js`, ~200KB)

**Issues:**
- No tree-shaking — all code loads on startup
- No lazy loading — features load whether used or not
- No code splitting — can't prioritize critical paths
- Hard to test in isolation (integrated test only)
- Difficult to refactor (touching one feature requires full reload)

**Why kept this way**: V3 was pywebview-based (no bundler complexity). Electron port reuses V3 frontend verbatim for pixel-perfect parity and to avoid rewrite.

**Code reference**: `src/frontend/index.html` (all 5,103 lines)

---

### 5. No Code Splitting — Startup and Memory Trade-off

**Severity**: Low | **Scope**: Electron builder config

The app loads V3's entire frontend on startup. No lazy loading, no dynamic imports, no route-based code splitting.

**Impact:**
- Startup time includes parsing ~5,000 lines of JS
- All features initialized regardless of usage (settings drawer, hotkey handlers, history UI, etc.)
- Memory includes all DOM elements (hidden via CSS, but parsed)

**Alternative considered**: Bundle with Vite/esbuild + code splitting, but that would require rewriting V3's frontend from scratch, breaking pixel-perfect parity guarantee.

---

## Known CI/Test Failures

### 6. Three Cross-Platform Test Failures on Linux CI

**Severity**: Medium | **Scope**: `.github/workflows/build.yml` line 23

**Current workaround**: `continue-on-error: true` — tests run but don't block release.

**What's failing**: 3 tests fail specifically on Linux CI (pass on Windows), likely due to:
- Platform-specific Electron API behavior (window positioning, display enumeration, etc.)
- Missing Linux system dependencies (e.g., audio libraries in Docker image)
- Timing issues specific to CI environment (no GPU, limited resources)

**Code reference**: `.github/workflows/build.yml` line 21–24 (test step with continue-on-error)

**Next step**: Identify and fix platform-specific test failures (see `HANDOFF.md` > Next Steps #2). Once fixed, remove `continue-on-error: true`.

---

### 7. Flaky Hotkey Test — Global Shortcut Registration on CI

**Severity**: Low | **Scope**: `tests/unit/main-ipc.test.js` (hotkey-related tests)

Global hotkey registration (`globalShortcut.register`) can be flaky on CI environments due to:
- No physical keyboard
- Window manager restrictions
- Timing races in mock

**Impact**: Occasional CI failures on hotkey-related tests. Not blocking (continue-on-error handles it), but should be made deterministic.

---

## Settings & Configuration

### 8. Settings Translation Layer — Snake_case ↔ camelCase Mapping

**Severity**: Low | **Scope**: `electron/preload.js`, `HANDOFF.md` lines 87–107

V3 frontend uses `snake_case` settings names; Electron store uses `camelCase`. Preload translates both directions.

**Mapping table** in `HANDOFF.md` lines 87–107 documents all 18 conversions.

**Fragility**: If someone adds a new setting to V3 frontend but forgets to add it to the translation map, it silently fails (not saved). No validation layer catches missing mappings.

**Code reference**: `electron/preload.js` (patchToElectron / toV3Format functions)

**Risk**: Low, since settings are rarely added. But untested gaps are possible.

---

## Security & Data Integrity

### 9. API Keys Encrypted via safeStorage — Minimal Verification

**Severity**: Low | **Scope**: `electron/store.js`, settings save/load

API keys in settings are encrypted by Electron's `safeStorage` API on Windows/macOS. Legacy plaintext keys auto-migrate.

**What's verified**: Encryption/decryption works. Plaintext keys don't stay in memory after save.

**What's NOT verified**:
- Attack surface (if Electron's safeStorage is compromised, keys are exposed)
- Backup/restore scenarios (corrupted `settings.json.bak` during atomic write)
- Multi-user Windows scenarios (could another user's process decrypt keys?)

**Code reference**: `electron/store.js` (saveSettings, getSettings, decryptValue)

**Mitigation**: This is standard Electron practice. Keys are safer here than in localStorage (web) or plaintext (V3). Accept this as baseline security.

---

### 10. Atomic Settings Writes — Fallback to .bak Prevents Data Loss

**Severity**: Low | **Scope**: `electron/store.js`

Settings are written atomically: write to `.tmp`, then rename to target. `.bak` file kept for recovery.

**What works**: Crash during write leaves `.tmp` file (ignored) and `.bak` intact. Next load falls back to `.bak`.

**Edge case not tested**: Corrupted `.bak` file (e.g., truncated during previous write). Current code falls back to `.bak` then defaults, which masks the corruption. User might lose settings history.

**Code reference**: `electron/store.js` (saveSettings method)

**Impact**: Very low. Corruption of both primary and backup files simultaneously is rare.

---

## Fragile Areas & Edge Cases

### 11. Sidecar Communication — JSON-over-stdin/stdout Without Framing

**Severity**: Medium | **Scope**: `electron/sidecar.js`, `engine/engine.py`

Sidecar communication is JSON messages, one per line, on stdin/stdout. No framing, no checksums, no keep-alives.

**Fragility points:**
- If Python crashes, stdout stream dies mid-message → parser gets partial JSON → silent drop
- If Electron crashes mid-send, Python sees incomplete JSON line
- No heartbeat — can't detect hung sidecar
- No message ordering guarantees — concurrent commands might race

**Current mitigations:**
- Sidecar auto-restarts on crash (max 3 attempts, backoff delay)
- Recording handler has 120s timeout (gives up if no transcription event)
- Error events from sidecar show tooltip

**Code references**:
- Electron: `electron/sidecar.js` (spawn, stdin/stdout handlers, message parsing)
- Python: `engine/engine.py` (print-based response format)

**Not addressed**: Detecting hung sidecar mid-operation (would require heartbeat mechanism).

---

### 12. Pill Click-Through & Mouse Events — Complex Re-entrancy

**Severity**: Low | **Scope**: `electron/main.js` (pill window creation), `src/pill/pill.html` (mouse handlers)

The pill window is transparent, click-through by default (`setIgnoreMouseEvents(true, { forward: true })`). When mouse enters visible content, click-through is disabled (`setIgnoreMouseEvents(false)`).

**Current implementation**:
- Capsule element has `mouseover` / `mouseleave` handlers
- `mouseover` → calls `pillWindow.setIgnoreMouseEvents(false)` → pill captures clicks
- `mouseleave` → calls `pillWindow.setIgnoreMouseEvents(true, { forward: true })` → clicks pass through

**Edge cases**:
- If pill is repositioned while hovered, mouse position might be stale → miss leave event
- Rapid show/hide of pill could cause click events to target wrong window
- Multi-monitor scenarios: pill might reposition off-screen if primary display changes

**Code references**:
- Main: `electron/main.js` lines 100–110 (showPillOnPrimaryDisplay)
- Pill: `src/pill/pill.html` (capsule mouseover/mouseleave handlers)

**Status**: Works in practice, but edge cases are untested.

---

### 13. State Transitions with Timers — Race Condition Windows

**Severity**: Medium | **Scope**: `electron/main.js` (timer-based transitions)

State transitions use timers to auto-advance state (e.g., `success` → `dormant` after 1.5–6s). During this window, state doesn't match what user sees.

**Examples:**
- Transcription happens, state → `success`, timer set for 1.5s. User clicks Record during this 1.5s window. Frontend doesn't know state is `success`, so it tries to start recording → "already recording" error (fixed in v2.1.1, but timer still exists).
- Timer fires but main process is blocked → state advances late → UI and pill show stale state briefly.

**Current mitigation**: Phase 5 of state machine refactor replaces timers with event-driven transitions (UI explicitly ACKs success, then main transitions to dormant). Fallback timer kept as safety net (10s, not 1.5s).

**Code reference**: `electron/main.js` (all setTimeout calls related to state transitions, ~lines 250–400)

---

### 14. Recording Flow Hotkey → Frontend Routing — Desync Risk

**Severity**: Low | **Scope**: `electron/main.js` (hotkey handler), `src/frontend/index.html` (recording start/stop logic)

Hotkey flow: Global hotkey → `executeJavaScript('triggerTrustedHotkeyToggle()')` → Frontend JS handles validation + calls `start_recording()` / `stop_recording()`.

**Why risky**: Frontend has its own state (`isRecording`, `isProcessing`). If hotkey routes through frontend but main process state is already different, desync occurs.

**Fixed in v2.0.19** by forwarding `state-update` event to frontend so it stays in sync. But the routing pattern is still complex.

**Code references**:
- Main: `electron/main.js` lines ~700–800 (hotkey handler)
- Frontend: `src/frontend/index.html` lines ~1900–2000 (triggerTrustedHotkeyToggle)

---

## Untested Scenarios

### 15. Recording Flow End-to-End — Requires Live Mic + API Key

**Severity**: Medium | **Scope**: Recording, transcription, history save

Full recording flow is **untested without a microphone and API key** (OpenAI, Anthropic, or local model):

1. Recording start → audio capture
2. Recording stop → sidecar processes audio
3. Transcription received → history saved + auto-paste
4. Visualizer animation during recording
5. Audio playback from history

**Why**: Tests are mocked (fake sidecar), so they verify IPC handlers work but not real audio/transcription.

**Verification**: Needs manual testing with:
- Windows audio input device (mic)
- OpenAI API key (or local Whisper model)
- Actual recording session
- Check history saves correctly
- Check paste works
- Check visualizer animates

**Code reference**: `tests/` (all tests are mocked sidecar)

**Next step**: Live testing checklist in `HANDOFF.md` line 47–51.

---

### 16. Auto-Paste Edge Cases — Not Fully Tested

**Severity**: Low | **Scope**: `electron/main.js` (auto-paste on transcription), sidecar (text output)

Auto-paste writes transcription text to clipboard and simulates Ctrl+V. Edge cases:

- Clipboard contains non-text data (images, rich text) → paste might insert garbage
- App focus lost during paste window → Ctrl+V goes to wrong window
- Clipboard manager apps interfere
- Text contains control characters (newlines, tabs, null bytes)

**Current handling**: Text is filtered (basic), paste happens immediately after transcription. No clipboard format validation.

**Code reference**: `electron/main.js` (transcription event handler, clipboard.writeText + autoEnter logic)

---

### 17. Free Version Edge Cases — No Feature Gating or Usage Tracking

**Severity**: Medium | **Scope**: None yet (see `docs/dev/free-version-edge-case-audit.md`)

The free version has no limits enforced:
- No max recording length
- No usage quota
- No feature gating (all features available)
- No orphaned audio cleanup (old recordings kept indefinitely)

**If shipped as free tier**: Users could abuse (record infinitely, max out disk space, etc.).

**Current status**: Not in scope for current version (v2.1.1 stable). Documented as gap for future.

**Code reference**: `docs/dev/free-version-edge-case-audit.md` (identifies specific edge cases)

**Next step**: Implement free tier enforcement before shipping free version.

---

## Missing Windows Integration

### 18. No Code Signing — SmartScreen & Gatekeeper Warnings

**Severity**: Low | **Scope**: Electron builder config, Windows/macOS deployment

Binaries are not code-signed. Result:
- **Windows**: SmartScreen warns "Windows protected your PC" (requires "More info" → "Run anyway")
- **macOS**: Gatekeeper warns "Cannot verify developer" (requires `xattr -d com.apple.quarantine` or system prefs allow)

**Why not signed**: Code signing requires certificates (cost $200/year for Windows, free for macOS via xcode). Not critical for open-source project, but hurts user trust.

**Status**: Known issue, not blocking. See `HANDOFF.md` > Next Steps #3.

---

### 19. No SmartScreen / Gatekeeper Certificate

**Severity**: Low | **Scope**: CI/CD, installer distribution

Similar to #18. Signing would require:
- Windows: EV code signing certificate ($200–400/year)
- macOS: Apple Developer account ($99/year) + notarization

**Current workaround**: User runs unsigned installer anyway, dismisses warnings.

---

## Documentation & Knowledge Gaps

### 20. State Machine Implicit in Code — No Formal Spec

**Severity**: Low | **Scope**: Architecture documentation

Valid state transitions are only in code (setAppState guards, broadcastState checks, timer logic). No formal diagram or state machine definition.

**Result**: New developers have to infer state graph from code. Easy to miss valid transitions or introduce invalid ones.

**Addressed by**: `docs/dev/state-machine-refactor.md` (Phase 1 creates formal state machine module with transition validation).

---

### 21. Settings Translation Map Not Validated

**Severity**: Low | **Scope**: `electron/preload.js`

Translation map (snake_case ↔ camelCase) is hard-coded. No validation that all V3 settings fields have Electron equivalents.

**If a new setting is added to V3 frontend**: Must manually add it to preload translation. Forgetting is silent failure.

**Better approach**: Auto-generate translation map or require explicit registration with validation.

**Code reference**: `electron/preload.js` (patchToElectron / toV3Format)

---

## Summary Table

| # | Concern | Severity | Status | Mitigation / Next Step |
|---|---------|----------|--------|------------------------|
| 1 | Implicit state machine | High | Known, planned | State machine refactor (Phase 1 in progress) |
| 2 | Three independent state trackers | High | Known, planned | Phases 3–4 of state machine refactor |
| 3 | Five debounce layers | Medium | Known, planned | Phase 2 of state machine refactor |
| 4 | Monolithic 5,103-line frontend | Medium | Known, accepted | Rewrite would break pixel-perfect parity with V3 |
| 5 | No code splitting | Low | Known, accepted | Accepted trade-off for simplicity |
| 6 | Linux CI test failures | Medium | Known, workaround | Fix platform-specific test failures (#2 in Next Steps) |
| 7 | Flaky hotkey test | Low | Known, low priority | Part of CI test fix |
| 8 | Settings translation layer | Low | Known, working | No validation, but rarely add settings |
| 9 | API key encryption | Low | Known, accepted | Using Electron safeStorage (baseline security) |
| 10 | Atomic settings writes | Low | Known, working | .bak fallback prevents data loss |
| 11 | Sidecar JSON-over-stdin | Medium | Known, working | 120s timeout + auto-restart. No heartbeat. |
| 12 | Pill click-through complexity | Low | Known, working | Works in practice, untested edge cases |
| 13 | State transitions with timers | Medium | Known, planned | Phase 5 of state machine refactor |
| 14 | Hotkey routing through frontend | Low | Known, working | Fixed in v2.0.19 with state-update forwarding |
| 15 | Recording flow untested | Medium | Known | Needs live testing with mic + API key |
| 16 | Auto-paste edge cases | Low | Known | Basic filtering, edge cases untested |
| 17 | No free tier enforcement | Medium | Known, out of scope | Document in edge case audit |
| 18 | No code signing | Low | Known, accepted | Cost/benefit not justified for open-source |
| 19 | No SmartScreen/Gatekeeper cert | Low | Known, accepted | Same as #18 |
| 20 | State machine not formalized | Low | Known, planned | State machine refactor Phase 1 |
| 21 | Settings translation not validated | Low | Known, acceptable | No validation layer, rarely changes |

---

## Risk Assessment by Category

### Critical Path (Recording + Transcription)
- **Recording flow**: Untested without live mic/API key (#15)
- **State machine**: 6 documented state bugs fixed (#1–3, 13)
- **Auto-paste**: Edge cases not tested (#16)

### Architecture
- **State management**: Implicit machine, three trackers, five guards (#1–3)
- **Frontend monolith**: 5,103 lines, hard to refactor (#4–5)
- **Settings translation**: No validation, silent failures possible (#8, 21)

### Testing & CI
- **Linux CI failures**: 3 tests fail on CI, continue-on-error workaround (#6)
- **Hotkey flakiness**: Global shortcut registration flaky on CI (#7)
- **Live testing gaps**: Recording, visualizer, playback untested (#15)

### Security & Data
- **API key encryption**: Using safeStorage (accepted) (#9)
- **Atomic writes**: .bak fallback prevents loss (#10)
- **Free tier**: No enforcement (documented gap) (#17)

---

## Recommended Priority for Fixes

**Phase 1 (Unblock Future Development)**
1. State machine refactor (`feature/state-machine`, Phase 1 in progress)
2. Fix Linux CI test failures (#6)
3. Formalize settings translation validation (#21)

**Phase 2 (Polish & Stability)**
4. Live testing of recording flow (#15)
5. Audit and fix auto-paste edge cases (#16)
6. Remove timer-based state transitions (#13, Phase 5 of refactor)

**Phase 3 (Nice-to-Have)**
7. Code splitting / lazy loading (#5)
8. Code signing for Windows/macOS (#18–19)
9. Free tier enforcement (#17)

---

## Files to Watch

| File | Why | Concern # |
|------|-----|-----------|
| `electron/main.js` | State machine, transitions, broadcast logic | 1–3, 11, 13 |
| `src/frontend/index.html` | Monolithic inline code, state tracking | 2, 4 |
| `src/pill/pill.html` | Click-through complexity, state tracking | 2, 12 |
| `electron/preload.js` | Settings translation, API shim | 8, 21 |
| `electron/sidecar.js` | JSON protocol fragility, auto-restart | 11 |
| `electron/store.js` | Atomic writes, encryption, API key storage | 9–10 |
| `docs/dev/state-machine-refactor.md` | Planned architecture overhaul | 1–3, 13 |
| `.github/workflows/build.yml` | CI test failures, continue-on-error | 6–7 |
| `tests/unit/main-ipc.test.js` | Test coverage, CI flakiness | 6–7, 15 |

---

**Last updated**: 2026-03-20
**Next review**: After state machine refactor Phase 1 completion
