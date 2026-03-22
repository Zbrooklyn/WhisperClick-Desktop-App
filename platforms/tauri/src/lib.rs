mod gate;
mod sidecar;
mod state_machine;
mod store;
mod system;

use sidecar::Sidecar;
use state_machine::{AppState, StateMachine};
use store::Store;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder, WebviewUrl};
use serde::Serialize;
use serde_json::Value;

/// Managed state
pub struct AppStateMachine(pub StateMachine);
pub struct AppSidecar(pub Mutex<Option<Arc<Sidecar>>>);
pub struct AppStore(pub Store);

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
fn save_settings(store: tauri::State<'_, AppStore>, patch: serde_json::Map<String, Value>) -> ResultPayload {
    store.0.save_settings(patch);
    ResultPayload::ok()
}

#[tauri::command]
fn reset_settings(store: tauri::State<'_, AppStore>) -> ResultPayload {
    store.0.reset_settings();
    ResultPayload::ok()
}

// --- Recording commands (wired to sidecar) ---

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

    sm.0.transition(AppState::Recording, None);
    broadcast_state(&sm.0, &app, &store.0);

    // Send start_rec to sidecar
    let sidecar = sc.0.lock().unwrap();
    if let Some(ref sc) = *sidecar {
        let _ = sc.send("start_rec", HashMap::new(), |_| {});
    }

    ResultPayload::ok()
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

    // Send stop_rec to sidecar
    let sidecar = sc.0.lock().unwrap();
    if let Some(ref sc) = *sidecar {
        let _ = sc.send("stop_rec", HashMap::new(), |_| {});
    }

    ResultPayload::ok()
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

    let sidecar = sc.0.lock().unwrap();
    if let Some(ref sc) = *sidecar {
        let _ = sc.send("cancel", HashMap::new(), |_| {});
    }

    ResultPayload::ok()
}

// --- History commands ---

#[tauri::command]
fn get_history(store: tauri::State<'_, AppStore>) -> Vec<Value> {
    store.0.get_history()
}

#[tauri::command]
fn delete_history(store: tauri::State<'_, AppStore>, id: String) -> ResultPayload {
    store.0.delete_history(&id);
    ResultPayload::ok()
}

#[tauri::command]
fn clear_history(store: tauri::State<'_, AppStore>) -> ResultPayload {
    store.0.clear_history();
    ResultPayload::ok()
}

// --- Sidecar proxy commands ---

#[tauri::command]
fn list_models(sc: tauri::State<'_, AppSidecar>) -> Vec<Value> {
    // TODO: async sidecar call
    vec![]
}

#[tauri::command]
fn list_mics(sc: tauri::State<'_, AppSidecar>) -> Vec<Value> {
    vec![]
}

#[tauri::command]
fn download_model(_name: String) -> ResultPayload { ResultPayload::ok() }

#[tauri::command]
fn delete_model(_name: String) -> ResultPayload { ResultPayload::ok() }

#[tauri::command]
fn set_mic(_id: i32) -> ResultPayload { ResultPayload::ok() }

#[tauri::command]
fn verify_api_key(_provider: String, _key: String) -> ResultPayload { ResultPayload::ok() }

// --- Utility commands ---

#[tauri::command]
fn get_audio(_id: String) -> Option<String> { None }

#[tauri::command]
fn export_transcription(_text: String, _format: String) -> ResultPayload { ResultPayload::ok() }

#[tauri::command]
fn paste_last_transcript(store: tauri::State<'_, AppStore>) -> ResultPayload {
    let history = store.0.get_history();
    if let Some(entry) = history.first() {
        if let Some(text) = entry.get("text").and_then(|v| v.as_str()) {
            return ResultPayload::ok_with_text(text);
        }
    }
    ResultPayload::err("No transcriptions")
}

#[tauri::command]
fn copy_to_clipboard(app: AppHandle, text: String) -> ResultPayload {
    use tauri_plugin_clipboard_manager::ClipboardExt;
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

#[tauri::command]
fn get_app_info() -> Value {
    serde_json::json!({
        "version": "3.0.0-alpha",
        "platform": std::env::consts::OS,
    })
}

// --- Window commands ---

#[tauri::command]
fn toggle_pill() -> ResultPayload { ResultPayload::ok() }

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
fn hide_pill() -> ResultPayload { ResultPayload::ok() }

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
            let sidecar = sc.0.lock().unwrap();
            if let Some(ref s) = *sidecar { let _ = s.send("stop_rec", HashMap::new(), |_| {}); }
            ResultPayload::ok()
        }
        "cancel" => {
            let gate = gate::can_accept_action(&sm.0, "cancel", true, "api");
            if !gate.allowed { return ResultPayload::ok(); }
            sm.0.transition(AppState::Dormant, None);
            broadcast_state(&sm.0, &app, &store.0);
            let sidecar = sc.0.lock().unwrap();
            if let Some(ref s) = *sidecar { let _ = s.send("cancel", HashMap::new(), |_| {}); }
            ResultPayload::ok()
        }
        _ => {
            // capsule click — toggle
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
fn pill_set_ignore_mouse(_ignore: bool) -> ResultPayload { ResultPayload::ok() }

#[tauri::command]
fn pill_context_menu() -> ResultPayload { ResultPayload::ok() }

#[tauri::command]
fn window_minimize(window: tauri::Window) -> ResultPayload {
    let _ = window.minimize();
    ResultPayload::ok()
}

#[tauri::command]
fn window_maximize(window: tauri::Window) -> ResultPayload {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
    ResultPayload::ok()
}

#[tauri::command]
fn window_close(window: tauri::Window) -> ResultPayload {
    let _ = window.hide();
    ResultPayload::ok()
}

#[tauri::command]
fn window_is_maximized(window: tauri::Window) -> bool {
    window.is_maximized().unwrap_or(false)
}

// --- Helpers ---

fn broadcast_state(sm: &StateMachine, app: &AppHandle, store: &Store) {
    let settings = store.get_settings();
    let aem = settings.get("autoEnterMode").and_then(|v| v.as_str()).unwrap_or("off").to_string();
    let payload = StatePayload {
        state: sm.state().to_string(),
        message: sm.message(),
        auto_enter_mode: aem,
    };
    let _ = app.emit("state-update", &payload);
}

fn find_python() -> String {
    // Check for venv first, then system python
    for candidate in &["../../venv/Scripts/python.exe", "python", "python3"] {
        if std::process::Command::new(candidate).arg("--version").output().is_ok() {
            return candidate.to_string();
        }
    }
    "python".to_string()
}

// --- App setup ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Settings store
            let config_dir = app.path().app_config_dir().unwrap_or(PathBuf::from("."));
            let store = Store::new(config_dir);
            app.manage(AppStore(store));

            // Sidecar — spawn Python engine
            let engine_path = std::env::current_dir()
                .unwrap_or_default()
                .join("../../shared/engine/engine.py")
                .to_string_lossy()
                .to_string();
            let python = find_python();
            let sc = Arc::new(Sidecar::new(engine_path, python));

            // Sidecar event handler
            let app_handle = app.handle().clone();
            sc.on_event(move |event, data| {
                match event.as_str() {
                    "transcription" => { let _ = app_handle.emit("transcription", &data); }
                    "level" => { let _ = app_handle.emit("level-update", &data); }
                    "error" => { let _ = app_handle.emit("sidecar-error", &data); }
                    "ready" => { println!("[sidecar] ready"); }
                    "cancelled" => { println!("[sidecar] cancelled"); }
                    _ => {}
                }
            });

            if let Err(e) = sc.start() {
                eprintln!("[sidecar] Failed to start: {}", e);
            }
            app.manage(AppSidecar(Mutex::new(Some(sc))));

            // Register global hotkey (Ctrl+Alt+R)
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
            let hotkey_app = app.handle().clone();
            if let Err(e) = app.handle().global_shortcut().on_shortcut("ctrl+alt+r", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    println!("[hotkey] Ctrl+Alt+R pressed");
                    if let Some(w) = hotkey_app.get_webview_window("main") {
                        let _ = w.eval("triggerTrustedHotkeyToggle()");
                    }
                }
            }) {
                eprintln!("[hotkey] Failed to register: {}", e);
            }

            Ok(())
        })
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppStateMachine(StateMachine::new()))
        .invoke_handler(tauri::generate_handler![
            get_state, ack_state,
            get_settings, save_settings, reset_settings,
            start_recording, stop_recording, cancel_processing,
            get_history, delete_history, clear_history,
            get_audio, export_transcription, paste_last_transcript, copy_to_clipboard,
            list_models, download_model, delete_model,
            list_mics, set_mic, verify_api_key,
            get_app_info, simulate_enter,
            toggle_pill, show_main_window, show_settings, hide_pill,
            pill_clicked, pill_set_ignore_mouse, pill_context_menu,
            window_minimize, window_maximize, window_close, window_is_maximized,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
