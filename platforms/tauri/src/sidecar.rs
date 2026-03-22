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
    pending: Mutex<HashMap<u64, PendingCallback>>,
    event_handler: Mutex<Option<EventCallback>>,
    is_running: AtomicBool,
    engine_path: String,
    python_path: String,
}

impl Sidecar {
    pub fn new(engine_path: String, python_path: String) -> Self {
        Self {
            process: Mutex::new(None),
            stdin: Mutex::new(None),
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            event_handler: Mutex::new(None),
            is_running: AtomicBool::new(false),
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
        let pending = Arc::new(Mutex::new(HashMap::<u64, PendingCallback>::new()));
        let event_handler = self.event_handler.lock().unwrap().clone();
        let is_running = Arc::new(AtomicBool::new(true));
        self.is_running.store(true, Ordering::Relaxed);

        // Move pending map ref for the reader thread
        let pending_for_thread = {
            // Swap the pending map into the thread's copy
            let mut p = self.pending.lock().unwrap();
            let current = std::mem::take(&mut *p);
            drop(p);
            Arc::new(Mutex::new(current))
        };

        let running_flag = is_running.clone();
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
                            // Response to a command — resolve pending
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
            running_flag.store(false, Ordering::Relaxed);
        });

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

    /// Kill the sidecar process
    pub fn kill(&self) {
        let mut proc = self.process.lock().unwrap();
        if let Some(ref mut child) = *proc {
            let _ = child.kill();
            let _ = child.wait();
        }
        *proc = None;
        *self.stdin.lock().unwrap() = None;
        self.is_running.store(false, Ordering::Relaxed);
        println!("[sidecar] Killed");
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.kill();
    }
}
