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
}
