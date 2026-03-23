mod encryption;
mod gate;
mod logger;
mod sidecar;
mod state_machine;
mod store;
mod system;

use sidecar::Sidecar;
use state_machine::{AppState, StateMachine};
use store::Store;
use std::collections::HashMap;
use std::sync::Arc;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use serde::Serialize;
use serde_json::Value;

/// Default timeout for synchronous sidecar commands (60 seconds)
const SIDECAR_TIMEOUT: Duration = Duration::from_secs(60);

/// Managed state
pub struct AppStateMachine(pub Arc<StateMachine>);
pub struct AppSidecar(pub Arc<Sidecar>);
pub struct AppStore(pub Arc<Store>);
pub struct AppLogger(pub Arc<logger::Logger>);

#[derive(Clone, Serialize)]
struct StatePayload {
    state: String,
    message: String,
    #[serde(rename = "autoEnterMode")]
    auto_enter_mode: String,
}

#[derive(Serialize)]
struct ResultPayload {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

impl ResultPayload {
    fn ok() -> Self { Self { success: true, error: None, text: None } }
    fn err(msg: &str) -> Self { Self { success: false, error: Some(msg.to_string()), text: None } }
    fn ok_with_text(t: &str) -> Self { Self { success: true, error: None, text: Some(t.to_string()) } }
}

// --- State commands ---

#[tauri::command]
fn get_state(sm: tauri::State<'_, AppStateMachine>) -> Value {
    serde_json::json!({ "state": sm.0.state().to_string(), "message": sm.0.message() })
}

#[tauri::command]
fn ack_state(sm: tauri::State<'_, AppStateMachine>, app: AppHandle, store: tauri::State<'_, AppStore>) -> ResultPayload {
    if sm.0.is(&[AppState::Success, AppState::Error]) {
        sm.0.transition(AppState::Dormant, None);
        broadcast_state(&sm.0, &app, &store.0);
        ResultPayload::ok()
    } else {
        ResultPayload::err("Nothing to acknowledge")
    }
}

// --- Settings commands ---

#[tauri::command]
fn get_settings(store: tauri::State<'_, AppStore>) -> serde_json::Map<String, Value> {
    store.0.get_settings()
}

#[tauri::command]
fn save_settings(
    store: tauri::State<'_, AppStore>,
    sc: tauri::State<'_, AppSidecar>,
    log: tauri::State<'_, AppLogger>,
    app: AppHandle,
    patch: serde_json::Map<String, Value>,
) -> ResultPayload {
    // --- Apply window-level settings ---
    if let Some(w) = app.get_webview_window("main") {
        if let Some(aot) = patch.get("alwaysOnTop").and_then(|v| v.as_bool()) {
            let _ = w.set_always_on_top(aot);
        }
        if let Some(theme) = patch.get("theme").and_then(|v| v.as_str()) {
            let bg = if theme == "light" { "#F5F5F4" } else { "#1C1917" };
            let _ = w.eval(&format!("document.documentElement.style.backgroundColor = '{}'", bg));
        }
    }

    // --- Pill visibility on showPill change ---
    if let Some(show) = patch.get("showPill").and_then(|v| v.as_bool()) {
        if let Some(pill) = app.get_webview_window("pill") {
            if show {
                // Only show pill if main window is hidden
                let main_visible = app.get_webview_window("main")
                    .and_then(|w| w.is_visible().ok()).unwrap_or(true);
                if !main_visible { let _ = pill.show(); }
            } else {
                let _ = pill.hide();
            }
        }
    }

    // --- Debug logging toggle ---
    if let Some(debug) = patch.get("debugLogging").and_then(|v| v.as_bool()) {
        log.0.set_enabled(debug);
    }

    // --- Auto-start toggle ---
    if let Some(auto_start) = patch.get("autoStart").and_then(|v| v.as_bool()) {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        if auto_start { let _ = manager.enable(); } else { let _ = manager.disable(); }
    }

    // --- Hotkey re-registration ---
    if let Some(new_hotkey) = patch.get("hotkey").and_then(|v| v.as_str()) {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        // Unregister all existing shortcuts, re-register the new one
        let _ = app.global_shortcut().unregister_all();
        let normalized = new_hotkey.to_lowercase().replace(" ", "");
        let hk_app = app.clone();
        let reg_result = app.global_shortcut().on_shortcut(normalized.as_str(), move |_a, _s, event| {
            use tauri_plugin_global_shortcut::ShortcutState;
            if event.state == ShortcutState::Pressed {
                if let Some(w) = hk_app.get_webview_window("main") {
                    let _ = w.eval("triggerTrustedHotkeyToggle()");
                }
            }
        });
        if let Err(e) = reg_result {
            eprintln!("[hotkey] Failed to register '{}': {}", normalized, e);
        }
    }

    store.0.save_settings(patch);
    send_configure(&sc.0, &store.0);
    ResultPayload::ok()
}

#[tauri::command]
fn reset_settings(store: tauri::State<'_, AppStore>) -> ResultPayload {
    store.0.reset_settings();
    ResultPayload::ok()
}

// --- Recording commands ---

#[tauri::command]
fn start_recording(
    sm: tauri::State<'_, AppStateMachine>,
    store: tauri::State<'_, AppStore>,
    sc: tauri::State<'_, AppSidecar>,
    app: AppHandle,
) -> ResultPayload {
    let settings = store.0.get_settings();
    let mode = settings.get("mode").and_then(|v| v.as_str()).unwrap_or("api").to_string();
    let has_key = settings.get("openaiApiKey").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false)
        || settings.get("geminiApiKey").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);

    let gate = gate::can_accept_action(&sm.0, "start", has_key, &mode);
    if !gate.allowed {
        return ResultPayload::err(&gate.error.unwrap_or_default());
    }

    // Capture foreground window before recording
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

#[tauri::command]
fn stop_recording(
    sm: tauri::State<'_, AppStateMachine>,
    sc: tauri::State<'_, AppSidecar>,
    store: tauri::State<'_, AppStore>,
    app: AppHandle,
) -> ResultPayload {
    let gate = gate::can_accept_action(&sm.0, "stop", true, "api");
    if !gate.allowed {
        return ResultPayload::err(&gate.error.unwrap_or_default());
    }

    sm.0.transition(AppState::Processing, None);
    broadcast_state(&sm.0, &app, &store.0);

    // Block until sidecar responds (120s timeout) — matches Electron behavior
    match sc.0.send_sync("stop_rec", HashMap::new(), Duration::from_secs(120)) {
        Ok(_resp) => ResultPayload::ok(),
        Err(e) => {
            eprintln!("[stop_recording] sidecar error: {}", e);
            ResultPayload::err(&e)
        }
    }
}

#[tauri::command]
fn cancel_processing(
    sm: tauri::State<'_, AppStateMachine>,
    sc: tauri::State<'_, AppSidecar>,
    store: tauri::State<'_, AppStore>,
    app: AppHandle,
) -> ResultPayload {
    let gate = gate::can_accept_action(&sm.0, "cancel", true, "api");
    if !gate.allowed {
        return ResultPayload::err(&gate.error.unwrap_or_default());
    }

    sm.0.transition(AppState::Dormant, None);
    broadcast_state(&sm.0, &app, &store.0);

    let _ = sc.0.send("cancel", HashMap::new(), |_| {});

    ResultPayload::ok()
}

// --- History commands ---

#[tauri::command]
fn get_history(store: tauri::State<'_, AppStore>) -> Vec<Value> {
    store.0.get_history()
}

#[tauri::command]
fn delete_history(store: tauri::State<'_, AppStore>, id: String) -> ResultPayload {
    let history = store.0.get_history();
    if let Some(entry) = history.iter().find(|e| e.get("id").and_then(|v| v.as_str()) == Some(&id)) {
        if let Some(path) = entry.get("audio_file").and_then(|v| v.as_str()) {
            let _ = std::fs::remove_file(path);
        }
    }
    store.0.delete_history(&id);
    ResultPayload::ok()
}

#[tauri::command]
fn clear_history(store: tauri::State<'_, AppStore>) -> ResultPayload {
    let history = store.0.get_history();
    for entry in &history {
        if let Some(path) = entry.get("audio_file").and_then(|v| v.as_str()) {
            let _ = std::fs::remove_file(path);
        }
    }
    store.0.clear_history();
    ResultPayload::ok()
}

// --- Sidecar proxy commands (synchronous — wait for real response) ---

#[tauri::command]
fn list_models(sc: tauri::State<'_, AppSidecar>) -> Value {
    match sc.0.send_sync("list_models", HashMap::new(), SIDECAR_TIMEOUT) {
        Ok(resp) => {
            // Engine sends {id, status, models: [...]} — models is in extra, not data
            if let Some(models) = resp.extra.get("models") {
                serde_json::json!({ "models": models })
            } else {
                resp.data.unwrap_or(serde_json::json!({ "models": [] }))
            }
        }
        Err(e) => {
            eprintln!("[list_models] {}", e);
            serde_json::json!({ "models": [], "error": e })
        }
    }
}

#[tauri::command]
fn list_mics(sc: tauri::State<'_, AppSidecar>) -> Value {
    match sc.0.send_sync("list_mics", HashMap::new(), SIDECAR_TIMEOUT) {
        Ok(resp) => {
            // Engine sends {id, status, mics: [...]} — mics is in extra, not data
            if let Some(mics) = resp.extra.get("mics") {
                serde_json::json!({ "mics": mics })
            } else {
                resp.data.unwrap_or(serde_json::json!({ "mics": [] }))
            }
        }
        Err(e) => {
            eprintln!("[list_mics] {}", e);
            serde_json::json!({ "mics": [], "error": e })
        }
    }
}

/// Long timeout for model downloads (10 minutes — matches Electron)
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);

#[tauri::command]
fn download_model(sc: tauri::State<'_, AppSidecar>, name: String) -> ResultPayload {
    let mut params = HashMap::new();
    params.insert("model_name".to_string(), Value::String(name.clone()));
    // Block until download completes or fails (matches Electron behavior)
    match sc.0.send_sync("download_model", params, DOWNLOAD_TIMEOUT) {
        Ok(resp) => {
            if let Some(err) = &resp.error {
                eprintln!("[download_model] sidecar error: {}", err);
                ResultPayload::err(err)
            } else {
                println!("[download_model] completed for '{}'", name);
                ResultPayload::ok()
            }
        }
        Err(e) => {
            eprintln!("[download_model] failed: {}", e);
            ResultPayload::err(&e)
        }
    }
}

#[tauri::command]
fn delete_model(sc: tauri::State<'_, AppSidecar>, name: String) -> ResultPayload {
    let mut params = HashMap::new();
    params.insert("model_name".to_string(), Value::String(name));
    let _ = sc.0.send("delete_model", params, |_| {});
    ResultPayload::ok()
}

#[tauri::command]
fn set_mic(sc: tauri::State<'_, AppSidecar>, id: i32) -> ResultPayload {
    let mut params = HashMap::new();
    params.insert("device_id".to_string(), Value::Number(id.into()));
    let _ = sc.0.send("set_mic", params, |_| {});
    ResultPayload::ok()
}

#[tauri::command]
fn verify_api_key(sc: tauri::State<'_, AppSidecar>, provider: String, key: String, base_url: Option<String>) -> Value {
    let mut params = HashMap::new();
    params.insert("provider".to_string(), Value::String(provider));
    params.insert("api_key".to_string(), Value::String(key));
    params.insert("base_url".to_string(), Value::String(base_url.unwrap_or_default()));
    match sc.0.send_sync("verify_key", params, SIDECAR_TIMEOUT) {
        Ok(resp) => {
            // Engine sends {status, success, valid, http_status, error} as top-level keys (in resp.extra)
            let valid = resp.extra.get("valid").and_then(|v| v.as_bool()).unwrap_or(false);
            let success = resp.extra.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            let error = resp.extra.get("error").and_then(|v| v.as_str()).map(|s| s.to_string());
            let mut result = serde_json::json!({ "success": success, "valid": valid });
            if let Some(err) = error {
                result["error"] = serde_json::Value::String(err);
            }
            result
        }
        Err(e) => {
            eprintln!("[verify_api_key] {}", e);
            serde_json::json!({ "success": false, "error": e })
        }
    }
}

// --- API key secure storage commands ---

#[tauri::command]
fn store_api_key(provider: String, key: String) -> ResultPayload {
    match encryption::store_key(&format!("apikey-{}", provider), &key) {
        Ok(_) => ResultPayload::ok(),
        Err(e) => ResultPayload::err(&e),
    }
}

#[tauri::command]
fn get_api_key(provider: String) -> Value {
    match encryption::get_key(&format!("apikey-{}", provider)) {
        Ok(Some(key)) => serde_json::json!({ "key": key }),
        Ok(None) => Value::Null,
        Err(_) => Value::Null,
    }
}

#[tauri::command]
fn delete_api_key(provider: String) -> ResultPayload {
    match encryption::delete_key(&format!("apikey-{}", provider)) {
        Ok(_) => ResultPayload::ok(),
        Err(e) => ResultPayload::err(&e),
    }
}

// --- Auto-start commands ---

#[tauri::command]
fn set_auto_start(app: AppHandle, enabled: bool) -> ResultPayload {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let result = if enabled { manager.enable() } else { manager.disable() };
    match result {
        Ok(_) => ResultPayload::ok(),
        Err(e) => ResultPayload::err(&format!("autostart error: {}", e)),
    }
}

#[tauri::command]
fn get_auto_start(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

// --- Updater commands ---

#[tauri::command]
async fn check_for_update(app: AppHandle) -> Value {
    use tauri_plugin_updater::UpdaterExt;
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return serde_json::json!({ "available": false, "error": format!("{}", e) }),
    };
    match updater.check().await {
        Ok(Some(update)) => {
            serde_json::json!({
                "available": true,
                "version": update.version,
                "body": update.body,
            })
        }
        Ok(None) => serde_json::json!({ "available": false }),
        Err(e) => serde_json::json!({ "available": false, "error": format!("{}", e) }),
    }
}

// TODO: Implement update-marker.json for post-update success notification
// (Electron writes a marker before install, checks on next launch)
// TODO: Add native notification when update is downloaded
// Requires tauri-plugin-notification

#[tauri::command]
async fn install_update(app: AppHandle) -> ResultPayload {
    use tauri_plugin_updater::UpdaterExt;
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return ResultPayload::err(&format!("{}", e)),
    };
    match updater.check().await {
        Ok(Some(update)) => {
            match update.download_and_install(|_downloaded, _total| {}, || {}).await {
                Ok(_) => {
                    // restart() never returns, but we satisfy the type checker
                    app.restart();
                    #[allow(unreachable_code)]
                    ResultPayload::ok()
                }
                Err(e) => ResultPayload::err(&format!("{}", e)),
            }
        }
        Ok(None) => ResultPayload::err("No update available"),
        Err(e) => ResultPayload::err(&format!("{}", e)),
    }
}

// --- Utility commands ---

#[tauri::command]
fn get_audio(store: tauri::State<'_, AppStore>, id: String) -> Value {
    let history = store.0.get_history();
    if let Some(entry) = history.iter().find(|e| e.get("id").and_then(|v| v.as_str()) == Some(&id)) {
        if let Some(audio_path) = entry.get("audio_file").and_then(|v| v.as_str()) {
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

#[tauri::command]
fn export_transcription(app: AppHandle, text: String, format: String) -> ResultPayload {
    use tauri_plugin_dialog::DialogExt;
    let ext = if format == "md" { "md" } else { "txt" };
    app.dialog().file()
        .set_file_name(&format!("transcription.{}", ext))
        .save_file(move |path| {
            if let Some(path) = path {
                let _ = std::fs::write(path.as_path().unwrap(), &text);
            }
        });
    // Note: returns immediately — dialog save is async via Tauri plugin callback.
    // Frontend does not depend on export result.
    ResultPayload::ok()
}

#[tauri::command]
fn paste_last_transcript(store: tauri::State<'_, AppStore>, app: AppHandle) -> ResultPayload {
    let history = store.0.get_history();
    if let Some(entry) = history.first() {
        if let Some(text) = entry.get("text").and_then(|v| v.as_str()) {
            let _ = app.clipboard().write_text(text);
            return ResultPayload::ok_with_text(text);
        }
    }
    ResultPayload::err("No transcriptions")
}

#[tauri::command]
fn copy_to_clipboard(app: AppHandle, text: String) -> ResultPayload {
    match app.clipboard().write_text(text) {
        Ok(_) => ResultPayload::ok(),
        Err(e) => ResultPayload::err(&format!("Clipboard write failed: {}", e)),
    }
}

#[tauri::command]
fn simulate_enter() -> ResultPayload {
    let _ = system::simulate_enter_key();
    ResultPayload::ok()
}

// JS console → Rust stdout bridge (so we can see browser errors)
#[tauri::command]
fn js_log(level: String, msg: String) {
    eprintln!("[js:{}] {}", level, msg);
}

#[tauri::command]
fn get_app_info() -> Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "isDev": cfg!(debug_assertions),
    })
}

// --- Window commands (pill + main) ---

#[tauri::command]
fn toggle_pill(app: AppHandle) -> ResultPayload {
    if let Some(pill) = app.get_webview_window("pill") {
        if pill.is_visible().unwrap_or(false) {
            let _ = pill.hide();
        } else {
            let _ = pill.show();
        }
    }
    ResultPayload::ok()
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> ResultPayload {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    ResultPayload::ok()
}

#[tauri::command]
fn show_settings(app: AppHandle) -> ResultPayload {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.eval("openSettingsDrawer()");
    }
    ResultPayload::ok()
}

#[tauri::command]
fn hide_pill(app: AppHandle, store: tauri::State<'_, AppStore>) -> ResultPayload {
    if let Some(pill) = app.get_webview_window("pill") {
        let _ = pill.hide();
    }
    let mut patch = serde_json::Map::new();
    patch.insert("showPill".into(), serde_json::Value::Bool(false));
    store.0.save_settings(patch);
    let _ = app.emit("pill-hidden", &());
    ResultPayload::ok()
}

#[tauri::command]
fn pill_clicked(
    action: String,
    sm: tauri::State<'_, AppStateMachine>,
    sc: tauri::State<'_, AppSidecar>,
    store: tauri::State<'_, AppStore>,
    app: AppHandle,
) -> ResultPayload {
    match action.as_str() {
        "enter" => {
            sm.0.transition(AppState::Dormant, None);
            broadcast_state(&sm.0, &app, &store.0);
            let _ = system::simulate_enter_key();
            ResultPayload::ok()
        }
        "stop" => {
            let gate = gate::can_accept_action(&sm.0, "stop", true, "api");
            if !gate.allowed { return ResultPayload::ok(); }
            sm.0.transition(AppState::Processing, None);
            broadcast_state(&sm.0, &app, &store.0);
            let _ = sc.0.send("stop_rec", HashMap::new(), |_| {});
            ResultPayload::ok()
        }
        "cancel" => {
            let gate = gate::can_accept_action(&sm.0, "cancel", true, "api");
            if !gate.allowed { return ResultPayload::ok(); }
            sm.0.transition(AppState::Dormant, None);
            broadcast_state(&sm.0, &app, &store.0);
            let _ = sc.0.send("cancel", HashMap::new(), |_| {});
            ResultPayload::ok()
        }
        _ => {
            let gate = gate::can_accept_action(&sm.0, "toggle", true, "api");
            if !gate.allowed { return ResultPayload::ok(); }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval("triggerTrustedHotkeyToggle()");
            }
            ResultPayload::ok()
        }
    }
}

#[tauri::command]
fn pill_set_ignore_mouse(app: AppHandle, ignore: bool) -> ResultPayload {
    if let Some(pill) = app.get_webview_window("pill") {
        let _ = pill.set_ignore_cursor_events(ignore);
    }
    ResultPayload::ok()
}

#[tauri::command]
fn pill_context_menu() -> ResultPayload {
    // Context menu is handled by the tray — pill right-click just shows tray menu
    ResultPayload::ok()
}

#[tauri::command]
fn window_minimize(window: tauri::Window) -> ResultPayload {
    let _ = window.minimize();
    ResultPayload::ok()
}

#[tauri::command]
fn window_maximize(window: tauri::Window) -> ResultPayload {
    if window.is_maximized().unwrap_or(false) { let _ = window.unmaximize(); }
    else { let _ = window.maximize(); }
    ResultPayload::ok()
}

#[tauri::command]
fn window_close(window: tauri::Window) -> ResultPayload {
    let _ = window.close();
    ResultPayload::ok()
}

#[tauri::command]
fn window_is_maximized(window: tauri::Window) -> bool {
    window.is_maximized().unwrap_or(false)
}

// --- Multi-monitor commands ---

#[tauri::command]
fn get_displays(app: AppHandle) -> Value {
    let mut displays = Vec::new();
    if let Ok(monitors) = app.available_monitors() {
        for (i, mon) in monitors.iter().enumerate() {
            let size = mon.size();
            let pos = mon.position();
            let name = mon.name().map(|s| s.as_str()).unwrap_or("Unknown");
            displays.push(serde_json::json!({
                "index": i,
                "id": i,
                "label": name,
                "primary": i == 0,
                "width": size.width,
                "height": size.height,
                "x": pos.x,
                "y": pos.y,
            }));
        }
    }
    if displays.is_empty() {
        displays.push(serde_json::json!({ "index": 0, "id": 0, "label": "Primary", "primary": true }));
    }
    serde_json::json!(displays)
}

#[tauri::command]
fn move_pill_to_display(app: AppHandle, display_id: usize) -> ResultPayload {
    let monitors = match app.available_monitors() {
        Ok(m) => m,
        Err(_) => return ResultPayload::err("Failed to get monitors"),
    };
    let monitor = match monitors.get(display_id) {
        Some(m) => m,
        None => return ResultPayload::err("Display not found"),
    };
    if let Some(pill) = app.get_webview_window("pill") {
        let size = monitor.size();
        let pos = monitor.position();
        let scale = monitor.scale_factor();
        let screen_w = size.width as f64 / scale;
        let screen_h = size.height as f64 / scale;
        let pill_x = pos.x as f64 / scale + (screen_w - 220.0) / 2.0;
        let pill_y = pos.y as f64 / scale + screen_h - 140.0 - 10.0;
        let _ = pill.set_position(tauri::PhysicalPosition::new(
            (pill_x * scale) as i32,
            (pill_y * scale) as i32,
        ));
    }
    ResultPayload::ok()
}

// --- Helpers ---

fn broadcast_state(sm: &StateMachine, app: &AppHandle, store: &Store) {
    let settings = store.get_settings();
    let aem = settings.get("autoEnterMode").and_then(|v| v.as_str()).unwrap_or("off").to_string();
    let state = sm.state();
    let payload = StatePayload {
        state: state.to_string(),
        message: sm.message(),
        auto_enter_mode: aem.clone(),
    };
    let _ = app.emit("state-update", &payload);

    // Also send pill-render event for the pill window
    let pill_payload = build_pill_payload(sm, &aem);
    let _ = app.emit("pill-render", &pill_payload);

    // Update tray icon color + tooltip based on state
    update_tray_for_state(app, state);

    // Rebuild tray menu to reflect current state (dynamic labels, checked items, history)
    rebuild_tray_menu(app);
}

/// Build a dynamic tray menu reflecting current state, settings, and history.
/// Called on every state change and at tray creation time.
fn build_tray_menu(app: &AppHandle) -> Result<tauri::menu::Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, CheckMenuItemBuilder};

    // Read current state from managed state
    let sm_state = app.try_state::<AppStateMachine>()
        .map(|s| s.0.state())
        .unwrap_or(AppState::Dormant);
    let store = app.try_state::<AppStore>();
    let settings = store.as_ref().map(|s| s.0.get_settings()).unwrap_or_default();
    let history = store.as_ref().map(|s| s.0.get_history()).unwrap_or_default();

    let is_recording = sm_state == AppState::Recording;
    let is_processing = sm_state == AppState::Processing;
    let sound_enabled = settings.get("soundEnabled").and_then(|v| v.as_bool()).unwrap_or(true);
    let show_pill = settings.get("showPill").and_then(|v| v.as_bool()).unwrap_or(false);
    let hotkey = settings.get("hotkey").and_then(|v| v.as_str()).unwrap_or("Ctrl+Alt+R");
    let current_mode = settings.get("mode").and_then(|v| v.as_str()).unwrap_or("api");
    let mode_label = if current_mode == "local" { "Switch to API Mode" } else { "Switch to Local Mode" };

    let mut builder = MenuBuilder::new(app);

    // Show WhisperClick
    builder = builder.item(&MenuItemBuilder::with_id("show", "Show WhisperClick").build(app)?);
    builder = builder.separator();

    // Start/Stop Recording — dynamic label based on state
    let rec_label = if is_recording {
        "Stop Recording"
    } else if is_processing {
        "Processing..."
    } else {
        "Start Recording"
    };
    let rec_enabled = !is_processing;
    builder = builder.item(
        &MenuItemBuilder::with_id("toggle_recording", rec_label)
            .enabled(rec_enabled)
            .build(app)?
    );
    builder = builder.separator();

    // Mode toggle
    builder = builder.item(&MenuItemBuilder::with_id("toggle-mode", mode_label).build(app)?);

    // Sound Effects (checked)
    builder = builder.item(
        &CheckMenuItemBuilder::with_id("toggle-sound", "Sound Effects")
            .checked(sound_enabled)
            .build(app)?
    );

    // Show Pill Widget (checked)
    builder = builder.item(
        &CheckMenuItemBuilder::with_id("toggle-pill", "Show Pill Widget")
            .checked(show_pill)
            .build(app)?
    );
    builder = builder.separator();

    // Recent Transcriptions submenu (last 3 history entries, click to copy)
    if !history.is_empty() {
        let mut recent_sub = SubmenuBuilder::with_id(app, "recent", "Recent Transcriptions");
        for (i, entry) in history.iter().take(3).enumerate() {
            let text = entry.get("text").and_then(|v| v.as_str()).unwrap_or("(empty)");
            let truncated = if text.len() > 40 {
                // Safely truncate at char boundary
                let end = text.char_indices().take(40).last().map(|(i, c)| i + c.len_utf8()).unwrap_or(40);
                format!("{}...", &text[..end])
            } else {
                text.to_string()
            };
            recent_sub = recent_sub.item(
                &MenuItemBuilder::with_id(&format!("recent_{}", i), &truncated).build(app)?
            );
        }
        builder = builder.item(&recent_sub.build()?);

        // Paste Last Transcript
        builder = builder.item(
            &MenuItemBuilder::with_id("paste_last", "Paste Last Transcript").build(app)?
        );
    } else {
        // Show disabled "No transcriptions yet" entry
        let mut recent_sub = SubmenuBuilder::with_id(app, "recent", "Recent Transcriptions");
        recent_sub = recent_sub.item(
            &MenuItemBuilder::with_id("recent_none", "No transcriptions yet")
                .enabled(false)
                .build(app)?
        );
        builder = builder.item(&recent_sub.build()?);
    }
    builder = builder.separator();

    // Hotkey display (read-only)
    builder = builder.item(
        &MenuItemBuilder::with_id("hotkey-display", &format!("Hotkey: {}", hotkey))
            .enabled(false)
            .build(app)?
    );

    // Settings
    builder = builder.item(&MenuItemBuilder::with_id("settings", "Settings").build(app)?);
    builder = builder.separator();

    // Quit
    builder = builder.item(&MenuItemBuilder::with_id("quit", "Quit WhisperClick").build(app)?);

    Ok(builder.build()?)
}

/// Rebuild and replace the tray menu. Called after every state change.
fn rebuild_tray_menu(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        match build_tray_menu(app) {
            Ok(menu) => {
                let _ = tray.set_menu(Some(menu));
            }
            Err(e) => {
                eprintln!("[tray] Failed to rebuild menu: {}", e);
            }
        }
    }
}

fn update_tray_for_state(app: &AppHandle, state: AppState) {
    let tooltip = match state {
        AppState::Dormant => "WhisperClick — Ready",
        AppState::Recording => "WhisperClick — Recording...",
        AppState::Processing => "WhisperClick — Processing...",
        AppState::Success => "WhisperClick — Done!",
        AppState::Error => "WhisperClick — Error",
    };

    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(tooltip));

        // Tint the icon based on state
        let tint: [u8; 3] = match state {
            AppState::Dormant => [207, 150, 115],    // tan
            AppState::Recording => [220, 100, 80],    // red
            AppState::Processing => [207, 150, 115],  // tan
            AppState::Success => [163, 177, 138],     // green
            AppState::Error => [220, 100, 80],        // red
        };

        if let Some(icon) = tint_icon(tint) {
            let _ = tray.set_icon(Some(icon));
        }

        // Error flash: flash red icon for 2s then return to dormant color
        if state == AppState::Error {
            let flash_app = app.clone();
            std::thread::spawn(move || {
                // Flash pattern: red → dormant → red → dormant
                for _ in 0..2 {
                    std::thread::sleep(Duration::from_millis(500));
                    if let Some(tray) = flash_app.tray_by_id("main-tray") {
                        if let Some(icon) = tint_icon([207, 150, 115]) { // dormant color
                            let _ = tray.set_icon(Some(icon));
                        }
                    }
                    std::thread::sleep(Duration::from_millis(500));
                    if let Some(tray) = flash_app.tray_by_id("main-tray") {
                        if let Some(icon) = tint_icon([220, 100, 80]) { // error red
                            let _ = tray.set_icon(Some(icon));
                        }
                    }
                }
            });

            // Emit notification event for frontend to show toast
            let _ = app.emit("tray-error-notification", &serde_json::json!({
                "title": "WhisperClick Error",
                "body": tooltip,
            }));
        }
    }
}

fn tint_icon(tint: [u8; 3]) -> Option<tauri::image::Image<'static>> {
    let png_bytes = include_bytes!("../../../icons/icon.png");
    let img = image::load_from_memory(png_bytes).ok()?;
    let mut rgba = img.to_rgba8();

    // Apply tint: blend original with tint color, preserve alpha
    for pixel in rgba.pixels_mut() {
        let a = pixel[3] as f32 / 255.0;
        if a > 0.0 {
            // Luminance of original pixel
            let lum = (pixel[0] as f32 * 0.299 + pixel[1] as f32 * 0.587 + pixel[2] as f32 * 0.114) / 255.0;
            pixel[0] = (tint[0] as f32 * lum) as u8;
            pixel[1] = (tint[1] as f32 * lum) as u8;
            pixel[2] = (tint[2] as f32 * lum) as u8;
        }
    }

    let (w, h) = (rgba.width(), rgba.height());
    Some(tauri::image::Image::new_owned(rgba.into_raw(), w, h))
}

fn build_pill_payload(sm: &StateMachine, auto_enter_mode: &str) -> Value {
    let state = sm.state();
    let shape = match state {
        AppState::Dormant => "dormant",
        AppState::Recording => "recording",
        AppState::Processing => "processing",
        AppState::Success => "success",
        AppState::Error => "error",
    };
    serde_json::json!({
        "shape": shape,
        "level": 0,
        "autoEnterMode": auto_enter_mode,
        "message": sm.message(),
    })
}

fn send_configure(sc: &Sidecar, store: &Store) {
    let s = store.get_settings();

    // Pick the right API key based on provider (matches Electron's configureSidecar)
    let provider = s.get("provider").and_then(|v| v.as_str()).unwrap_or("openai");
    // Read real API key from keyring (not the '***secured***' marker in settings)
    let api_key = if provider == "gemini" {
        encryption::get_key("apikey-gemini").ok().flatten().unwrap_or_default()
    } else {
        encryption::get_key("apikey-openai").ok().flatten().unwrap_or_default()
    };

    // Transform camelCase store keys → snake_case engine keys (must match exactly)
    let mut params = HashMap::new();
    params.insert("mode".into(), Value::String(s.get("mode").and_then(|v| v.as_str()).unwrap_or("api").into()));
    params.insert("language".into(), Value::String(s.get("sourceLanguage").and_then(|v| v.as_str()).unwrap_or("auto").into()));
    params.insert("model".into(), Value::String(s.get("localModel").and_then(|v| v.as_str()).unwrap_or("base").into()));
    params.insert("provider".into(), Value::String(provider.into()));
    params.insert("api_key".into(), Value::String(api_key.into()));
    params.insert("base_url".into(), Value::String(s.get("customBaseUrl").and_then(|v| v.as_str()).unwrap_or("").into()));
    params.insert("api_model".into(), Value::String(s.get("apiModel").and_then(|v| v.as_str()).unwrap_or("whisper-1").into()));
    params.insert("sound_enabled".into(), Value::Bool(s.get("soundEnabled").and_then(|v| v.as_bool()).unwrap_or(true)));
    params.insert("output_mode".into(), Value::String(s.get("outputMode").and_then(|v| v.as_str()).unwrap_or("transcribe").into()));
    params.insert("target_language".into(), Value::String(s.get("targetLanguage").and_then(|v| v.as_str()).unwrap_or("en").into()));
    params.insert("source_language".into(), Value::String(s.get("sourceLanguage").and_then(|v| v.as_str()).unwrap_or("auto").into()));
    params.insert("audio_retention_days".into(), s.get("audioRetentionDays").cloned().unwrap_or(Value::Number(30.into())));

    let _ = sc.send("configure", params, |_| {});
}

fn create_pill_window(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::WebviewUrl;
    use tauri::webview::WebviewWindowBuilder;

    const PILL_WIDTH: f64 = 220.0;
    const PILL_HEIGHT: f64 = 140.0;

    let (pill_x, pill_y) = if let Some(monitor) = app.primary_monitor().ok().flatten() {
        let pos = monitor.position();
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let screen_w = size.width as f64 / scale;
        let screen_h = size.height as f64 / scale;
        let x = pos.x as f64 / scale + (screen_w - PILL_WIDTH) / 2.0;
        let y = pos.y as f64 / scale + screen_h - PILL_HEIGHT - 10.0;
        (x, y)
    } else {
        (400.0, 600.0)
    };

    let pill_url = WebviewUrl::App("../../shared/pill/pill.html".into());
    let pill_bridge_js = include_str!("../pill-bridge.js");
    let pill_win = WebviewWindowBuilder::new(app, "pill", pill_url)
        .title("") // empty title prevents taskbar entry on Windows
        .inner_size(PILL_WIDTH, PILL_HEIGHT)
        .position(pill_x, pill_y)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .shadow(false)
        .initialization_script(pill_bridge_js)
        .build()?;

    let _ = pill_win.set_ignore_cursor_events(true);
    println!("[pill] Window created at ({}, {})", pill_x as i32, pill_y as i32);
    Ok(())
}

fn find_python() -> String {
    // Try venv relative to the exe/project root first, then system python
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    // In dev: exe is in platforms/tauri/target/debug/, venv is at project root
    // Go up from exe dir to find venv
    let mut candidates: Vec<String> = Vec::new();
    if let Some(ref dir) = exe_dir {
        // From target/debug/ → ../../ → platforms/tauri/ → ../../ → project root
        let project_root = dir.join("../../../../venv/Scripts/python.exe");
        if let Ok(abs) = std::fs::canonicalize(&project_root) {
            candidates.push(abs.to_string_lossy().to_string());
        }
    }
    candidates.push("../../venv/Scripts/python.exe".to_string());
    candidates.push("python".to_string());
    candidates.push("python3".to_string());

    for candidate in &candidates {
        if std::process::Command::new(candidate).arg("--version").output().is_ok() {
            println!("[sidecar] Using python: {}", candidate);
            return candidate.to_string();
        }
    }
    println!("[sidecar] WARNING: No python found, falling back to 'python'");
    "python".to_string()
}

// --- App setup ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Settings store — Tauri/com.whisperclick.{app|dev} (mirrors Electron/whisperclick-{dev})
            let is_dev = cfg!(debug_assertions);
            let base = app.path().app_config_dir().unwrap_or(PathBuf::from("."));
            // Go up from default (e.g. %APPDATA%/com.whisperclick.tauri) to %APPDATA%
            let roaming = base.parent().unwrap_or(&base).to_path_buf();
            let sub = if is_dev { "com.whisperclick.dev" } else { "com.whisperclick.app" };
            let config_dir = roaming.join("Tauri").join(sub);
            let store = Arc::new(Store::new(config_dir.clone(), is_dev));
            let store_for_events = store.clone();
            let store_for_ready = store.clone();
            app.manage(AppStore(store.clone()));

            // File logger (managed state so save_settings can toggle it)
            let debug_enabled = store.get_settings()
                .get("debugLogging").and_then(|v| v.as_bool()).unwrap_or(false) || is_dev;
            let file_logger = Arc::new(logger::Logger::new(&config_dir, debug_enabled));
            file_logger.info("app", &format!("WhisperClick starting (dev={})", is_dev));
            app.manage(AppLogger(file_logger));

            // State machine (Arc for sharing with sidecar event handler)
            let sm = Arc::new(StateMachine::new());
            let sm_for_events = sm.clone();
            app.manage(AppStateMachine(sm));

            // Sidecar — spawn Python engine
            let engine_path = std::env::current_dir()
                .unwrap_or_default()
                .join("../../shared/engine/engine.py")
                .to_string_lossy()
                .to_string();
            let python = find_python();
            let sc = Arc::new(Sidecar::new(engine_path, python));
            let sc_for_ready = sc.clone();

            // Sidecar event handler — THE CRITICAL WIRING
            let app_handle = app.handle().clone();
            sc.on_event(move |event, data| {
                match event.as_str() {
                    "ready" => {
                        println!("[sidecar] ready — sending configure");
                        send_configure(&sc_for_ready, &store_for_ready);
                    }
                    "transcription" => {
                        let text = data.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        println!("[sidecar] transcription: {} chars", text.len());

                        // 1. Transition to success
                        sm_for_events.transition(AppState::Success, None);

                        // 2. Add to history (includes translation + audio_file fields)
                        if !text.is_empty() {
                            let entry = serde_json::json!({
                                "id": uuid::Uuid::new_v4().to_string(),
                                "text": text,
                                "timestamp": chrono::Utc::now().to_rfc3339(),
                                "duration": data.get("duration").unwrap_or(&Value::Number(0.into())),
                                "transcriptionTime": data.get("transcription_time").unwrap_or(&Value::Number(0.into())),
                                "provider": data.get("provider").unwrap_or(&Value::String("unknown".into())),
                                "model": data.get("model").unwrap_or(&Value::String("unknown".into())),
                                "language": data.get("language").unwrap_or(&Value::String("auto".into())),
                                "translation": data.get("translation").unwrap_or(&Value::Null),
                                "audio_file": data.get("audio_file").unwrap_or(&Value::Null),
                            });
                            store_for_events.add_history(entry);

                            // 3. Copy to clipboard + auto-paste
                            let settings = store_for_events.get_settings();
                            let auto_paste = settings.get("autoPaste")
                                .and_then(|v| v.as_bool()).unwrap_or(true);
                            let auto_enter = settings.get("autoEnterMode")
                                .and_then(|v| v.as_str()).unwrap_or("off").to_string();

                            // Use translation text for paste if available
                            let paste_text = data.get("translation")
                                .and_then(|v| v.as_str())
                                .filter(|s| !s.is_empty())
                                .unwrap_or(&text)
                                .to_string();

                            if auto_paste {
                                let _ = app_handle.clipboard().write_text(&paste_text);
                                let text_for_paste = paste_text.clone();
                                let enter_mode = auto_enter.clone();
                                std::thread::spawn(move || {
                                    std::thread::sleep(Duration::from_millis(150));
                                    let _ = system::simulate_paste();

                                    // Auto-enter if configured
                                    if enter_mode == "auto" {
                                        let char_delay = std::cmp::min(300 + (text_for_paste.len() * 5), 3000);
                                        std::thread::sleep(Duration::from_millis(char_delay as u64));
                                        let _ = system::simulate_enter_key();
                                    }
                                });
                            }

                            // Emit translation event if present
                            if data.get("translation").and_then(|v| v.as_str()).is_some() {
                                let _ = app_handle.emit("translation", &data);
                            }
                        }

                        // 4. Emit transcription event to frontend
                        let _ = app_handle.emit("transcription", &data);

                        // 5. Broadcast state (includes pill-render)
                        broadcast_state(&sm_for_events, &app_handle, &store_for_events);

                        // 6. Fallback timer to dormant
                        // Normal: 1.5s, Enter-button mode: 6s (matches Electron)
                        let settings = store_for_events.get_settings();
                        let auto_enter = settings.get("autoEnterMode")
                            .and_then(|v| v.as_str()).unwrap_or("off");
                        let fallback_ms = if auto_enter == "button" { 6000 } else { 1500 };

                        let timer_sm = sm_for_events.clone();
                        let timer_app = app_handle.clone();
                        let timer_store = store_for_events.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(fallback_ms));
                            if timer_sm.is(&[AppState::Success]) {
                                timer_sm.transition(AppState::Dormant, None);
                                broadcast_state(&timer_sm, &timer_app, &timer_store);
                            }
                        });
                    }
                    "level" => {
                        if let Some(level) = data.get("level") {
                            let _ = app_handle.emit("level-update", level);
                        }
                    }
                    "error" => {
                        let msg = data.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error");
                        println!("[sidecar] error: {}", msg);
                        sm_for_events.transition(AppState::Error, Some(msg));
                        let _ = app_handle.emit("sidecar-error", &data);
                        broadcast_state(&sm_for_events, &app_handle, &store_for_events);

                        // Error fallback timer (3s)
                        let timer_sm = sm_for_events.clone();
                        let timer_app = app_handle.clone();
                        let timer_store = store_for_events.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(3000));
                            if timer_sm.is(&[AppState::Error]) {
                                timer_sm.transition(AppState::Dormant, None);
                                broadcast_state(&timer_sm, &timer_app, &timer_store);
                            }
                        });
                    }
                    "cancelled" => {
                        println!("[sidecar] cancelled");
                        sm_for_events.transition(AppState::Dormant, None);
                        broadcast_state(&sm_for_events, &app_handle, &store_for_events);
                    }
                    "translation" => {
                        let _ = app_handle.emit("translation", &data);
                    }
                    "model_download_progress" => {
                        println!("[sidecar] download progress: {}", data);
                        let _ = app_handle.emit("model-download-progress", &data);
                    }
                    _ => {
                        println!("[sidecar] unknown event: {}", event);
                    }
                }
            });

            if let Err(e) = sc.start() {
                eprintln!("[sidecar] Failed to start: {}", e);
            }

            // Sidecar health monitor — auto-restart with max 3 attempts + exponential backoff
            let monitor_sc = sc.clone();
            let monitor_app = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(5)); // initial wait
                let mut restart_count = 0u32;
                const MAX_RESTARTS: u32 = 3;
                loop {
                    std::thread::sleep(Duration::from_secs(2));
                    if !monitor_sc.is_running() {
                        // Reset state if recording/processing was active when sidecar crashed
                        if let Some(sm) = monitor_app.try_state::<AppStateMachine>() {
                            if sm.0.is(&[AppState::Recording, AppState::Processing]) {
                                sm.0.transition(AppState::Error, Some("Backend crashed — restarting..."));
                                if let Some(store) = monitor_app.try_state::<AppStore>() {
                                    broadcast_state(&sm.0, &monitor_app, &store.0);
                                }
                            }
                        }
                        if restart_count >= MAX_RESTARTS {
                            eprintln!("[monitor] Sidecar died — max restarts ({}) reached, giving up", MAX_RESTARTS);
                            break;
                        }
                        restart_count += 1;
                        let backoff = restart_count as u64; // 1s, 2s, 3s
                        println!("[monitor] Sidecar died — restart attempt {}/{} ({}s backoff)", restart_count, MAX_RESTARTS, backoff);
                        std::thread::sleep(Duration::from_secs(backoff));
                        match monitor_sc.restart() {
                            Ok(_) => {
                                println!("[monitor] Restart succeeded");
                                restart_count = 0; // reset on success
                            }
                            Err(e) => eprintln!("[monitor] Restart failed: {}", e),
                        }
                    }
                }
            });

            app.manage(AppSidecar(sc));

            // --- Main window (responsive sizing + bridge.js injection) ---
            {
                use tauri::WebviewUrl;
                use tauri::webview::WebviewWindowBuilder;

                // Responsive sizing: 22% of primary monitor width, clamped [480, 650]
                let (win_w, win_h) = if let Some(monitor) = app.primary_monitor().ok().flatten() {
                    let screen_w = monitor.size().width as f64 / monitor.scale_factor();
                    let w = (screen_w * 0.22).max(480.0).min(650.0);
                    let h = (w * 1.58).min(1000.0);
                    (w, h)
                } else {
                    (560.0, 680.0)
                };

                let settings = store.get_settings();
                let always_on_top = settings.get("alwaysOnTop")
                    .and_then(|v| v.as_bool()).unwrap_or(false);
                let theme = settings.get("theme")
                    .and_then(|v| v.as_str()).unwrap_or("dark");
                let _bg_color = if theme == "light" { "#F5F5F4" } else { "#1C1917" };

                let main_url = WebviewUrl::App("index.html".into());
                let bridge_js = include_str!("../bridge.js");
                match WebviewWindowBuilder::new(app, "main", main_url)
                    .title("WhisperClick")
                    .inner_size(win_w, win_h)
                    .min_inner_size(480.0, 218.0)
                    .resizable(true)
                    .decorations(false) // frameless — custom HTML title bar + buttons
                    .shadow(true) // restore window shadow lost by removing decorations
                    .always_on_top(always_on_top)
                    .visible(false)
                    .initialization_script(bridge_js)
                    .build()
                {
                    Ok(w) => {
                        // Open DevTools in debug builds so we can see JS errors
                        #[cfg(debug_assertions)]
                        w.open_devtools();
                        // Show main window after content loads
                        let _ = w.show();
                        println!("[main] Window created ({}x{}, aot={}, theme={})", win_w as u32, win_h as u32, always_on_top, theme);
                    }
                    Err(e) => eprintln!("[main] Failed to create window: {}", e),
                }
            }

            // --- Pill window (only created if showPill is enabled) ---
            {
                let show_pill = store.get_settings()
                    .get("showPill").and_then(|v| v.as_bool()).unwrap_or(false);
                if show_pill {
                    create_pill_window(app)?;
                } else {
                    println!("[pill] Deferred — showPill is false");
                }
            }

            // --- Pill visibility sync: show pill when main hides, hide when main shows ---
            {
                let pill_app = app.handle().clone();
                let store_for_pill = store.clone();
                app.listen("tauri://window-event", move |event: tauri::Event| {
                    let payload = event.payload();
                    if payload.contains("Minimized") || payload.contains("Hidden") {
                        // Main window hidden/minimized → show pill (if enabled)
                        let show_pill = store_for_pill.get_settings()
                            .get("showPill").and_then(|v| v.as_bool()).unwrap_or(false);
                        if show_pill {
                            if let Some(pill) = pill_app.get_webview_window("pill") {
                                let _ = pill.show();
                            }
                        }
                    } else if payload.contains("Focused") || payload.contains("Shown") {
                        // Main window shown/focused → hide pill
                        let show_pill = store_for_pill.get_settings()
                            .get("showPill").and_then(|v| v.as_bool()).unwrap_or(false);
                        if show_pill {
                            if let Some(pill) = pill_app.get_webview_window("pill") {
                                let _ = pill.hide();
                            }
                        }

                        // Reset settings drawer on window show (matches Electron behavior)
                        if let Some(w) = pill_app.get_webview_window("main") {
                            let _ = w.eval("if (typeof closeSettingsDrawer === 'function') closeSettingsDrawer();");
                        }

                        // Broadcast current state so UI reflects recording state after returning from tray
                        if let Some(sm) = pill_app.try_state::<AppStateMachine>() {
                            broadcast_state(&sm.0, &pill_app, &store_for_pill);
                        }
                    }
                });
            }

            // --- System tray icon (dynamic menu, mode-aware click) ---
            {
                use tauri::tray::TrayIconBuilder;

                // Build initial menu dynamically from current state/settings/history
                let tray_menu = build_tray_menu(app.handle())
                    .expect("Failed to build initial tray menu");

                let icon = app.default_window_icon().cloned()
                    .expect("No default icon — check bundle.icon in tauri.conf.json");

                let _tray = TrayIconBuilder::with_id("main-tray")
                    .icon(icon)
                    .menu(&tray_menu)
                    .tooltip("WhisperClick — Ready")
                    .on_menu_event(|app, event| {
                        let id = event.id().as_ref().to_string();
                        match id.as_str() {
                            "show" => {
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                            "toggle_recording" => {
                                // Single dynamic item replaces start-recording/stop-recording
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.eval("triggerTrustedHotkeyToggle()");
                                }
                            }
                            "toggle-mode" => {
                                if let Some(s) = app.try_state::<AppStore>() {
                                    let settings = s.0.get_settings();
                                    let current = settings.get("mode").and_then(|v| v.as_str()).unwrap_or("api");
                                    let new_mode = if current == "local" { "api" } else { "local" };
                                    let mut patch = serde_json::Map::new();
                                    patch.insert("mode".into(), Value::String(new_mode.to_string()));
                                    s.0.save_settings(patch);
                                    // Rebuild menu to reflect mode label change
                                    rebuild_tray_menu(app);
                                }
                            }
                            "toggle-sound" => {
                                if let Some(s) = app.try_state::<AppStore>() {
                                    let current = s.0.get_settings()
                                        .get("soundEnabled").and_then(|v| v.as_bool()).unwrap_or(true);
                                    let mut patch = serde_json::Map::new();
                                    patch.insert("soundEnabled".into(), Value::Bool(!current));
                                    s.0.save_settings(patch);
                                    // Rebuild menu to reflect checked state
                                    rebuild_tray_menu(app);
                                }
                            }
                            "toggle-pill" => {
                                if let Some(s) = app.try_state::<AppStore>() {
                                    let current = s.0.get_settings()
                                        .get("showPill").and_then(|v| v.as_bool()).unwrap_or(false);
                                    let mut patch = serde_json::Map::new();
                                    patch.insert("showPill".into(), Value::Bool(!current));
                                    s.0.save_settings(patch);
                                    // Apply immediately
                                    if let Some(pill) = app.get_webview_window("pill") {
                                        if !current { let _ = pill.show(); } else { let _ = pill.hide(); }
                                    }
                                    // Rebuild menu to reflect checked state
                                    rebuild_tray_menu(app);
                                }
                            }
                            "paste_last" => {
                                // Copy first history entry to clipboard and simulate paste
                                if let Some(s) = app.try_state::<AppStore>() {
                                    let history = s.0.get_history();
                                    if let Some(entry) = history.first() {
                                        if let Some(text) = entry.get("text").and_then(|v| v.as_str()) {
                                            let _ = app.clipboard().write_text(text);
                                            std::thread::spawn(|| {
                                                std::thread::sleep(Duration::from_millis(150));
                                                let _ = system::simulate_paste();
                                            });
                                        }
                                    }
                                }
                            }
                            "settings" => {
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                    let _ = w.eval("openSettingsDrawer()");
                                }
                            }
                            "quit" => {
                                // Graceful sidecar shutdown before quit
                                if let Some(sc) = app.try_state::<AppSidecar>() {
                                    sc.0.kill();
                                }
                                // Unregister global shortcuts
                                {
                                    use tauri_plugin_global_shortcut::GlobalShortcutExt;
                                    let _ = app.global_shortcut().unregister_all();
                                }
                                app.exit(0);
                            }
                            other => {
                                // Handle recent_N items (click to copy to clipboard)
                                if let Some(idx_str) = other.strip_prefix("recent_") {
                                    if let Ok(idx) = idx_str.parse::<usize>() {
                                        if let Some(s) = app.try_state::<AppStore>() {
                                            let history = s.0.get_history();
                                            if let Some(entry) = history.get(idx) {
                                                if let Some(text) = entry.get("text").and_then(|v| v.as_str()) {
                                                    let _ = app.clipboard().write_text(text);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        use tauri::tray::{TrayIconEvent, MouseButton, MouseButtonState};
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            // Check trayClickAction setting
                            let action = app.try_state::<AppStore>()
                                .map(|s| s.0.get_settings()
                                    .get("trayClickAction").and_then(|v| v.as_str().map(String::from))
                                    .unwrap_or_else(|| "show".to_string()))
                                .unwrap_or_else(|| "show".to_string());

                            if action == "record" {
                                // Toggle recording (like hotkey)
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.eval("triggerTrustedHotkeyToggle()");
                                }
                            } else {
                                // Show window (default)
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                    })
                    .build(app)?;

                println!("[tray] System tray created (dynamic menu)");
            }

            // --- Global hotkey (from settings, not hardcoded) ---
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
                let hotkey_str = store.get_settings()
                    .get("hotkey").and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_else(|| "ctrl+alt+r".to_string())
                    .to_lowercase()
                    .replace(" ", "");
                // Debounce: 300ms between hotkey fires (prevents double-recording)
                use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
                let last_hotkey = Arc::new(AtomicU64::new(0));

                let register_hotkey = |handle: &AppHandle, key: &str, debounce: Arc<AtomicU64>| -> Result<(), Box<dyn std::error::Error>> {
                    let hk_app = handle.clone();
                    handle.global_shortcut().on_shortcut(key, move |_app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
                            let prev = debounce.swap(now, AtomicOrdering::Relaxed);
                            if now - prev < 300 {
                                println!("[hotkey] debounced ({}ms)", now - prev);
                                return;
                            }
                            println!("[hotkey] pressed");
                            if let Some(w) = hk_app.get_webview_window("main") {
                                let _ = w.eval("triggerTrustedHotkeyToggle()");
                            }
                        }
                    })?;
                    Ok(())
                };

                if let Err(e) = register_hotkey(app.handle(), &hotkey_str, last_hotkey.clone()) {
                    eprintln!("[hotkey] Failed to register '{}': {} — falling back to ctrl+alt+r", hotkey_str, e);
                    let _ = register_hotkey(app.handle(), "ctrl+alt+r", last_hotkey);
                }
            }

            // --- Update auto-polling (10s startup delay, then every 4 hours) ---
            {
                let update_app = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(10)); // initial delay
                    loop {
                        println!("[updater] Checking for updates...");
                        let _ = update_app.emit("update-check-started", &());
                        // Note: actual check happens via frontend calling check_for_update()
                        // We just emit an event to trigger the frontend's update check
                        let _ = update_app.emit("auto-update-check", &());
                        std::thread::sleep(Duration::from_secs(4 * 60 * 60)); // 4 hours
                    }
                });
            }

            Ok(())
        })
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus main window when a second instance tries to launch
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // Respect closeBehavior setting: "tray" hides, "close" quits
                    let behavior = window.app_handle().try_state::<AppStore>()
                        .and_then(|store| store.0.get_settings().get("closeBehavior").cloned())
                        .and_then(|v| v.as_str().map(|s| s.to_string()))
                        .unwrap_or_else(|| "tray".to_string());
                    if behavior == "tray" {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        // "close" behavior: cleanup before app exits
                        let app_handle = window.app_handle();
                        if let Some(sc) = app_handle.try_state::<AppSidecar>() {
                            sc.0.kill();
                        }
                        {
                            use tauri_plugin_global_shortcut::GlobalShortcutExt;
                            let _ = app_handle.global_shortcut().unregister_all();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_state, ack_state,
            get_settings, save_settings, reset_settings,
            start_recording, stop_recording, cancel_processing,
            get_history, delete_history, clear_history,
            get_audio, export_transcription, paste_last_transcript, copy_to_clipboard,
            list_models, download_model, delete_model,
            list_mics, set_mic, verify_api_key,
            store_api_key, get_api_key, delete_api_key,
            set_auto_start, get_auto_start,
            check_for_update, install_update,
            get_app_info, simulate_enter,
            toggle_pill, show_main_window, show_settings, hide_pill,
            pill_clicked, pill_set_ignore_mouse, pill_context_menu,
            window_minimize, window_maximize, window_close, window_is_maximized,
            get_displays, move_pill_to_display,
            js_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
