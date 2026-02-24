# WhisperClick V3 Roadmap

Last updated: 2026-02-23

## Immediate (Launch-Critical)

- [x] Persist API keys securely across relaunch (backend key storage).
- [x] Verify API key validity on paste/input for OpenAI and Gemini.
- [x] Keep footer hotkey hint synced to active hotkey setting.
- [x] Replace prompt-based hotkey edit with direct record-and-capture shortcut flow.
- [x] Enable local model selection from Settings Local Model Manager (for downloaded models).
- [x] Reset main recording timer to `00:00` after recording cycle completes.
- [x] Notification contract (P0):
  - [x] Define each toast/notification trigger, severity, and expected user action.
  - [x] Remove stale/outdated language and legacy wording.
  - [x] Ensure all failures include actionable next steps.
  - [x] Removed redundant toasts (recording started, processing, saved to history).
- [x] Wiring audit (P0):
  - [x] Prove each visible control is connected to active backend logic. (47/47 wired.)
  - [x] Identify UI elements backed by dead/legacy code paths. (None found.)
  - [x] Remove or explicitly document non-canonical wiring.
  - [x] Pill widget recording parity: ensure pill path uses the same provider/model/API-key pipeline as main UI.
- [x] Recording/transcription state-machine hardening (P0):
  - [x] Validate start, stop, cancel, retry, and error-recovery flows. (Automated test suite.)
  - [x] Validate behavior under rapid repeated toggles. (3x rapid start/cancel stress test.)
  - [x] Validate transitions between local and API modes. (Automated test suite.)
- [ ] Real-world hotkey validation matrix:
  - [ ] In-app toggle with custom hotkey.
  - [ ] Global hotkey after app restart.
  - [ ] Behavior with keyboard layouts and function keys.
- [x] API resilience and error semantics (P0):
  - [x] Validate user-facing handling for `401`, `403`, `429`, `5xx`, timeout, offline, and invalid base URL.
  - [x] Ensure provider-specific failures map to clear user guidance.
  - [x] Confirm verification and transcription error messages do not conflict.
- [x] History search wiring (P0):
  - [x] Fix History search input; it is currently not working.
  - [x] Add filter state tests for empty query, partial match, and clear/reset behavior.
- [ ] Microphone/device resilience (P0):
  - [ ] Permission denied and revoked scenarios.
  - [ ] Device unplug/switch during recording.
  - [ ] Default device reassignment and recovery behavior.

## Audio Storage

- [x] Save compressed recordings (OGG/Opus) alongside history entries.
- [x] Auto-delete recordings after 24 hours on app startup.
- [x] Playback button on history cards (hover to reveal).
- [x] Full audio player in detail modal.
- [ ] Configurable retention period (1 day, 3 days, 7 days, 30 days).
- [ ] Retention period selector in Settings UI.
- [ ] Storage usage indicator.

## Next

- [ ] Full production smoke checklist with manual pass/fail evidence.
- [ ] Installer and portable runtime validation on second Windows machine.
- [ ] Structured runtime logging and crash diagnostics.
- [x] Legacy cleanup and runtime path consolidation:
  - [x] Removed old Tk runtime path (`src/app.py`, `src/ui/`, duplicate top-level modules).
  - [ ] Remove unused/obsolete frontend artifacts or document why retained.
- [ ] Crash recovery hardening:
  - [ ] Crash-safe persistence verification.
  - [ ] Graceful restart behavior after unexpected failure.
- [ ] Release hardening:
  - [ ] Code signing plan for release binaries.
  - [ ] Installer upgrade/uninstall data migration checks.
  - [ ] Uninstall cleanup prompt — offer to remove `~/.config/whisperclick/` (settings, history, audio).
- [ ] About / Help dialog:
  - [ ] Dedicated modal with version, license, links to docs and GitHub.
  - [ ] Currently version only shows in settings sidebar footer.

## Program and Release Governance

- [ ] Versioned settings/data migrations:
  - [ ] Define schema versioning for settings/history.
  - [ ] Add forward migration and rollback-safe behavior.
  - [ ] Validate migration from older builds in installer and portable paths.
- [ ] Update strategy:
  - [ ] Decide auto-update vs manual update distribution model.
  - [ ] Define update verification and rollback behavior.
  - [ ] Document user-facing update flow and failure recovery.
- [ ] Privacy/legal readiness:
  - [ ] Publish privacy disclosure for OpenAI/Gemini request paths.
  - [ ] Define retention and data-handling policy for local/app logs.
  - [ ] Add consent and transparency copy in-app where needed.
- [ ] Accessibility pass:
  - [ ] Keyboard-only navigation for critical flows.
  - [ ] Focus-state and contrast validation.
  - [ ] Screen reader label coverage for interactive controls.
- [ ] CI release gate automation:
  - [ ] Add fail-fast CI checks (install, compile, smoke, packaging sanity).
  - [ ] Add blocking status checks for release branches.
  - [ ] Require evidence artifacts from CI for release approval.
- [ ] Dependency and supply-chain security:
  - [ ] Dependency pinning strategy for runtime/build dependencies.
  - [ ] Automated vulnerability scanning.
  - [ ] SBOM generation for release builds.
- [ ] Logging/support operations:
  - [ ] Define log schema and retention policy.
  - [ ] Define support bundle format with redaction rules.
  - [ ] Define safe troubleshooting workflow for user-shared diagnostics.
- [ ] Provider outage/rate-limit UX:
  - [ ] Define retry/backoff semantics for `429`/provider outages.
  - [ ] Define user messaging and fallback behavior.
  - [ ] Validate no duplicate/stale state in partial-failure scenarios.
- [ ] Launch governance:
  - [ ] Define explicit launch acceptance criteria.
  - [ ] Assign go/no-go owner and sign-off chain.
  - [ ] Document rollback trigger thresholds and decision process.

## macOS Support — Coming Soon

Status: **Planned** | Estimated effort: 2–3 weeks (excluding code signing/notarization)

### Strategy: Platform Abstraction Layer

All Win32-specific code will be extracted into a `src/platform/` module with swappable backends.

```
src/platform/
  __init__.py    # detect OS, re-export active backend
  win32.py       # current Win32 implementations (extracted from main.py, api.py, pill_widget.py)
  darwin.py      # macOS implementations via pyobjc + Cocoa/Quartz/Carbon
  stub.py        # no-op fallback for unsupported platforms / CI
```

`__init__.py` detects `sys.platform` at import time and re-exports the active backend. All call sites import from `src.platform` — never from a specific backend directly.

### What Moves to the Platform Layer

| Capability | Current Location | Win32 API | macOS API |
|------------|-----------------|-----------|-----------|
| DPI awareness | `main.py` (top) | `SetProcessDpiAwarenessContext` | No-op (macOS handles Retina automatically) |
| Window management | `main.py` | `SetWindowPos`, `ShowWindow`, `GetForegroundWindow` | `NSWindow` via Cocoa |
| Hotkey registration + suppression | `main.py` | `RegisterHotKey` / `UnregisterHotKey` | Carbon `RegisterEventHotKey` via pyobjc |
| Monitor enumeration | `main.py`, `pill_widget.py` | `EnumDisplayMonitors`, `GetMonitorInfoW` | `NSScreen.screens()` |
| Foreground window capture | `api.py` | `GetForegroundWindow` + `SetForegroundWindow` | `NSWorkspace.frontmostApplication` |
| Autostart toggle | `api.py` (~line 1020) | Windows Registry `HKCU\...\Run` | `~/Library/LaunchAgents/` plist file |
| Auto-paste keystroke | `api.py` | `Ctrl+V` via `pyautogui` | `Cmd+V` via `pyautogui` |
| Error dialogs | `main.py` | `ctypes.windll.user32.MessageBoxW` | `NSAlert` or pywebview fallback |
| App identity (mutex) | `main.py` | `CreateMutexW` | `fcntl.flock` (already implemented) |
| Config directory | `config.py` | `~/.config/whisperclick/` | `~/Library/Application Support/WhisperClick/` |
| Window drag | `main.py`, `api.py` | WM_APP_DRAGSTART → ReleaseCapture + WM_NCLBUTTONDOWN (native drag with snap) | `easy_drag=True` (works on macOS — no multi-monitor DPI bug) |

### macOS-Specific Implementation Details

**Hotkey suppression** — The most complex piece. macOS requires Carbon Event Manager for global hotkey registration that suppresses the key from reaching other apps:
- `RegisterEventHotKey` / `UnregisterEventHotKey` via `pyobjc-framework-Carbon`
- Runs on the Carbon event loop, which integrates with Cocoa's `NSRunLoop`
- Requires Accessibility permission (user must grant in System Settings)

**Window management** — Cocoa `NSWindow` API via `pyobjc-framework-Cocoa`:
- `setFrame:display:` for positioning/sizing
- `orderFront:` / `orderOut:` for show/hide
- `setLevel:` for always-on-top behavior
- `makeKeyAndOrderFront:` for focus

**Monitor enumeration** — `NSScreen.screens()` returns all connected displays:
- `frame()` gives total screen rect
- `visibleFrame()` gives usable area (excludes menu bar, Dock)
- No DPI conversion needed — Cocoa works in logical points

**Autostart** — LaunchAgents plist at `~/Library/LaunchAgents/com.whisperclick.app.plist`:
- Standard XML plist with `ProgramArguments` pointing to the app binary
- `RunAtLoad: true` for login start
- Toggle by writing/deleting the plist file

**Config directory** — `~/Library/Application Support/WhisperClick/`:
- Standard macOS location for app data
- `config.py` already uses `pathlib.Path` — just change the base path per platform

**Auto-paste** — `Cmd+V` instead of `Ctrl+V`:
- `pyautogui.hotkey('command', 'v')` on macOS
- Platform layer provides `paste_keystroke()` abstraction

**DPI** — No-op on macOS. Retina scaling is handled automatically by the OS and pywebview's WebKit backend. No manual DPI awareness calls needed.

**Window drag** — `easy_drag=True` works correctly on macOS (the multi-monitor DPI bug is Windows-specific). No custom drag implementation needed. On Windows, drag now uses the WM_APP_DRAGSTART pattern (native drag with snap support) — see `docs/maximize-snap-changelog.md`.

### New Dependencies (macOS only)

```
pyobjc-framework-Carbon    # Global hotkey registration (RegisterEventHotKey)
pyobjc-framework-Cocoa     # NSWindow, NSScreen, NSAlert, NSWorkspace, LaunchAgents
pyobjc-framework-Quartz    # CGEvent (if needed for advanced hotkey features)
```

These are macOS-only extras — added via `requirements-macos.txt` or a `[macos]` extra in `pyproject.toml`. Windows installs are unaffected.

### Component Compatibility Matrix

| Component | Windows (current) | macOS Equivalent | Effort |
|-----------|-------------------|------------------|--------|
| Global hotkey | `RegisterHotKey` Win32 | Carbon `RegisterEventHotKey` (pyobjc) | Medium |
| DPI / window sizing | `ctypes.windll.shcore` | No-op (Retina is automatic) | Low |
| Window positioning | `GetWindowRect` / `SetWindowPos` | `NSWindow.setFrame:display:` | Medium |
| Window drag | WM_APP_DRAGSTART native drag (with snap) | `easy_drag=True` (works on macOS) | Low |
| Multi-monitor | `EnumDisplayMonitors` | `NSScreen.screens()` | Low |
| Single-instance lock | `msvcrt.locking` / `CreateMutexW` | `fcntl.flock` (already done) | Done |
| Webview backend | WebView2 | WebKit (pywebview auto-selects) | None |
| System tray | pystray | pystray (works on macOS) | None |
| PySide6 pill | Works | Works cross-platform | None |
| Audio capture | sounddevice | sounddevice (works on macOS) | None |
| Transcription | OpenAI / Gemini / local Whisper | Same (all cross-platform) | None |
| Translation | OpenAI / Gemini / local | Same (all cross-platform) | None |
| Audio feedback (tones) | sounddevice playback | Same (cross-platform) | None |
| Clipboard | pyperclip | pyperclip (works on macOS) | None |
| Keyring | keyring (WinCred backend) | keyring (macOS Keychain backend) | None |
| Installer | Inno Setup → EXE | DMG + `.app` bundle (PyInstaller) | Medium |
| Code signing | Not required for distribution | Apple Developer ($99/yr) + notarization | High |
| Auto-start | Windows Registry `HKCU\...\Run` | `~/Library/LaunchAgents/` plist | Low |

### Already Cross-Platform (No Changes Needed)

These components work on macOS today with zero modification:

- Audio capture (`sounddevice`)
- Transcription service (OpenAI, Gemini, local Whisper)
- Translation service
- Audio feedback tones
- Frontend UI (`index.html`, `style.css`, `app.js`)
- PySide6 pill widget (Qt is cross-platform)
- System tray (`pystray`)
- Keyring storage (`keyring` auto-selects macOS Keychain)
- Clipboard (`pyperclip`)
- Config persistence logic (just needs different base path)
- History CRUD
- Model manager

### New Files

| File | Purpose |
|------|---------|
| `src/platform/__init__.py` | OS detection, re-export active backend |
| `src/platform/win32.py` | Extracted Win32 implementations |
| `src/platform/darwin.py` | macOS implementations (Cocoa/Carbon/Quartz) |
| `src/platform/stub.py` | No-op fallback for CI and unsupported platforms |
| `docs/macos-port-spec.md` | Detailed macOS port specification |
| `requirements-macos.txt` | macOS-only dependencies |
| `build_macos.sh` | macOS PyInstaller build script |
| `whisperclick_macos.spec` | PyInstaller spec for `.app` bundle |
| `assets/microphone_logo.icns` | macOS app icon |
| `entitlements.plist` | macOS sandbox entitlements (microphone, accessibility) |

### Modified Files

| File | Changes |
|------|---------|
| `src/main.py` | Replace Win32 calls with `src.platform` imports |
| `src/backend/api.py` | Replace autostart registry code, paste key, foreground window with platform calls |
| `src/pill_widget.py` | Replace DPI/monitor Win32 calls with platform calls |
| `src/pill_manager.py` | Replace any Win32 monitor enumeration with platform calls |
| `src/backend/config.py` | Use platform-specific config directory |
| `src/frontend/index.html` | Show `Cmd` instead of `Ctrl` in hotkey hints on macOS |

### macOS Permissions

The app will require three macOS permissions (granted by user in System Settings):

1. **Microphone** — required for audio recording (prompted automatically by macOS on first use)
2. **Accessibility** — required for global hotkey registration and suppression
3. **Automation** — required for `pyautogui` to simulate `Cmd+V` paste keystroke

These are declared in `entitlements.plist` and the user is prompted at runtime.

### Build and Distribution

- **PyInstaller `.app` bundle** — `whisperclick_macos.spec` targeting `--windowed` mode
- **DMG packaging** — `create-dmg` or `hdiutil` for drag-to-Applications installer
- **Code signing** — future work (requires Apple Developer Program, $99/yr)
- **Notarization** — future work (required for Gatekeeper on macOS 10.15+)
- **CI** — GitHub Actions `macos-latest` runner for automated builds

### Execution Phases

1. **Extract** — Move all Win32 calls from `main.py`, `api.py`, `pill_widget.py` into `src/platform/win32.py`. Create `__init__.py` with OS detection. Verify Windows still works (run full test suite).
2. **Implement** — Write `darwin.py` with macOS equivalents. Start with hotkey (hardest), then window management, monitor enumeration, autostart, config path, paste key. Test each on macOS hardware.
3. **Frontend** — Conditional `Cmd`/`Ctrl` display in hotkey hints. Test pywebview WebKit backend behavior.
4. **Build** — Create `whisperclick_macos.spec`, `build_macos.sh`, DMG packaging. Generate `.icns` icon. Test `.app` bundle launch.
5. **Test** — Single-monitor and multi-monitor macOS setups. All recording modes (local, OpenAI, Gemini). Pill widget. Tray. Autostart. Permissions flow.
