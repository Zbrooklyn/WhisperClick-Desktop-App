# WhisperClick Migration Gap Tracker — Electron vs Tauri

**Last updated:** 2026-03-23
**Status:** All critical and high gaps resolved

## Feature Parity Status

| Feature | Electron | Tauri | Status |
|---------|----------|-------|--------|
| **Recording Flow** |
| Start/stop/cancel recording | IPC handlers | Tauri commands | PORTED |
| State machine (dormant/recording/processing/success/error) | JS state machine | Rust state machine | PORTED |
| Audio level meter (sidecar level events) | Throttled 50ms broadcast | Direct event emit | PORTED (no throttle) |
| Transcription → history + auto-paste + auto-enter | sidecar event handler | sidecar event handler | PORTED |
| Translation event handling | Separate handler + history update | Inline in transcription handler | PORTED |
| Start recording error check | Detects stale sidecar state | Checks send() result | PORTED |
| **Settings** |
| get/save/reset settings | IPC + store merge | Tauri commands + store merge | PORTED |
| Settings translation (V3 snake_case ↔ camelCase) | preload.js | bridge.js | PORTED |
| configure sidecar on save | configureSidecar() | send_configure() | PORTED |
| Theme change | titleBarOverlay color update | eval() CSS update | PORTED |
| Always-on-top toggle | setAlwaysOnTop() | set_always_on_top() | PORTED |
| Debug logging toggle | log.setEnabled() | logger.set_enabled() | PORTED |
| **Models** |
| List/download/delete models | IPC → sidecar | Tauri commands → sidecar | PORTED |
| Download progress events | model-download-progress IPC | model-download-progress event | PORTED |
| Download error propagation | Await sidecar response | send_sync 600s timeout | PORTED |
| **Microphones** |
| List/set microphones | IPC → sidecar | Tauri commands → sidecar | PORTED |
| **API Keys** |
| Verify API key (with baseUrl) | IPC → sidecar | Tauri command → sidecar | PORTED |
| Secure storage | Electron safeStorage (encrypted in settings.json) | OS keyring via keyring crate | PORTED (different mechanism) |
| **History** |
| get/delete/clear history | IPC + store | Tauri commands + store | PORTED |
| Audio file cleanup on delete/clear | fs.unlinkSync before remove | fs::remove_file before remove | PORTED |
| Get audio (base64 + mime) | IPC returns {success, data, mime} | Tauri returns {success, data, mime} | PORTED |
| Export transcription | dialog.showSaveDialog (sync) | dialog plugin (async callback) | PORTED (async) |
| Copy to clipboard | clipboard.writeText | tauri clipboard plugin | PORTED |
| Paste last transcript | clipboard + simulatePaste | clipboard + simulate_paste | PORTED |
| **Window Management** |
| Frameless window | titleBarStyle: 'hidden' + titleBarOverlay | decorations(false) + data-tauri-drag-region | PORTED |
| Custom min/max/close buttons | Native overlay (hidden HTML buttons) | HTML buttons (unhide .electron-hide) | PORTED |
| Window drag | -webkit-app-region: drag | data-tauri-drag-region attribute | PORTED |
| Double-click to maximize | Native (free with drag region) | Custom dblclick handler | PORTED |
| Close behavior (tray vs quit) | on('close') checks closeBehavior | on_window_event(CloseRequested) | PORTED |
| Window shadow | Native | .shadow(true) | PORTED |
| **Tray** |
| Tray icon with state coloring | Dynamic tinting | Dynamic tinting via image crate | PORTED |
| Dynamic menu (rebuilds on state change) | buildRichMenuTemplate on right-click | build_tray_menu() on broadcast_state | PORTED |
| Start/Stop Recording toggle | Dynamic label | Dynamic label | PORTED |
| Sound Effects checkbox | CheckMenuItem | CheckMenuItem | PORTED |
| Show Pill Widget checkbox | CheckMenuItem | CheckMenuItem | PORTED |
| Recent Transcriptions submenu | Last 3, click to copy | Last 3, click to copy | PORTED |
| Paste Last Transcript | Copies + simulates paste | Copies + simulates paste | PORTED |
| Tray click behavior | trayClickAction setting | trayClickAction setting | PORTED |
| **Pill Window** |
| Creation + visibility sync | Show when main hidden, hide when shown | Same behavior | PORTED |
| State rendering | pill-render IPC | pill-render event | PORTED |
| Click handling | pill-clicked IPC | pill_clicked command | PORTED |
| Ignore mouse events | setIgnoreMouseEvents(true, {forward}) | set_ignore_cursor_events(true) | PORTED |
| Multi-monitor positioning | get-displays + move-pill-to-display | get_displays + move_pill_to_display | PORTED |
| Context menu | Rich native menu | No-op stub | NOT PORTED |
| **Hotkey** |
| Registration + re-registration | globalShortcut | tauri_plugin_global_shortcut | PORTED |
| Debounce (300ms) | AtomicU64 timestamp | AtomicU64 timestamp | PORTED |
| Capture foreground window | sidecar capture_fg | sidecar capture_fg | PORTED |
| **Auto-Start** |
| Enable/disable/query | app.setLoginItemSettings | tauri_plugin_autostart | PORTED |
| **Updater** |
| Check for updates | electron-updater | tauri_plugin_updater | PORTED |
| Download + install | Separate steps | Combined (Tauri plugin design) | PORTED |
| Update channels | stable/beta via electron-updater | Via settings (updateChannel) | PORTED |
| Post-update notification | update-success event | Not implemented | NOT PORTED |
| **Sidecar** |
| JSON stdin/stdout protocol | sidecar.js (Node.js) | sidecar.rs (Rust) | PORTED |
| Health monitor + auto-restart | on('exit') handler (max 3) | Polling thread (max 3) | PORTED |
| State reset on crash | Broadcasts error state | Transitions to Error state | PORTED |
| Graceful shutdown | Send quit + wait 2s + kill | Send quit + wait 2s + kill | PORTED |
| **Security** |
| CSP | Default Electron CSP | Disabled (csp: null) | INTENTIONAL |
| Context isolation | contextIsolation: true | Tauri default (enforced) | PORTED |
| API keys not in localStorage | Encrypted in settings.json | OS keyring (never in settings) | PORTED |
| **Debug** |
| DevTools | Ctrl+Shift+I (Electron) | open_devtools() in debug builds | PORTED |
| JS error forwarding | Console visible in DevTools | js_log command → Rust stdout | PORTED |
| Debug overlay | N/A | Ctrl+Shift+D (debug builds only) | TAURI ONLY |
| **Other** |
| Single instance lock | app.requestSingleInstanceLock() | tauri_plugin_single_instance | PORTED |
| App info (version, platform) | Dynamic from app.getVersion() | Dynamic from Cargo.toml | PORTED |
| Config paths | %APPDATA%/Electron/com.whisperclick.{dev,app} | %APPDATA%/Tauri/com.whisperclick.{dev,app} | PORTED |

## Intentionally Not Ported

| Feature | Reason |
|---------|--------|
| Pill context menu | Low usage; would require building native menu from scratch. Users can right-click tray instead. |
| Post-update notification | Tauri plugin doesn't emit post-install events in the same way. App restarts after update. |
| Windows 11 Snap Layouts | Requires native window controls. Not available with decorations(false). Small app window — not a workflow feature. |
| macOS/Linux support | Tauri migration is Windows-first. system.rs stubs return errors on non-Windows. |
| Level broadcast throttle | Tauri emits every level event. Frontend handles rendering at its own pace. No user-visible difference. |

## Known Limitations

1. **CSP disabled** — `"csp": null` in tauri.conf.json. The V3 frontend uses extensive inline scripts/styles. Enabling CSP requires frontend refactoring. Acceptable for desktop app (no remote content).
2. **Updater pubkey empty** — User must run `cargo tauri signer generate` before release builds.
3. **No Electron→Tauri settings migration** — Users switching from Electron start fresh.
