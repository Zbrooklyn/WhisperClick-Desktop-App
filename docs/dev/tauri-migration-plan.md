# Tauri Migration Plan — WhisperClick

> Created: 2026-03-22
> Context: After completing state machine refactor on Electron (v2.2.0-beta),
> evaluating Tauri as the next platform for production-ready lightweight builds.
> This document captures the full analysis, phased plan, and lessons learned.

---

## Why Migrate

WhisperClick on Electron idles at **715 MB RAM** with an **~80 MB installer**.
For a voice-to-text utility that runs in the background all day, this is too heavy.
Users expect utilities to be invisible — low memory, fast startup, small install.

Tauri uses the OS native WebView (WebView2 on Windows, WebKit on macOS/Linux)
instead of bundling Chromium. This cuts memory by ~90% and installer size by ~90%.

| Metric | Electron (current) | Tauri (target) |
|--------|-------------------|----------------|
| RAM at idle | 715 MB | ~40-60 MB |
| Installer size | ~80 MB | ~5-10 MB |
| Cold startup | 3.0s | <1s (no Chromium boot) |
| Processes | 5 (main + 4 Chromium) + Python | 1 (Tauri) + WebView + Python |
| Bundle includes | Full Chromium + Node.js | Nothing — uses OS WebView |

## What We Keep

These components transfer directly — no rewrite needed:

- **`src/frontend/index.html`** — The 4800-line frontend renders in any WebView. Tauri
  loads it the same way Electron does. Tailwind CSS, Lucide icons, inline JS — all work.
- **`src/pill/pill.html`** — Self-contained pill widget. Tauri supports multiple windows
  with transparency. Needs testing but architecturally sound.
- **`engine/engine.py`** — Python sidecar is a child process. Tauri has a sidecar plugin
  (`tauri-plugin-shell`) that manages child processes. Stdin/stdout JSON protocol unchanged.
- **State machine architecture** — The formal state machine, single input gate, stateless
  pill pattern, event-driven transitions — all transfer to Rust. Same design, different language.
- **All 78 torture test scenarios** — The test patterns transfer even if the test framework
  changes. The scenarios themselves are the valuable part.
- **Design documents** — Post-mortem, production readiness audit, design doc all remain relevant.

## What We Rewrite

| Electron Component | Lines | Tauri Equivalent | Effort |
|-------------------|-------|------------------|--------|
| `electron/main.js` (IPC, windows, tray, hotkey) | ~1300 | Rust Tauri commands | High |
| `electron/state-machine.js` | 171 | Rust state machine | Low |
| `electron/store.js` | ~250 | `tauri-plugin-store` or Rust JSON | Low |
| `electron/sidecar.js` | ~300 | `tauri-plugin-shell` sidecar | Medium |
| `electron/tray.js` | ~100 | Tauri system tray API | Low |
| `electron/updater.js` | ~150 | `tauri-plugin-updater` | Low |
| `electron/logger.js` | ~110 | Rust `log` crate + `env_logger` | Low |
| `electron/preload.js` | ~340 | Tauri `invoke()` + JS bridge | Medium |
| `electron/preload-pill.js` | 13 | Tauri `invoke()` in pill | Low |
| Tests (538 total) | ~6000 | Rust tests + JS integration tests | High |

**Total rewrite: ~2700 lines of Node.js → ~2000 lines of Rust + ~500 lines of JS bridge**

## Alternative Frameworks Evaluated

| Framework | RAM | Installer | Language | Pros | Cons |
|-----------|-----|-----------|----------|------|------|
| **Tauri** | ~40 MB | ~8 MB | Rust + JS | Native WebView, tiny, fast, active community | Rust learning curve |
| **Neutralino** | ~20 MB | ~3 MB | JS only | Lightest option | Limited multi-window, no system tray plugin maturity |
| **Wails** | ~40 MB | ~8 MB | Go + JS | Similar to Tauri, Go is easier than Rust | Smaller ecosystem, less mature |
| **Flutter** | ~60 MB | ~15 MB | Dart | Cross-platform UI | Full rewrite, no HTML reuse |
| **Electron (optimized)** | ~550 MB | ~80 MB | JS | No rewrite needed | Still heavy, lipstick on a pig |

**Decision: Tauri** — best balance of lightweight + HTML reuse + mature ecosystem.

## Architecture Comparison

### Current (Electron)

```
Electron Main Process (Node.js)
  ├─ state-machine.js (StateMachine class)
  ├─ main.js (IPC handlers, canAcceptAction gate)
  ├─ sidecar.js (Python child process manager)
  ├─ store.js (JSON file persistence)
  ├─ tray.js (system tray)
  ├─ updater.js (electron-updater)
  └─ logger.js (file + console logging)

Chromium Renderer #1 (preload.js → index.html)
  └─ window.pywebview.api.* → ipcRenderer.invoke()

Chromium Renderer #2 (preload-pill.js → pill.html)
  └─ window.electronAPI.* → ipcRenderer.invoke()

Python Sidecar (engine.py)
  └─ stdin/stdout JSON protocol
```

### Target (Tauri)

```
Tauri Core (Rust)
  ├─ state_machine.rs (StateMachine struct)
  ├─ commands.rs (Tauri command handlers — replaces IPC)
  ├─ gate.rs (can_accept_action — single input gate)
  ├─ sidecar.rs (Python child process via tauri-plugin-shell)
  ├─ store.rs (tauri-plugin-store or custom JSON)
  ├─ tray.rs (system tray via Tauri API)
  ├─ updater.rs (tauri-plugin-updater)
  └─ logger.rs (log crate)

OS WebView #1 (bridge.js → index.html)
  └─ window.__TAURI__.invoke('command', args)

OS WebView #2 (pill-bridge.js → pill.html)
  └─ window.__TAURI__.invoke('command', args)

Python Sidecar (engine.py) — UNCHANGED
  └─ stdin/stdout JSON protocol
```

### Key Difference

Electron: 5 processes (main + GPU + utility + 2 renderers) + Python sidecar
Tauri: 1 process (Rust) + OS WebView (shared, not bundled) + Python sidecar

The OS WebView is a system component — it's already in memory for other apps.
WhisperClick doesn't pay the cost of loading its own browser engine.

## Phased Migration Plan

### Phase T0 — Preparation (before writing any Rust)

**Goal:** Set up Tauri project, verify HTML frontend loads, prove the concept works.

1. Install Rust toolchain + Tauri CLI
2. Create new Tauri project alongside Electron (`tauri/` directory or separate repo)
3. Point Tauri at `src/frontend/index.html` — verify it renders correctly
4. Point Tauri at `src/pill/pill.html` — verify transparent pill window works
5. Test multi-window support (main + pill simultaneously)
6. Test WebView2 on Windows, WebKit on macOS
7. Measure baseline: RAM, startup time, installer size with empty app

**Exit criteria:** Both windows render identically to Electron. Pill transparency works.
**Estimated time:** 1-2 days

### Phase T1 — JS Bridge (replace preload.js)

**Goal:** Frontend can call Tauri commands instead of `window.pywebview.api`.

1. Create `bridge.js` that maps `window.pywebview.api.*` → `window.__TAURI__.invoke()`
2. Same translation layer (snake_case → camelCase) as current preload
3. Frontend code unchanged — bridge is a drop-in replacement for preload
4. Create `pill-bridge.js` for pill (4 methods: onRender, click, setIgnoreMouse, showContextMenu)
5. Stub all Tauri commands to return mock data — frontend should fully load

**Exit criteria:** Frontend loads, settings panel opens, history displays (with mock data).
**Estimated time:** 2-3 days

### Phase T2 — Core Rust Backend

**Goal:** State machine + settings store + basic IPC working.

1. Implement `StateMachine` struct in Rust (port from state-machine.js)
2. Implement `can_accept_action()` gate in Rust (port from canAcceptAction)
3. Implement JSON store (settings read/write/encrypt)
4. Wire up Tauri commands: `get-settings`, `save-settings`, `get-state`, `ack-state`
5. Wire up window management commands: minimize, maximize, close
6. Test: settings save/load cycle, state transitions, gate validation

**Exit criteria:** Settings persist across restart. State machine validates all transitions.
**Estimated time:** 3-5 days

### Phase T3 — Python Sidecar Integration

**Goal:** Recording works end-to-end through Tauri.

1. Use `tauri-plugin-shell` to spawn Python sidecar
2. Implement stdin/stdout JSON protocol in Rust (port from sidecar.js)
3. Wire up recording commands: start-recording, stop-recording, cancel-processing
4. Wire up sidecar proxy commands: list-models, download-model, list-mics, verify-api-key
5. Implement sidecar crash detection + restart (3 attempts with backoff)
6. Test: full recording flow — start → stop → transcribe → paste

**Exit criteria:** Can record, transcribe, and auto-paste. Sidecar crash recovery works.
**Estimated time:** 3-5 days

### Phase T4 — System Integration

**Goal:** Tray, hotkey, updater, pill all working.

1. System tray with icon + context menu (Tauri tray API)
2. Global hotkey registration (Tauri global shortcut or `tauri-plugin-global-shortcut`)
3. Pill window: render payloads, click forwarding, click-through, repositioning
4. Auto-updater (tauri-plugin-updater — GitHub releases)
5. Clipboard + auto-paste (Tauri clipboard API + key simulation)
6. Auto-enter mode (keystroke simulation)
7. Test: all entry points (hotkey, pill, tray, tray menu) through the gate

**Exit criteria:** Feature parity with Electron version. All entry points work.
**Estimated time:** 5-7 days

### Phase T5 — Testing & Verification

**Goal:** Equivalent test coverage to Electron version.

1. Port state machine unit tests to Rust (48 tests)
2. Write Rust integration tests for commands (equivalent to main-ipc.test.js)
3. Write torture tests in Rust (state×action matrix, rapid clicks, crash recovery)
4. Manual testing: all 10 live test scenarios from the merge plan
5. Memory/CPU profiling: verify <60 MB idle, <1s startup
6. Cross-platform testing: Windows, macOS, Linux

**Exit criteria:** All tests pass. Memory/startup targets met. Feature parity verified.
**Estimated time:** 5-7 days

### Phase T6 — Migration & Release

**Goal:** Ship Tauri version to users.

1. Beta release (v3.0.0-beta) alongside Electron v2.x
2. Auto-updater migration path (Electron → Tauri requires reinstall, not auto-update)
3. Update website, README, documentation
4. Monitor crash reports and user feedback
5. When stable: promote to v3.0.0, archive Electron version

**Exit criteria:** Stable Tauri release shipping to all users.
**Estimated time:** 3-5 days

### Total Estimated Timeline: 3-5 weeks

---

## Lessons Learned — Applied to Migration

These lessons come from the state machine refactor (v2.1.0-v2.2.0) post-mortem
and must be applied to the Tauri migration to avoid repeating the same mistakes.

### L1: Validate Against the Spec, Not Your Mental Model

**What happened:** Claimed Phase 2 was done with 3 of 5 debounce layers untouched.
Validated against what was built, not against the design doc.

**Applied to migration:** Every phase has explicit exit criteria. Before claiming a phase
is done, check every exit criterion with evidence. "Does the pill render?" requires a
screenshot. "Does settings persist?" requires a restart test. No mental-model validation.

### L2: Check Current State Before Planning Changes

**What happened:** GSD planned a 7-task Phase 3 for work that was already done.
Nobody checked `pill.html` before spawning the planner.

**Applied to migration:** Before starting each phase, verify what already exists. Tauri
plugins may already handle things we're planning to build. Check the plugin ecosystem
first. Run `cargo doc` and read what's available.

### L3: Frameworks Are Tools, Not Processes

**What happened:** GSD added hours of ceremony (mapping, init, requirements, roadmap,
planning, verification, revision) for work that took 20 minutes direct.

**Applied to migration:** Use GSD only for phases where context rot is a real risk
(T3 sidecar integration, T4 system integration). For straightforward ports (T1 bridge,
T2 state machine), just do it directly.

### L4: Restart Is Not a Fix

**What happened:** When the user reported "already recording," the first response was
to kill and relaunch instead of investigating the root cause.

**Applied to migration:** When something doesn't work in Tauri, investigate immediately.
Read Tauri logs, check WebView console, inspect Rust panics. Don't restart and hope.

### L5: Understand Tests Before Changing Them

**What happened:** Bulk find-and-replace on stress tests created 28 new failures because
each test tested something specific that the replacement broke.

**Applied to migration:** Port tests one at a time. Understand what each test verifies
before translating it to Rust. Some Electron-specific tests won't apply to Tauri — that's
fine, document why they're dropped.

### L6: Timer-Based Transitions Are Fragile

**What happened:** 6 bugs in v2.1.0-v2.1.2 from setTimeout-based state transitions
creating windows where state was wrong.

**Applied to migration:** The Tauri version should use the event-driven pattern from
Phase 5 (ack-state) from day one. No timer-based state transitions as primary mechanism.
Rust's ownership model makes it easier to enforce this — the state machine owns state,
nothing else can mutate it.

### L7: Single Source of Truth Eliminates a Category of Bugs

**What happened:** Three independent state trackers (main process, frontend, pill)
caused every state desync bug.

**Applied to migration:** Rust state machine is the ONLY authority. The JS bridge reads
state via commands, never tracks it locally. No `isRecording`, no `isProcessing`, no
`currentAppState` in the frontend. Every UI update comes from a state event.

### L8: User Skepticism Is a Feature

**What happened:** "Is Phase 2 100%?" caught incomplete work. "Did you test it?" caught
an unverified post-mortem. "Is everything wired up?" found an ungated entry point.

**Applied to migration:** Build in review checkpoints. After each phase, do a full
wiring audit (every command registered, every bridge method connected, every event
forwarded). The checklist from the state machine refactor transfers directly.

### L9: Measure Before Optimizing

**What happened:** The production readiness audit established baselines (715 MB, 3s
startup) before proposing fixes. This made the Tauri comparison concrete.

**Applied to migration:** Measure Tauri at every phase. Phase T0 measures empty app.
Phase T2 measures with state machine. Phase T3 measures with sidecar. If memory creeps
above target, investigate immediately — don't wait until the end.

### L10: The Post-Mortem Itself Must Be Verified

**What happened:** The post-mortem v1 had factual errors — Phase 3 was attributed
incorrectly, bugs were missing, AI failures were undercounted. Had to be verified
against git history and revised.

**Applied to migration:** Keep a running migration log. After each phase, append what
actually happened (not what was planned). Verify against git commits. This becomes the
Tauri post-mortem automatically.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Rust learning curve slows progress | Medium | Medium | Start with simple ports (state machine, store). Use Copilot/Claude for Rust idioms. |
| WebView2 missing on old Windows | Low | High | Tauri bundles WebView2 bootstrapper. Falls back to install prompt. |
| Pill transparency doesn't work in WebView | Medium | Medium | Test in Phase T0 before committing. Fallback: overlay window via Rust native. |
| Python sidecar spawn differs on macOS/Linux | Low | Medium | Tauri sidecar plugin handles cross-platform. Test early in T3. |
| Auto-updater can't update Electron→Tauri | Certain | Medium | Requires manual reinstall. Website download + notification in Electron version. |
| Frontend JS assumes Electron APIs | Medium | Low | Grep for `require('electron')`, `process.`, `__dirname` — replace in bridge. |
| Global hotkey doesn't work in Wayland (Linux) | Medium | Low | Known limitation. Document as known issue. |
| Test coverage regression | Medium | High | Port tests phase by phase. Don't ship a phase without equivalent coverage. |

---

## Decision Log

| Decision | Rationale | Date |
|----------|-----------|------|
| Tauri over Wails | Larger ecosystem, better multi-window support, more Rust crates available | 2026-03-22 |
| Tauri over Neutralino | Neutralino lacks mature system tray and multi-window | 2026-03-22 |
| Keep Python sidecar | Rewriting audio capture + transcription in Rust is a separate project. Python works. | 2026-03-22 |
| Keep HTML frontend | 4800 lines of working UI. Rewriting in a framework adds risk with no user benefit. | 2026-03-22 |
| v3.0.0 version number | Major version = major platform change. Users need to know it's different. | 2026-03-22 |
| Separate repo vs monorepo | TBD — could be `whisperclick-tauri/` dir or new repo. Decide in Phase T0. | 2026-03-22 |

---

## Success Criteria

The Tauri migration is complete when:

1. **Feature parity**: Every feature from Electron v2.2.0 works identically
2. **Memory target**: <60 MB RAM at idle (measured, not assumed)
3. **Startup target**: <1 second cold boot to ready (measured)
4. **Installer target**: <10 MB installer size
5. **Test coverage**: Equivalent to Electron (538+ tests or Rust equivalent)
6. **Cross-platform**: Windows 10+, macOS 12+, Ubuntu 22.04+
7. **Auto-updater**: Working on all platforms
8. **Zero state bugs**: State machine + gate pattern prevents the entire category
9. **User feedback**: Beta users report no regressions from Electron version

---

*Document created: 2026-03-22*
*Status: Planning — no Rust code written yet*
*Next action: User decision on timeline priority*
