mod gate;
mod state_machine;

use state_machine::{AppState, StateMachine};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use serde::Serialize;
use serde_json::Value;

/// App state managed by Tauri
pub struct AppStateMachine(pub StateMachine);

/// Settings store (simple JSON in memory for now)
pub struct SettingsStore {
    pub settings: Mutex<serde_json::Map<String, Value>>,
}

#[derive(Clone, Serialize)]
struct StatePayload {
    state: String,
    message: String,
}

#[derive(Serialize)]
struct ResultPayload {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl ResultPayload {
    fn ok() -> Self { Self { success: true, error: None } }
    fn err(msg: &str) -> Self { Self { success: false, error: Some(msg.to_string()) } }
}

// --- State commands ---

#[tauri::command]
fn get_state(sm: tauri::State<'_, AppStateMachine>) -> StatePayload {
    StatePayload {
        state: sm.0.state().to_string(),
        message: sm.0.message(),
    }
}

#[tauri::command]
fn ack_state(sm: tauri::State<'_, AppStateMachine>, app: AppHandle) -> ResultPayload {
    if sm.0.is(&[AppState::Success, AppState::Error]) {
        sm.0.transition(AppState::Dormant, None);
        broadcast_state_inner(&sm.0, &app);
        ResultPayload::ok()
    } else {
        ResultPayload::err("Nothing to acknowledge")
    }
}

// --- Settings commands ---

#[tauri::command]
fn get_settings(store: tauri::State<'_, SettingsStore>) -> serde_json::Map<String, Value> {
    store.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(
    store: tauri::State<'_, SettingsStore>,
    patch: serde_json::Map<String, Value>,
) -> ResultPayload {
    let mut settings = store.settings.lock().unwrap();
    for (key, value) in patch {
        settings.insert(key, value);
    }
    ResultPayload::ok()
}

#[tauri::command]
fn reset_settings(store: tauri::State<'_, SettingsStore>) -> ResultPayload {
    store.settings.lock().unwrap().clear();
    ResultPayload::ok()
}

// --- Recording commands ---

#[tauri::command]
fn start_recording(
    sm: tauri::State<'_, AppStateMachine>,
    store: tauri::State<'_, SettingsStore>,
    app: AppHandle,
) -> ResultPayload {
    let (mode, has_key) = {
        let settings = store.settings.lock().unwrap();
        let m = settings.get("mode").and_then(|v| v.as_str()).unwrap_or("api").to_string();
        let k = settings.get("openaiApiKey").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false)
            || settings.get("geminiApiKey").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
        (m, k)
    };

    let gate = gate::can_accept_action(&sm.0, "start", has_key, &mode);
    if !gate.allowed {
        return ResultPayload::err(&gate.error.unwrap_or_default());
    }

    sm.0.transition(AppState::Recording, None);
    broadcast_state_inner(&sm.0, &app);
    ResultPayload::ok()
}

#[tauri::command]
fn stop_recording(sm: tauri::State<'_, AppStateMachine>, app: AppHandle) -> ResultPayload {
    let gate = gate::can_accept_action(&sm.0, "stop", true, "api");
    if !gate.allowed {
        return ResultPayload::err(&gate.error.unwrap_or_default());
    }
    sm.0.transition(AppState::Processing, None);
    broadcast_state_inner(&sm.0, &app);
    ResultPayload::ok()
}

#[tauri::command]
fn cancel_processing(sm: tauri::State<'_, AppStateMachine>, app: AppHandle) -> ResultPayload {
    let gate = gate::can_accept_action(&sm.0, "cancel", true, "api");
    if !gate.allowed {
        return ResultPayload::err(&gate.error.unwrap_or_default());
    }
    sm.0.transition(AppState::Dormant, None);
    broadcast_state_inner(&sm.0, &app);
    ResultPayload::ok()
}

// --- Stub commands (to be implemented in M6/M7) ---

#[tauri::command] fn get_history() -> Vec<Value> { vec![] }
#[tauri::command] fn delete_history(_id: String) -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn clear_history() -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn get_audio(_id: String) -> Option<String> { None }
#[tauri::command] fn export_transcription(_text: String, _format: String) -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn paste_last_transcript() -> ResultPayload { ResultPayload::err("No transcriptions") }
#[tauri::command] fn copy_to_clipboard(_text: String) -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn list_models() -> Vec<Value> { vec![] }
#[tauri::command] fn download_model(_name: String) -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn delete_model(_name: String) -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn list_mics() -> Vec<Value> { vec![] }
#[tauri::command] fn set_mic(_id: i32) -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn verify_api_key(_provider: String, _key: String) -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn simulate_enter() -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn toggle_pill() -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn show_main_window() -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn show_settings() -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn hide_pill() -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn pill_clicked(_action: String) -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn pill_set_ignore_mouse(_ignore: bool) -> ResultPayload { ResultPayload::ok() }
#[tauri::command] fn pill_context_menu() -> ResultPayload { ResultPayload::ok() }

#[tauri::command]
fn get_app_info() -> Value {
    serde_json::json!({
        "version": "3.0.0-alpha",
        "platform": std::env::consts::OS,
    })
}

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

fn broadcast_state_inner(sm: &StateMachine, app: &AppHandle) {
    let payload = StatePayload {
        state: sm.state().to_string(),
        message: sm.message(),
    };
    let _ = app.emit("state-update", &payload);
}

// --- App setup ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppStateMachine(StateMachine::new()))
        .manage(SettingsStore {
            settings: Mutex::new(serde_json::Map::new()),
        })
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
