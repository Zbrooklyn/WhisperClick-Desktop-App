# WhisperClick Tauri Parity Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 20 issues from the Human Engine audit to bring WhisperClick Tauri from 72% to 100% feature parity with Electron.

**Architecture:** All fixes are in the Tauri platform layer (`platforms/tauri/`). No changes to shared frontend (`shared/frontend/index.html`) or engine (`shared/engine/`). Bridge.js handles JS-side fixes; lib.rs/sidecar.rs handle Rust-side fixes.

**Tech Stack:** Rust (Tauri 2.10.3), JavaScript (bridge.js initialization_script), Python (sidecar engine)

---

## File Map

| File | Changes |
|------|---------|
| `platforms/tauri/src/sidecar.rs` | Fix `is_running` flag propagation (Task 1) |
| `platforms/tauri/bridge.js` | Add `get_monitors` alias (Task 2), fix `verify_api_key` params (Task 6), gate debug code (Task 13) |
| `platforms/tauri/src/lib.rs` | Fix `get_audio` response (Task 3), fix `start_recording` error handling (Task 4), fix `delete/clear_history` audio cleanup (Task 7), fix `window_close` (Task 8), fix `hide_pill` persist (Task 9), fix health monitor state reset (Task 10), fix `send_configure` language (Task 11), fix `get_app_info` version (Task 14), fix `export_transcription` (Task 15) |
| `platforms/tauri/src/store.rs` | Delete stale test (Task 16) |
| `platforms/tauri/tauri.conf.json` | Remove redundant flag (Task 17) |

---

### Task 1: Fix sidecar `is_running` flag — health monitor broken (CRITICAL)

**Files:**
- Modify: `platforms/tauri/src/sidecar.rs:48-50,97-104,137-146`

The reader thread creates a local `running_flag` that is never connected back to `self.is_running`. When the sidecar crashes, `is_running()` still returns true, so the health monitor never detects the crash.

- [ ] **Step 1: Fix the reader thread to use the shared `is_running` flag**

In `sidecar.rs`, the `start()` method needs to clone `self.is_running` into the reader thread instead of creating a separate `running_flag`.

```rust
// Replace lines 97-104 in start():
// BEFORE:
// self.is_running.store(true, Ordering::Relaxed);
// ...
// let running_flag = Arc::new(AtomicBool::new(true));

// AFTER:
self.is_running.store(true, Ordering::Relaxed);
let is_running_for_thread = self.is_running.clone();
// ... (keep pending_for_thread, event_handler as-is)

// Then in the reader thread (line ~139), replace:
// running_flag.store(false, Ordering::Relaxed);
// with:
is_running_for_thread.store(false, Ordering::Relaxed);
```

Note: `is_running` field on Sidecar is already an `Arc<AtomicBool>` (wrapped inside the struct). Check the actual type — if it's a bare `AtomicBool`, it needs to become `Arc<AtomicBool>` so it can be cloned into the thread. If it IS already Arc-wrapped (via the outer `Arc<Sidecar>`), then `self.is_running` can be read by any thread that has an `Arc<Sidecar>` clone.

- [ ] **Step 2: Run tests**

Run: `cd platforms/tauri && cargo test sidecar 2>&1`

- [ ] **Step 3: Commit**

```
fix: sidecar is_running flag propagates to reader thread — health monitor now detects crashes
```

---

### Task 2: Add `get_monitors` alias to bridge (CRITICAL)

**Files:**
- Modify: `platforms/tauri/bridge.js:411`

Frontend calls `callNativeApi('get_monitors')` (index.html:1746) but bridge only has `get_displays()`. The lookup returns undefined, pill monitor dropdown is empty.

- [ ] **Step 1: Add the alias**

After the existing `get_displays()` method (around line 414), add:

```javascript
async get_monitors() {
  return await this.get_displays();
},
```

- [ ] **Step 2: Commit**

```
fix: add get_monitors alias in bridge — pill monitor dropdown now populates
```

---

### Task 3: Fix `get_audio` response shape (CRITICAL)

**Files:**
- Modify: `platforms/tauri/src/lib.rs:435-449`

Electron returns `{success, data, mime}`. Tauri returns `{audio, path}`. Frontend expects Electron's shape.

- [ ] **Step 1: Update the response to match Electron**

```rust
#[tauri::command]
fn get_audio(store: tauri::State<'_, AppStore>, id: String) -> Value {
    let history = store.0.get_history();
    if let Some(entry) = history.iter().find(|e| e.get("id").and_then(|v| v.as_str()) == Some(&id)) {
        if let Some(audio_path) = entry.get("audioPath").and_then(|v| v.as_str()) {
            let path = std::path::Path::new(audio_path);
            if !path.exists() {
                return serde_json::json!({ "success": false, "error": "Audio file not found" });
            }
            if let Ok(bytes) = std::fs::read(audio_path) {
                use base64::{Engine as _, engine::general_purpose::STANDARD};
                let b64 = STANDARD.encode(&bytes);
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("wav");
                let mime = match ext {
                    "mp3" => "audio/mpeg",
                    "ogg" => "audio/ogg",
                    "webm" => "audio/webm",
                    _ => "audio/wav",
                };
                return serde_json::json!({ "success": true, "data": b64, "mime": mime });
            }
        }
    }
    serde_json::json!({ "success": false, "error": "No audio file" })
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cd platforms/tauri && cargo build 2>&1`

- [ ] **Step 3: Commit**

```
fix: get_audio returns {success, data, mime} matching Electron response shape
```

---

### Task 4: Fix `start_recording` — check sidecar errors (HIGH)

**Files:**
- Modify: `platforms/tauri/src/lib.rs:157-182`

Currently transitions state to Recording THEN sends to sidecar with `let _` (error ignored). If sidecar is down, app appears to record but nothing happens.

- [ ] **Step 1: Check sidecar send result before transitioning**

```rust
#[tauri::command]
fn start_recording(
    sm: tauri::State<'_, AppStateMachine>,
    store: tauri::State<'_, AppStore>,
    sc: tauri::State<'_, AppSidecar>,
    app: AppHandle,
) -> ResultPayload {
    let settings = store.0.get_settings();
    let mode = settings.get("mode").and_then(|v| v.as_str()).unwrap_or("api");

    // Gate check
    if !sm.0.can_transition_to(AppState::Recording) {
        return ResultPayload::err("Cannot start recording in current state");
    }

    // Capture foreground window for auto-paste target
    let _ = sc.0.send("capture_fg", HashMap::new(), |_| {});

    // Try to send start_rec — only transition if successful
    match sc.0.send("start_rec", HashMap::new(), |_| {}) {
        Ok(_) => {
            sm.0.transition(AppState::Recording, None);
            broadcast_state(&sm.0, &app, &store.0);
            ResultPayload::ok()
        }
        Err(e) => {
            eprintln!("[start_recording] sidecar error: {}", e);
            ResultPayload::err(&format!("Failed to start recording: {}", e))
        }
    }
}
```

- [ ] **Step 2: Build and verify**

Run: `cd platforms/tauri && cargo build 2>&1`

- [ ] **Step 3: Commit**

```
fix: start_recording checks sidecar response — no longer transitions to Recording if sidecar is down
```

---

### Task 5: Fix tray menu — make it dynamic (HIGH)

**Files:**
- Modify: `platforms/tauri/src/lib.rs` — tray menu section

The tray menu is built once at startup and never updates. Labels like "Start Recording" / "Stop Recording" are stale. Missing: mic submenu, recent transcriptions, paste last.

This is the largest task. The approach: rebuild the tray menu on every right-click by handling the tray `on_menu_event` to trigger a rebuild.

- [ ] **Step 1: Extract tray menu building into a reusable function**

Create a function `build_tray_menu()` that reads current state from the state machine + store and builds the menu dynamically. Use the same menu item IDs.

- [ ] **Step 2: Add recent transcriptions submenu (last 3 from history)**

Read `store.get_history()`, take first 3 entries, create menu items with truncated text. On click, copy to clipboard.

- [ ] **Step 3: Add "Paste Last Transcript" menu item**

On click, read first history entry, copy to clipboard, simulate paste.

- [ ] **Step 4: Wire tray icon right-click to rebuild menu**

Use `tray.on_tray_icon_event()` to detect right-click and call the rebuild function before showing.

Note: Tauri 2's `TrayIcon` API may not support dynamic menu rebuilding on right-click. If it doesn't, the alternative is to rebuild the menu after every state change (recording start/stop, settings change). Check Tauri docs for `set_menu()` method on `TrayIcon`.

- [ ] **Step 5: Build and test**

Run: `cd platforms/tauri && cargo build 2>&1`

- [ ] **Step 6: Commit**

```
feat: dynamic tray menu — updates on state change, adds recent transcriptions + paste last
```

---

### Task 6: Fix `verify_api_key` — pass `baseUrl` through (HIGH)

**Files:**
- Modify: `platforms/tauri/bridge.js:320-322`
- Modify: `platforms/tauri/src/lib.rs:318-339`

Bridge drops `baseUrl` param. Rust hardcodes empty string. Custom endpoint users can't verify keys.

- [ ] **Step 1: Update bridge to accept 3 params**

```javascript
async verify_api_key(provider, key, baseUrl) {
  return await trackedInvoke('verify_api_key', { provider, key, base_url: baseUrl || '' });
},
```

- [ ] **Step 2: Update Rust command to accept `base_url` param**

```rust
#[tauri::command]
fn verify_api_key(sc: tauri::State<'_, AppSidecar>, provider: String, key: String, base_url: Option<String>) -> Value {
    let mut params = HashMap::new();
    params.insert("provider".to_string(), Value::String(provider));
    params.insert("api_key".to_string(), Value::String(key));
    params.insert("base_url".to_string(), Value::String(base_url.unwrap_or_default()));
    // ... rest unchanged
}
```

- [ ] **Step 3: Build and commit**

```
fix: verify_api_key passes baseUrl to sidecar — custom endpoint verification works
```

---

### Task 7: Fix `delete_history` / `clear_history` — delete audio files (HIGH)

**Files:**
- Modify: `platforms/tauri/src/lib.rs:231-241`

Electron deletes associated audio files before removing history entries. Tauri doesn't — orphaned files accumulate.

- [ ] **Step 1: Add audio file deletion to both commands**

```rust
#[tauri::command]
fn delete_history(store: tauri::State<'_, AppStore>, id: String) -> ResultPayload {
    // Delete audio file first (matches Electron behavior)
    let history = store.0.get_history();
    if let Some(entry) = history.iter().find(|e| e.get("id").and_then(|v| v.as_str()) == Some(&id)) {
        if let Some(path) = entry.get("audioPath").and_then(|v| v.as_str()) {
            let _ = std::fs::remove_file(path); // ignore if already gone
        }
    }
    store.0.delete_history(&id);
    ResultPayload::ok()
}

#[tauri::command]
fn clear_history(store: tauri::State<'_, AppStore>) -> ResultPayload {
    // Delete all audio files first (matches Electron behavior)
    let history = store.0.get_history();
    for entry in &history {
        if let Some(path) = entry.get("audioPath").and_then(|v| v.as_str()) {
            let _ = std::fs::remove_file(path);
        }
    }
    store.0.clear_history();
    ResultPayload::ok()
}
```

- [ ] **Step 2: Build and commit**

```
fix: delete/clear history removes audio files from disk — prevents orphaned file accumulation
```

---

### Task 8: Fix `window_close` — respect `closeBehavior` setting (HIGH)

**Files:**
- Modify: `platforms/tauri/src/lib.rs:617-621`

Currently always hides. Should check `closeBehavior` setting — if "close", actually quit the app.

- [ ] **Step 1: Update to check setting**

```rust
#[tauri::command]
fn window_close(window: tauri::Window, store: tauri::State<'_, AppStore>) -> ResultPayload {
    let settings = store.0.get_settings();
    let behavior = settings.get("closeBehavior").and_then(|v| v.as_str()).unwrap_or("tray");
    if behavior == "close" {
        // Actually close the window (triggers on_window_event CloseRequested)
        let _ = window.close();
    } else {
        // Minimize to tray
        let _ = window.hide();
    }
    ResultPayload::ok()
}
```

- [ ] **Step 2: Build and commit**

```
fix: window_close respects closeBehavior setting — 'close' actually quits, 'tray' hides
```

---

### Task 9: Fix `hide_pill` — persist `showPill: false` (MEDIUM)

**Files:**
- Modify: `platforms/tauri/src/lib.rs:538-546`

- [ ] **Step 1: Save setting when pill is hidden**

```rust
#[tauri::command]
fn hide_pill(app: AppHandle, store: tauri::State<'_, AppStore>) -> ResultPayload {
    if let Some(pill) = app.get_webview_window("pill") {
        let _ = pill.hide();
    }
    // Persist showPill=false so pill stays hidden on restart
    let mut patch = serde_json::Map::new();
    patch.insert("showPill".into(), Value::Bool(false));
    store.0.save_settings(patch);
    let _ = app.emit("pill-hidden", &());
    ResultPayload::ok()
}
```

Note: The `hide_pill` command signature now takes `store` — make sure it's added to the function parameters.

- [ ] **Step 2: Build and commit**

```
fix: hide_pill persists showPill=false — pill stays hidden after restart
```

---

### Task 10: Fix health monitor — reset state on sidecar crash (MEDIUM)

**Files:**
- Modify: `platforms/tauri/src/lib.rs:1021-1047`

When sidecar crashes during recording, the state machine stays stuck in Recording/Processing. The health monitor should transition to Dormant (or Error) before attempting restart.

- [ ] **Step 1: Add state reset before restart**

The health monitor thread needs access to the state machine and app handle. Add clones before the thread spawn, then transition state when crash is detected.

```rust
// Before the monitor thread spawn, clone what's needed:
let monitor_sm = sm.clone();
let monitor_app = app.handle().clone();
let monitor_store = store.clone();

// Inside the monitor loop, when !monitor_sc.is_running():
// Reset state if it was active
if monitor_sm.is(&[AppState::Recording, AppState::Processing]) {
    monitor_sm.transition(AppState::Error, Some("Backend crashed — restarting..."));
    broadcast_state(&monitor_sm, &monitor_app, &monitor_store);
}
```

- [ ] **Step 2: Build and commit**

```
fix: health monitor resets state machine on sidecar crash — UI no longer stuck in recording/processing
```

---

### Task 11: Fix `send_configure` language field (MEDIUM)

**Files:**
- Modify: `platforms/tauri/src/lib.rs:756`

The `language` field is sent but doesn't exist in store defaults. Electron sends `s.language` which is also likely undefined. The engine uses it as the recognition language hint. It should use `sourceLanguage` from the store.

- [ ] **Step 1: Fix the mapping**

```rust
// Change line 756 from:
params.insert("language".into(), Value::String(s.get("language").and_then(|v| v.as_str()).unwrap_or("auto").into()));
// To:
params.insert("language".into(), Value::String(s.get("sourceLanguage").and_then(|v| v.as_str()).unwrap_or("auto").into()));
```

- [ ] **Step 2: Build and commit**

```
fix: send_configure maps sourceLanguage to engine's language field
```

---

### Task 12: Implement multi-monitor display API (MEDIUM)

**Files:**
- Modify: `platforms/tauri/bridge.js:411-419`
- Modify: `platforms/tauri/src/lib.rs` — add `get_displays` command

Currently stubbed with hardcoded single display. Need to use Tauri's monitor API.

- [ ] **Step 1: Add Rust command for get_displays**

```rust
#[tauri::command]
fn get_displays(app: AppHandle) -> Value {
    let mut displays = Vec::new();
    if let Ok(monitors) = app.available_monitors() {
        for (i, mon) in monitors.enumerate() {
            let size = mon.size();
            let pos = mon.position();
            displays.push(serde_json::json!({
                "id": i,
                "label": mon.name().unwrap_or(&format!("Display {}", i + 1)),
                "primary": i == 0,
                "width": size.width,
                "height": size.height,
                "x": pos.x,
                "y": pos.y,
            }));
        }
    }
    if displays.is_empty() {
        displays.push(serde_json::json!({ "id": 0, "label": "Primary", "primary": true }));
    }
    serde_json::json!(displays)
}
```

- [ ] **Step 2: Register command and update bridge**

Add `get_displays` to the `generate_handler!` macro. Update bridge.js:

```javascript
async get_displays() {
  return await trackedInvoke('get_displays');
},
async get_monitors() {
  return await this.get_displays();
},
```

- [ ] **Step 3: Implement `move_pill_to_display`**

Add Rust command that repositions pill window based on display ID using monitor position/size data.

- [ ] **Step 4: Build and commit**

```
feat: multi-monitor support — get_displays returns real monitor data, move_pill_to_display works
```

---

### Task 13: Gate debug code behind debug flag (MEDIUM)

**Files:**
- Modify: `platforms/tauri/bridge.js`

Debug overlay, click logger, and monkey-patching ship to production. Gate behind a flag.

- [ ] **Step 1: Check for debug mode at bridge start**

The bridge runs as initialization_script. We can check if `__TAURI_DEBUG__` is set (Tauri sets this in debug builds), or check a setting.

```javascript
const _IS_DEBUG = !!(window.__TAURI_DEBUG__ || window.__TAURI_INTERNALS__?.metadata?.debug);
```

- [ ] **Step 2: Wrap debug code in conditionals**

```javascript
// Debug panel creation
if (_IS_DEBUG) { _createDebugPanel(); }

// Click logger
if (_IS_DEBUG && document.body) _installClickLogger();

// Monkey-patching
if (_IS_DEBUG) {
  setTimeout(_patchOnboarding, 500);
  // ...
}

// trackedInvoke — in production, just use raw invoke
const trackedInvoke = _IS_DEBUG ? function(cmd, args) {
  _debugLog(...);
  return _rawInvoke(cmd, args)...
} : _rawInvoke;
```

- [ ] **Step 3: Commit**

```
perf: gate debug logging behind __TAURI_DEBUG__ — no overhead in production builds
```

---

### Task 14: Fix `get_app_info` — read version from build (LOW)

**Files:**
- Modify: `platforms/tauri/src/lib.rs:497-503`

- [ ] **Step 1: Use `env!("CARGO_PKG_VERSION")` instead of hardcoded string**

```rust
#[tauri::command]
fn get_app_info() -> Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "isDev": cfg!(debug_assertions),
    })
}
```

- [ ] **Step 2: Build and commit**

```
fix: get_app_info reads version from Cargo.toml — no more hardcoded 3.0.0-alpha
```

---

### Task 15: Fix `export_transcription` — return after dialog (LOW)

**Files:**
- Modify: `platforms/tauri/src/lib.rs:451-463`

Currently returns `ResultPayload::ok()` before the dialog even opens. The save happens in a callback.

- [ ] **Step 1: This is acceptable for now**

Tauri's dialog plugin uses a callback pattern that can't easily return a result synchronously. The frontend doesn't currently depend on the return value for export — it just fires and forgets. Mark as WONTFIX for now; document in code comment.

Add comment:

```rust
// Note: returns immediately — dialog save is async via callback.
// Frontend does not depend on export result. Matches Tauri dialog plugin pattern.
```

- [ ] **Step 2: Commit**

```
docs: document export_transcription async behavior
```

---

### Task 16: Delete stale test `dev_mode_appends_suffix` (LOW)

**Files:**
- Modify: `platforms/tauri/src/store.rs:378-388`

The test expects behavior that was removed when `Store::new()` stopped appending `-dev`. The caller now handles this.

- [ ] **Step 1: Delete the test**

Remove lines 378-388 (`dev_mode_appends_suffix` test).

- [ ] **Step 2: Run tests to confirm 115/115 pass**

Run: `cd platforms/tauri && cargo test 2>&1`

- [ ] **Step 3: Commit**

```
fix: remove stale dev_mode_appends_suffix test — behavior moved to caller in lib.rs
```

---

### Task 17: Remove redundant `dangerousDisableAssetCspModification` (LOW)

**Files:**
- Modify: `platforms/tauri/tauri.conf.json:14`

When `"csp": null`, this flag is a no-op.

- [ ] **Step 1: Remove the flag**

```json
"security": {
  "csp": null
}
```

- [ ] **Step 2: Build to verify**

Run: `cd platforms/tauri && cargo build 2>&1`

- [ ] **Step 3: Commit**

```
chore: remove redundant dangerousDisableAssetCspModification — no-op when csp is null
```

---

### Task 18: Create migration gap tracker document (LOW)

**Files:**
- Create: `docs/migration-gap-tracker.md`

Document all Electron features with their porting status.

- [ ] **Step 1: Create the document**

List every Electron feature, its status (ported / partial / stubbed / intentionally skipped), and rationale for any gaps.

- [ ] **Step 2: Commit**

```
docs: create migration gap tracker — documents all Electron→Tauri feature status
```

---

## Execution Order

**Critical (do first):** Tasks 1, 2, 3
**High (do second):** Tasks 4, 5, 6, 7, 8
**Medium (do third):** Tasks 9, 10, 11, 12, 13
**Low (do last):** Tasks 14, 15, 16, 17, 18

Total estimated tasks: 18 (Task 5 is the largest — dynamic tray menu)

## Checkpoint

After completing all Critical + High tasks (1-8), rebuild and launch the app. Verify:
1. Sidecar crash → auto-restart detected
2. Pill monitor dropdown shows real monitors
3. Audio playback works in history
4. Recording fails gracefully if sidecar is down
5. Tray menu updates dynamically
6. API key verification works with custom base URL
7. Deleting history cleans up audio files
8. Close button respects closeBehavior setting

If all pass, proceed to Medium + Low tasks.
