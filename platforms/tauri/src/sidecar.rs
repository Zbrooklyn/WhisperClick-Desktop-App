//! Python sidecar manager — spawns engine.py and communicates via JSON stdin/stdout.
//!
//! Port of electron/sidecar.js to Rust. Same protocol, same restart logic.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarMessage {
    pub id: u64,
    pub command: String,
    #[serde(flatten)]
    pub params: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarResponse {
    #[serde(default)]
    pub id: Option<u64>,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub event: Option<String>,
    #[serde(default)]
    pub data: Option<Value>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

type PendingCallback = Box<dyn FnOnce(Result<SidecarResponse, String>) + Send>;
type EventCallback = Arc<dyn Fn(String, Value) + Send + Sync>;

pub struct Sidecar {
    process: Mutex<Option<Child>>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, PendingCallback>>>,
    event_handler: Mutex<Option<EventCallback>>,
    is_running: Arc<AtomicBool>,
    engine_path: String,
    python_path: String,
}

impl Sidecar {
    pub fn new(engine_path: String, python_path: String) -> Self {
        Self {
            process: Mutex::new(None),
            stdin: Mutex::new(None),
            next_id: AtomicU64::new(1),
            pending: Arc::new(Mutex::new(HashMap::new())),
            event_handler: Mutex::new(None),
            is_running: Arc::new(AtomicBool::new(false)),
            engine_path,
            python_path,
        }
    }

    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }

    /// Set event handler for sidecar events (transcription, error, level, etc.)
    pub fn on_event<F>(&self, handler: F)
    where
        F: Fn(String, Value) + Send + Sync + 'static,
    {
        *self.event_handler.lock().unwrap() = Some(Arc::new(handler));
    }

    /// Start the Python sidecar process
    pub fn start(&self) -> Result<(), String> {
        let child = Command::new(&self.python_path)
            .arg("-u") // unbuffered stdout — required for real-time progress events
            .arg(&self.engine_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        let mut proc = self.process.lock().unwrap();
        let mut child = child;

        // Take stdin for writing
        let child_stdin = child.stdin.take().ok_or("Failed to get stdin")?;
        *self.stdin.lock().unwrap() = Some(child_stdin);

        // Read stdout in a background thread
        let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
        let event_handler = self.event_handler.lock().unwrap().clone();
        self.is_running.store(true, Ordering::Relaxed);

        // Share the SAME pending map with the reader thread (fixes callback resolution bug)
        let pending_for_thread = self.pending.clone();
        let running_flag = self.is_running.clone();

        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let line = line.trim().to_string();
                if line.is_empty() { continue; }

                match serde_json::from_str::<SidecarResponse>(&line) {
                    Ok(resp) => {
                        if let Some(event) = &resp.event {
                            // Event message (no id) — fire event handler
                            if let Some(ref handler) = event_handler {
                                let data = resp.data.clone().unwrap_or(Value::Null);
                                handler(event.clone(), data);
                            }
                        } else if let Some(id) = resp.id {
                            // Response to a command — resolve pending callback
                            let mut pending = pending_for_thread.lock().unwrap();
                            if let Some(cb) = pending.remove(&id) {
                                if resp.error.is_some() {
                                    cb(Err(resp.error.unwrap()));
                                } else {
                                    cb(Ok(resp));
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[sidecar] Failed to parse: {} — {}", line, e);
                    }
                }
            }
            // Sidecar exited — reject all pending callbacks
            running_flag.store(false, Ordering::Relaxed);
            let mut pending = pending_for_thread.lock().unwrap();
            let keys: Vec<u64> = pending.keys().cloned().collect();
            for id in keys {
                if let Some(cb) = pending.remove(&id) {
                    cb(Err("Sidecar process exited".to_string()));
                }
            }
        });

        // Read stderr in background (log errors)
        if let Some(stderr) = child.stderr.take() {
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    if !line.trim().is_empty() {
                        eprintln!("[sidecar:stderr] {}", line.trim());
                    }
                }
            });
        }

        *proc = Some(child);
        println!("[sidecar] Started: {}", self.engine_path);
        Ok(())
    }

    /// Send a command to the sidecar and get a response via callback
    pub fn send(
        &self,
        command: &str,
        params: HashMap<String, Value>,
        callback: impl FnOnce(Result<SidecarResponse, String>) + Send + 'static,
    ) -> Result<(), String> {
        if !self.is_running() {
            return Err("Sidecar not running".to_string());
        }

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let msg = SidecarMessage {
            id,
            command: command.to_string(),
            params,
        };

        let json = serde_json::to_string(&msg).map_err(|e| e.to_string())?;

        // Register pending callback
        self.pending.lock().unwrap().insert(id, Box::new(callback));

        // Write to stdin
        let mut stdin = self.stdin.lock().unwrap();
        if let Some(ref mut stdin) = *stdin {
            writeln!(stdin, "{}", json).map_err(|e| format!("Failed to write: {}", e))?;
            stdin.flush().map_err(|e| format!("Failed to flush: {}", e))?;
        } else {
            return Err("Stdin not available".to_string());
        }

        Ok(())
    }

    /// Send a command and block until response arrives (with timeout).
    /// Used by Tauri commands that need synchronous return values (list_models, etc.)
    pub fn send_sync(
        &self,
        command: &str,
        params: HashMap<String, Value>,
        timeout: Duration,
    ) -> Result<SidecarResponse, String> {
        let (tx, rx) = std::sync::mpsc::channel();
        self.send(command, params, move |result| {
            let _ = tx.send(result);
        })?;
        rx.recv_timeout(timeout)
            .map_err(|e| format!("Sidecar timeout ({}): {}", command, e))?
    }

    /// Gracefully stop the sidecar: send quit command, wait 2s, then force kill
    pub fn kill(&self) {
        // Try graceful quit first
        if self.is_running() {
            let _ = self.send("quit", HashMap::new(), |_| {});
        }

        let mut proc = self.process.lock().unwrap();
        if let Some(ref mut child) = *proc {
            // Wait up to 2s for graceful exit
            for _ in 0..20 {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    _ => thread::sleep(Duration::from_millis(100)),
                }
            }
            // Force kill if still running
            let _ = child.kill();
            let _ = child.wait();
        }
        *proc = None;
        *self.stdin.lock().unwrap() = None;
        self.is_running.store(false, Ordering::Relaxed);
        println!("[sidecar] Stopped");
    }

    /// Restart the sidecar process (kill + start)
    pub fn restart(&self) -> Result<(), String> {
        self.kill();
        thread::sleep(Duration::from_millis(200));
        self.start()
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // === Message serialization ===

    #[test]
    fn sidecar_message_serializes() {
        let mut params = HashMap::new();
        params.insert("key".to_string(), Value::String("val".to_string()));
        let msg = SidecarMessage {
            id: 1,
            command: "configure".to_string(),
            params,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"id\":1"));
        assert!(json.contains("\"command\":\"configure\""));
        assert!(json.contains("\"key\":\"val\""));
    }

    #[test]
    fn sidecar_message_empty_params() {
        let msg = SidecarMessage {
            id: 42,
            command: "start_rec".to_string(),
            params: HashMap::new(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"id\":42"));
        assert!(json.contains("\"command\":\"start_rec\""));
    }

    // === Response parsing ===

    #[test]
    fn parse_event_response() {
        let json = r#"{"event":"ready","data":{"version":"1.0"}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "ready");
        assert!(resp.data.is_some());
        assert!(resp.id.is_none());
    }

    #[test]
    fn parse_command_response() {
        let json = r#"{"id":5,"result":"ok"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.id.unwrap(), 5);
        assert_eq!(resp.result.unwrap(), "ok");
        assert!(resp.event.is_none());
    }

    #[test]
    fn parse_error_response() {
        let json = r#"{"id":3,"error":"mic not found"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.id.unwrap(), 3);
        assert_eq!(resp.error.unwrap(), "mic not found");
    }

    #[test]
    fn parse_transcription_event() {
        let json = r#"{"event":"transcription","data":{"text":"hello world","duration":2.5,"provider":"openai","model":"whisper-1"}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "transcription");
        let data = resp.data.unwrap();
        assert_eq!(data["text"], "hello world");
        assert_eq!(data["duration"], 2.5);
    }

    #[test]
    fn parse_level_event() {
        let json = r#"{"event":"level","data":{"level":0.75}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "level");
        assert_eq!(resp.data.unwrap()["level"], 0.75);
    }

    #[test]
    fn parse_empty_response() {
        let json = r#"{}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert!(resp.id.is_none());
        assert!(resp.event.is_none());
        assert!(resp.result.is_none());
        assert!(resp.error.is_none());
    }

    #[test]
    fn parse_response_with_extra_fields() {
        let json = r#"{"id":1,"result":"ok","custom_field":"value"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.id.unwrap(), 1);
        assert!(resp.extra.contains_key("custom_field"));
    }

    // === Sidecar lifecycle ===

    #[test]
    fn new_sidecar_not_running() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        assert!(!sc.is_running());
    }

    #[test]
    fn send_fails_when_not_running() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        let result = sc.send("test", HashMap::new(), |_| {});
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not running"));
    }

    #[test]
    fn send_sync_fails_when_not_running() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        let result = sc.send_sync("test", HashMap::new(), Duration::from_millis(100));
        assert!(result.is_err());
    }

    #[test]
    fn kill_when_not_started_is_safe() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        sc.kill(); // Should not panic
        assert!(!sc.is_running());
    }

    #[test]
    fn start_with_invalid_python_fails() {
        let sc = Sidecar::new("fake.py".to_string(), "nonexistent_python_xyz".to_string());
        let result = sc.start();
        assert!(result.is_err());
    }

    // === ID generation ===

    #[test]
    fn message_ids_increment() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        let id1 = sc.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let id2 = sc.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(id2, id1 + 1);
    }

    // === Event handler ===

    #[test]
    fn event_handler_can_be_set() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        let called = Arc::new(AtomicBool::new(false));
        let called_clone = called.clone();
        sc.on_event(move |_event, _data| {
            called_clone.store(true, Ordering::Relaxed);
        });
        assert!(sc.event_handler.lock().unwrap().is_some());
    }

    // ========================================================================
    // Message serialization — additional tests
    // ========================================================================

    #[test]
    fn sidecar_message_with_numeric_param() {
        let mut params = HashMap::new();
        params.insert("device_id".to_string(), Value::Number(serde_json::Number::from(5)));
        let msg = SidecarMessage {
            id: 1,
            command: "set_mic".to_string(),
            params,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("device_id"));
        assert!(json.contains("5"));
    }

    #[test]
    fn sidecar_message_with_multiple_params() {
        let mut params = HashMap::new();
        params.insert("model".into(), Value::String("base".into()));
        params.insert("language".into(), Value::String("en".into()));
        params.insert("device_id".into(), Value::Number(serde_json::Number::from(3)));
        params.insert("vad_enabled".into(), Value::Bool(true));
        params.insert("threshold".into(), Value::Number(serde_json::Number::from_f64(0.5).unwrap()));
        let msg = SidecarMessage {
            id: 10,
            command: "configure".to_string(),
            params,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"model\":\"base\""));
        assert!(json.contains("\"language\":\"en\""));
        assert!(json.contains("\"device_id\":3"));
        assert!(json.contains("\"vad_enabled\":true"));
    }

    #[test]
    fn sidecar_message_with_nested_params() {
        let mut params = HashMap::new();
        params.insert("config".into(), serde_json::json!({"nested": {"deep": true}, "list": [1,2]}));
        let msg = SidecarMessage {
            id: 7,
            command: "advanced_config".to_string(),
            params,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"nested\""));
        assert!(json.contains("\"deep\":true"));
    }

    #[test]
    fn sidecar_message_with_null_param() {
        let mut params = HashMap::new();
        params.insert("device".into(), Value::Null);
        let msg = SidecarMessage {
            id: 2,
            command: "set_mic".to_string(),
            params,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"device\":null"));
    }

    #[test]
    fn sidecar_message_with_bool_param() {
        let mut params = HashMap::new();
        params.insert("enabled".into(), Value::Bool(false));
        let msg = SidecarMessage {
            id: 3,
            command: "toggle_vad".to_string(),
            params,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"enabled\":false"));
    }

    #[test]
    fn sidecar_message_roundtrip() {
        let mut params = HashMap::new();
        params.insert("key".into(), Value::String("value".into()));
        let msg = SidecarMessage {
            id: 99,
            command: "test_cmd".to_string(),
            params,
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: SidecarMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, 99);
        assert_eq!(parsed.command, "test_cmd");
        assert_eq!(parsed.params.get("key").unwrap(), "value");
    }

    #[test]
    fn sidecar_message_large_id() {
        let msg = SidecarMessage {
            id: u64::MAX,
            command: "ping".to_string(),
            params: HashMap::new(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(&u64::MAX.to_string()));
    }

    // ========================================================================
    // Response parsing — edge cases
    // ========================================================================

    #[test]
    fn parse_response_with_null_data() {
        let json = r#"{"id":1,"result":"ok","data":null}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.id.unwrap(), 1);
        assert!(resp.data.is_none() || resp.data.as_ref().unwrap().is_null());
    }

    #[test]
    fn parse_response_with_empty_object_data() {
        let json = r#"{"id":2,"result":"ok","data":{}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert!(resp.data.is_some());
        assert!(resp.data.unwrap().as_object().unwrap().is_empty());
    }

    #[test]
    fn parse_response_with_numeric_string_id() {
        // id as a number works
        let json = r#"{"id":42,"result":"ok"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.id.unwrap(), 42);
    }

    #[test]
    fn parse_response_with_extra_unknown_fields() {
        let json = r#"{"id":1,"result":"ok","foo":"bar","baz":123,"nested":{"a":1}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.id.unwrap(), 1);
        assert_eq!(resp.extra.get("foo").unwrap(), "bar");
        assert_eq!(resp.extra.get("baz").unwrap(), 123);
        assert!(resp.extra.get("nested").is_some());
    }

    #[test]
    fn parse_response_with_both_result_and_error() {
        let json = r#"{"id":1,"result":"partial","error":"some warning"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.result.unwrap(), "partial");
        assert_eq!(resp.error.unwrap(), "some warning");
    }

    #[test]
    fn parse_response_models_array() {
        let json = r#"{"id":1,"result":"ok","models":[{"name":"tiny","downloaded":true,"size_mb":75},{"name":"base","downloaded":false,"size_mb":141}]}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert!(resp.extra.contains_key("models"));
        let models = resp.extra.get("models").unwrap().as_array().unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["name"], "tiny");
        assert_eq!(models[0]["downloaded"], true);
    }

    #[test]
    fn parse_response_mics_array() {
        let json = r#"{"id":2,"result":"ok","mics":[{"id":0,"name":"Default Mic"},{"id":1,"name":"USB Mic"}]}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        let mics = resp.extra.get("mics").unwrap().as_array().unwrap();
        assert_eq!(mics.len(), 2);
        assert_eq!(mics[1]["name"], "USB Mic");
    }

    #[test]
    fn parse_response_status_field() {
        let json = r#"{"id":1,"status":"ok","result":"done"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.extra.get("status").unwrap(), "ok");
        assert_eq!(resp.result.unwrap(), "done");
    }

    // ========================================================================
    // Event parsing — additional
    // ========================================================================

    #[test]
    fn parse_model_download_progress_event() {
        let json = r#"{"event":"model_download_progress","data":{"model":"base","current":3,"total":10}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "model_download_progress");
        let data = resp.data.unwrap();
        assert_eq!(data["model"], "base");
        assert_eq!(data["current"], 3);
        assert_eq!(data["total"], 10);
    }

    #[test]
    fn parse_error_event() {
        let json = r#"{"event":"error","data":{"message":"Microphone disconnected","code":"MIC_LOST"}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "error");
        let data = resp.data.unwrap();
        assert_eq!(data["message"], "Microphone disconnected");
        assert_eq!(data["code"], "MIC_LOST");
    }

    #[test]
    fn parse_cancelled_event() {
        let json = r#"{"event":"cancelled","data":{}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "cancelled");
    }

    #[test]
    fn parse_ready_event_with_version() {
        let json = r#"{"event":"ready","data":{"version":"3.0.0","python":"3.12.0","whisper":"1.1.10"}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "ready");
        let data = resp.data.unwrap();
        assert_eq!(data["version"], "3.0.0");
        assert_eq!(data["python"], "3.12.0");
    }

    #[test]
    fn parse_event_with_no_data() {
        let json = r#"{"event":"ping"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "ping");
        assert!(resp.data.is_none());
    }

    #[test]
    fn parse_event_with_array_data() {
        let json = r#"{"event":"devices","data":[{"id":0,"name":"Mic 1"},{"id":1,"name":"Mic 2"}]}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "devices");
        let data = resp.data.unwrap();
        assert!(data.is_array());
        assert_eq!(data.as_array().unwrap().len(), 2);
    }

    #[test]
    fn parse_event_with_string_data() {
        let json = r#"{"event":"log","data":"some log message"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "log");
        assert_eq!(resp.data.unwrap(), "some log message");
    }

    // ========================================================================
    // Lifecycle — additional tests
    // ========================================================================

    #[test]
    fn kill_idempotent() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        sc.kill();
        sc.kill(); // Second kill should not panic
        assert!(!sc.is_running());
    }

    #[test]
    fn send_after_kill_returns_error() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        sc.kill();
        let result = sc.send("test", HashMap::new(), |_| {});
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not running"));
    }

    #[test]
    fn send_sync_after_kill_returns_error() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        sc.kill();
        let result = sc.send_sync("test", HashMap::new(), Duration::from_millis(100));
        assert!(result.is_err());
    }

    #[test]
    fn event_handler_initially_none() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        assert!(sc.event_handler.lock().unwrap().is_none());
    }

    #[test]
    fn event_handler_can_be_replaced() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        sc.on_event(|_e, _d| {});
        assert!(sc.event_handler.lock().unwrap().is_some());
        sc.on_event(|_e, _d| {}); // replace
        assert!(sc.event_handler.lock().unwrap().is_some());
    }

    #[test]
    fn next_id_starts_at_1() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        let id = sc.next_id.load(std::sync::atomic::Ordering::Relaxed);
        assert_eq!(id, 1);
    }

    #[test]
    fn pending_initially_empty() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        assert!(sc.pending.lock().unwrap().is_empty());
    }

    #[test]
    fn new_sidecar_stores_paths() {
        let sc = Sidecar::new("/path/to/engine.py".to_string(), "/usr/bin/python3".to_string());
        assert_eq!(sc.engine_path, "/path/to/engine.py");
        assert_eq!(sc.python_path, "/usr/bin/python3");
    }

    #[test]
    fn message_ids_increment_across_many() {
        let sc = Sidecar::new("fake.py".to_string(), "python".to_string());
        let mut ids = vec![];
        for _ in 0..100 {
            ids.push(sc.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
        }
        // Verify all unique and sequential
        for i in 0..100 {
            assert_eq!(ids[i], (i as u64) + 1);
        }
    }

    #[test]
    fn concurrent_id_generation() {
        use std::thread;
        let sc = Arc::new(Sidecar::new("fake.py".to_string(), "python".to_string()));
        let mut handles = vec![];
        for _ in 0..10 {
            let s = sc.clone();
            handles.push(thread::spawn(move || {
                let mut ids = vec![];
                for _ in 0..10 {
                    ids.push(s.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
                }
                ids
            }));
        }
        let mut all_ids: Vec<u64> = vec![];
        for h in handles {
            all_ids.extend(h.join().unwrap());
        }
        all_ids.sort();
        all_ids.dedup();
        // All 100 IDs should be unique
        assert_eq!(all_ids.len(), 100);
    }

    #[test]
    fn sidecar_response_default_fields() {
        let resp = SidecarResponse {
            id: None,
            result: None,
            error: None,
            event: None,
            data: None,
            extra: HashMap::new(),
        };
        assert!(resp.id.is_none());
        assert!(resp.result.is_none());
        assert!(resp.error.is_none());
        assert!(resp.event.is_none());
        assert!(resp.data.is_none());
        assert!(resp.extra.is_empty());
    }

    #[test]
    fn sidecar_response_clone() {
        let json = r#"{"id":1,"result":"ok","event":"test","data":{"x":1}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        let cloned = resp.clone();
        assert_eq!(cloned.id, resp.id);
        assert_eq!(cloned.result, resp.result);
        assert_eq!(cloned.event, resp.event);
    }

    #[test]
    fn sidecar_message_clone() {
        let msg = SidecarMessage {
            id: 5,
            command: "test".to_string(),
            params: HashMap::new(),
        };
        let cloned = msg.clone();
        assert_eq!(cloned.id, 5);
        assert_eq!(cloned.command, "test");
    }

    #[test]
    fn sidecar_message_debug_format() {
        let msg = SidecarMessage {
            id: 1,
            command: "ping".to_string(),
            params: HashMap::new(),
        };
        let debug = format!("{:?}", msg);
        assert!(debug.contains("SidecarMessage"));
        assert!(debug.contains("ping"));
    }

    #[test]
    fn sidecar_response_debug_format() {
        let json = r#"{"id":1,"result":"ok"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        let debug = format!("{:?}", resp);
        assert!(debug.contains("SidecarResponse"));
    }

    // ========================================================================
    // NEW: Parse every real sidecar response format
    // ========================================================================

    #[test]
    fn parse_transcription_with_all_fields() {
        let json = r#"{"event":"transcription","data":{"text":"hello world","duration":2.5,"provider":"openai","model":"whisper-1","language":"en","audio_file":"/tmp/rec.wav","segments":[{"start":0.0,"end":1.2,"text":"hello"},{"start":1.2,"end":2.5,"text":"world"}]}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "transcription");
        let data = resp.data.unwrap();
        assert_eq!(data["text"], "hello world");
        assert_eq!(data["duration"], 2.5);
        assert_eq!(data["provider"], "openai");
        assert_eq!(data["model"], "whisper-1");
        assert_eq!(data["language"], "en");
        assert_eq!(data["audio_file"], "/tmp/rec.wav");
        assert_eq!(data["segments"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn parse_level_with_float() {
        let json = r#"{"event":"level","data":{"level":0.12345}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "level");
        let level = resp.data.unwrap()["level"].as_f64().unwrap();
        assert!((level - 0.12345).abs() < 1e-10);
    }

    #[test]
    fn parse_level_zero() {
        let json = r#"{"event":"level","data":{"level":0.0}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.data.unwrap()["level"], 0.0);
    }

    #[test]
    fn parse_level_max() {
        let json = r#"{"event":"level","data":{"level":1.0}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.data.unwrap()["level"], 1.0);
    }

    #[test]
    fn parse_error_event_with_message() {
        let json = r#"{"event":"error","data":{"message":"Microphone disconnected","code":"MIC_ERR","recoverable":true}}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "error");
        let data = resp.data.unwrap();
        assert_eq!(data["message"], "Microphone disconnected");
        assert_eq!(data["code"], "MIC_ERR");
        assert_eq!(data["recoverable"], true);
    }

    #[test]
    fn parse_command_response_with_models_list() {
        let json = r#"{"id":10,"result":"ok","models":[{"name":"tiny","size_mb":75,"downloaded":true},{"name":"base","size_mb":141,"downloaded":false},{"name":"small","size_mb":484,"downloaded":false}]}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.id.unwrap(), 10);
        let models = resp.extra["models"].as_array().unwrap();
        assert_eq!(models.len(), 3);
        assert_eq!(models[0]["name"], "tiny");
        assert_eq!(models[2]["name"], "small");
    }

    // ========================================================================
    // NEW: SidecarMessage serialization with every param type
    // ========================================================================

    #[test]
    fn sidecar_message_with_string_param() {
        let mut params = HashMap::new();
        params.insert("provider".into(), Value::String("openai".into()));
        let msg = SidecarMessage { id: 1, command: "configure".into(), params };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"provider\":\"openai\""));
    }

    #[test]
    fn sidecar_message_with_number_param() {
        let mut params = HashMap::new();
        params.insert("timeout".into(), Value::Number(serde_json::Number::from(30)));
        let msg = SidecarMessage { id: 2, command: "configure".into(), params };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"timeout\":30"));
    }

    #[test]
    fn sidecar_message_with_bool_param_true() {
        let mut params = HashMap::new();
        params.insert("vad".into(), Value::Bool(true));
        let msg = SidecarMessage { id: 3, command: "configure".into(), params };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"vad\":true"));
    }

    #[test]
    fn sidecar_message_with_bool_param_false() {
        let mut params = HashMap::new();
        params.insert("vad".into(), Value::Bool(false));
        let msg = SidecarMessage { id: 4, command: "configure".into(), params };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"vad\":false"));
    }

    #[test]
    fn sidecar_message_with_null_param_value() {
        let mut params = HashMap::new();
        params.insert("language".into(), Value::Null);
        let msg = SidecarMessage { id: 5, command: "configure".into(), params };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"language\":null"));
    }

    #[test]
    fn sidecar_message_with_array_param() {
        let mut params = HashMap::new();
        params.insert("devices".into(), serde_json::json!([0, 1, 2]));
        let msg = SidecarMessage { id: 6, command: "list_devices".into(), params };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"devices\":[0,1,2]"));
    }

    #[test]
    fn sidecar_message_with_object_param() {
        let mut params = HashMap::new();
        params.insert("config".into(), serde_json::json!({"model": "base", "lang": "en"}));
        let msg = SidecarMessage { id: 7, command: "configure".into(), params };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"model\":\"base\""));
    }

    // ========================================================================
    // NEW: Response parsing with missing optional fields
    // ========================================================================

    #[test]
    fn parse_response_missing_result() {
        let json = r#"{"id":1}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.id.unwrap(), 1);
        assert!(resp.result.is_none());
        assert!(resp.error.is_none());
    }

    #[test]
    fn parse_response_missing_id() {
        let json = r#"{"result":"ok"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert!(resp.id.is_none());
        assert_eq!(resp.result.unwrap(), "ok");
    }

    #[test]
    fn parse_response_only_error() {
        let json = r#"{"id":5,"error":"timeout"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.id.unwrap(), 5);
        assert!(resp.result.is_none());
        assert_eq!(resp.error.unwrap(), "timeout");
    }

    #[test]
    fn parse_response_only_event_no_data() {
        let json = r#"{"event":"heartbeat"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.event.unwrap(), "heartbeat");
        assert!(resp.data.is_none());
        assert!(resp.id.is_none());
    }

    // ========================================================================
    // NEW: Response with very large data payload
    // ========================================================================

    #[test]
    fn parse_response_large_text_payload() {
        let long_text = "w".repeat(100_000);
        let json = format!(r#"{{"event":"transcription","data":{{"text":"{}"}}}}"#, long_text);
        let resp: SidecarResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(resp.event.unwrap(), "transcription");
        assert_eq!(resp.data.unwrap()["text"].as_str().unwrap().len(), 100_000);
    }

    #[test]
    fn parse_response_large_array_payload() {
        let items: Vec<serde_json::Value> = (0..1000).map(|i| serde_json::json!({"id": i})).collect();
        let json = format!(r#"{{"id":1,"result":"ok","items":{}}}"#, serde_json::to_string(&items).unwrap());
        let resp: SidecarResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(resp.extra["items"].as_array().unwrap().len(), 1000);
    }

    #[test]
    fn parse_response_float_id_zero() {
        // id: 0 is valid
        let json = r#"{"id":0,"result":"ok"}"#;
        let resp: SidecarResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.id.unwrap(), 0);
    }

    #[test]
    fn parse_response_very_large_id() {
        let json = format!(r#"{{"id":{},"result":"ok"}}"#, u64::MAX);
        let resp: SidecarResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(resp.id.unwrap(), u64::MAX);
    }
}
