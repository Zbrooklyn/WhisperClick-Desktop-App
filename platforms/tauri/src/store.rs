//! Simple JSON file store — read/write settings and history to disk.

use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Store {
    pub settings: Mutex<serde_json::Map<String, Value>>,
    pub history: Mutex<Vec<Value>>,
    settings_path: PathBuf,
    history_path: PathBuf,
}

impl Store {
    pub fn new(config_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&config_dir);
        let settings_path = config_dir.join("settings.json");
        let history_path = config_dir.join("history.json");

        let settings = Self::read_json_map(&settings_path);
        let history = Self::read_json_array(&history_path);

        Self {
            settings: Mutex::new(settings),
            history: Mutex::new(history),
            settings_path,
            history_path,
        }
    }

    pub fn get_settings(&self) -> serde_json::Map<String, Value> {
        self.settings.lock().unwrap().clone()
    }

    pub fn save_settings(&self, patch: serde_json::Map<String, Value>) {
        let mut settings = self.settings.lock().unwrap();
        for (key, value) in patch {
            settings.insert(key, value);
        }
        let json = serde_json::to_string_pretty(&Value::Object(settings.clone())).unwrap_or_default();
        let _ = fs::write(&self.settings_path, json);
    }

    pub fn reset_settings(&self) {
        self.settings.lock().unwrap().clear();
        let _ = fs::write(&self.settings_path, "{}");
    }

    pub fn get_history(&self) -> Vec<Value> {
        self.history.lock().unwrap().clone()
    }

    pub fn add_history(&self, entry: Value) {
        let mut history = self.history.lock().unwrap();
        history.insert(0, entry);
        if history.len() > 500 {
            history.truncate(500);
        }
        let json = serde_json::to_string_pretty(&Value::Array(history.clone())).unwrap_or_default();
        let _ = fs::write(&self.history_path, json);
    }

    pub fn delete_history(&self, id: &str) {
        let mut history = self.history.lock().unwrap();
        history.retain(|e| e.get("id").and_then(|v| v.as_str()) != Some(id));
        let json = serde_json::to_string_pretty(&Value::Array(history.clone())).unwrap_or_default();
        let _ = fs::write(&self.history_path, json);
    }

    pub fn clear_history(&self) {
        self.history.lock().unwrap().clear();
        let _ = fs::write(&self.history_path, "[]");
    }

    fn read_json_map(path: &PathBuf) -> serde_json::Map<String, Value> {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| match v { Value::Object(m) => Some(m), _ => None })
            .unwrap_or_default()
    }

    fn read_json_array(path: &PathBuf) -> Vec<Value> {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| match v { Value::Array(a) => Some(a), _ => None })
            .unwrap_or_default()
    }
}
