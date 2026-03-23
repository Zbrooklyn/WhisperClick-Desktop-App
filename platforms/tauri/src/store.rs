//! Crash-safe JSON file store — atomic writes + backup recovery.
//!
//! Matches Electron store.js behavior: .tmp → rename for atomic writes,
//! .bak fallback for corrupted files.

use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// Default settings — matches Electron's DEFAULT_SETTINGS
fn default_settings() -> serde_json::Map<String, Value> {
    serde_json::from_str::<Value>(r#"{
        "mode": "api",
        "hotkey": "ctrl+alt+r",
        "theme": "dark",
        "autoPaste": true,
        "autoStart": false,
        "closeBehavior": "tray",
        "soundEnabled": true,
        "alwaysOnTop": false,
        "showPill": true,
        "provider": "openai",
        "apiModel": "whisper-1",
        "outputMode": "transcribe",
        "localModel": "",
        "targetLanguage": "en",
        "sourceLanguage": "auto",
        "customBaseUrl": "",
        "pillMonitor": 0,
        "audioRetentionDays": 7,
        "autoEnterMode": "off",
        "trayClickAction": "toggle",
        "debugLogging": false,
        "updateChannel": "stable",
        "autoDownloadUpdates": true,
        "visualizerStyle": "classic"
    }"#).ok()
        .and_then(|v| match v { Value::Object(m) => Some(m), _ => None })
        .unwrap_or_default()
}

pub struct Store {
    pub settings: Mutex<serde_json::Map<String, Value>>,
    pub history: Mutex<Vec<Value>>,
    settings_path: PathBuf,
    history_path: PathBuf,
}

impl Store {
    pub fn new(config_dir: PathBuf, _is_dev: bool) -> Self {
        // Config dir is fully resolved by the caller (e.g. %APPDATA%/Tauri/com.whisperclick.dev)
        let _ = fs::create_dir_all(&config_dir);
        let settings_path = config_dir.join("settings.json");
        let history_path = config_dir.join("history.json");

        // Load with .bak fallback, merge with defaults
        let mut settings = default_settings();
        let saved = Self::safe_read_json_map(&settings_path);
        for (k, v) in saved {
            settings.insert(k, v);
        }
        let history = Self::safe_read_json_array(&history_path);

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
        Self::atomic_write(&self.settings_path, &json);
    }

    pub fn reset_settings(&self) {
        let mut settings = self.settings.lock().unwrap();
        *settings = default_settings();
        let json = serde_json::to_string_pretty(&Value::Object(settings.clone())).unwrap_or_default();
        Self::atomic_write(&self.settings_path, &json);
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
        Self::atomic_write(&self.history_path, &json);
    }

    pub fn delete_history(&self, id: &str) {
        let mut history = self.history.lock().unwrap();
        history.retain(|e| e.get("id").and_then(|v| v.as_str()) != Some(id));
        let json = serde_json::to_string_pretty(&Value::Array(history.clone())).unwrap_or_default();
        Self::atomic_write(&self.history_path, &json);
    }

    pub fn clear_history(&self) {
        self.history.lock().unwrap().clear();
        Self::atomic_write(&self.history_path, "[]");
    }

    /// Crash-safe write: write to .tmp, backup existing to .bak, rename .tmp → target
    fn atomic_write(path: &PathBuf, data: &str) {
        let tmp = path.with_extension("json.tmp");
        let bak = path.with_extension("json.bak");

        // Write to tmp first
        if fs::write(&tmp, data).is_err() {
            // Fallback: direct write
            let _ = fs::write(path, data);
            return;
        }

        // Backup existing file
        if path.exists() {
            let _ = fs::copy(path, &bak);
        }

        // Rename tmp → target (atomic on most filesystems)
        if fs::rename(&tmp, path).is_err() {
            // Fallback: copy + remove
            let _ = fs::copy(&tmp, path);
            let _ = fs::remove_file(&tmp);
        }
    }

    /// Read JSON map with .bak fallback
    fn safe_read_json_map(path: &PathBuf) -> serde_json::Map<String, Value> {
        // Try primary file
        if let Some(m) = Self::try_read_json_map(path) {
            return m;
        }
        // Try .bak fallback
        let bak = path.with_extension("json.bak");
        if let Some(m) = Self::try_read_json_map(&bak) {
            eprintln!("[store] Recovered settings from backup: {}", bak.display());
            // Restore the backup as the primary
            let _ = fs::copy(&bak, path);
            return m;
        }
        serde_json::Map::new()
    }

    /// Read JSON array with .bak fallback
    fn safe_read_json_array(path: &PathBuf) -> Vec<Value> {
        if let Some(a) = Self::try_read_json_array(path) {
            return a;
        }
        let bak = path.with_extension("json.bak");
        if let Some(a) = Self::try_read_json_array(&bak) {
            eprintln!("[store] Recovered history from backup: {}", bak.display());
            let _ = fs::copy(&bak, path);
            return a;
        }
        Vec::new()
    }

    fn try_read_json_map(path: &PathBuf) -> Option<serde_json::Map<String, Value>> {
        fs::read_to_string(path).ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| match v { Value::Object(m) => Some(m), _ => None })
    }

    fn try_read_json_array(path: &PathBuf) -> Option<Vec<Value>> {
        fs::read_to_string(path).ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| match v { Value::Array(a) => Some(a), _ => None })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_store(name: &str, is_dev: bool) -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!("whisperclick_test_{}", name));
        let _ = fs::remove_dir_all(&dir);
        let store = Store::new(dir.clone(), is_dev);
        (store, dir)
    }

    fn cleanup(dir: &PathBuf) {
        let _ = fs::remove_dir_all(dir);
    }

    // === Default settings ===

    #[test]
    fn new_store_has_defaults() {
        let (store, dir) = temp_store("defaults", false);
        let s = store.get_settings();
        assert_eq!(s.get("mode").unwrap(), "api");
        assert_eq!(s.get("theme").unwrap(), "dark");
        assert_eq!(s.get("autoPaste").unwrap(), true);
        assert_eq!(s.get("closeBehavior").unwrap(), "tray");
        cleanup(&dir);
    }

    #[test]
    fn saved_settings_override_defaults() {
        let dir = std::env::temp_dir().join("whisperclick_test_override");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("settings.json"), r#"{"mode":"local","customField":"yes"}"#).unwrap();
        let store = Store::new(dir.clone(), false);
        let s = store.get_settings();
        assert_eq!(s.get("mode").unwrap(), "local"); // overridden
        assert_eq!(s.get("theme").unwrap(), "dark"); // default preserved
        assert_eq!(s.get("customField").unwrap(), "yes"); // custom preserved
        cleanup(&dir);
    }

    // === Settings CRUD ===

    #[test]
    fn save_and_get_settings() {
        let (store, dir) = temp_store("save_get", false);
        let mut patch = serde_json::Map::new();
        patch.insert("mode".into(), Value::String("local".into()));
        store.save_settings(patch);
        assert_eq!(store.get_settings().get("mode").unwrap(), "local");
        cleanup(&dir);
    }

    #[test]
    fn settings_merge_not_replace() {
        let (store, dir) = temp_store("merge", false);
        let mut p1 = serde_json::Map::new();
        p1.insert("customA".into(), Value::String("1".into()));
        store.save_settings(p1);
        let mut p2 = serde_json::Map::new();
        p2.insert("customB".into(), Value::String("2".into()));
        store.save_settings(p2);
        let s = store.get_settings();
        assert_eq!(s.get("customA").unwrap(), "1");
        assert_eq!(s.get("customB").unwrap(), "2");
        cleanup(&dir);
    }

    #[test]
    fn reset_restores_defaults() {
        let (store, dir) = temp_store("reset", false);
        let mut p = serde_json::Map::new();
        p.insert("mode".into(), Value::String("local".into()));
        store.save_settings(p);
        store.reset_settings();
        assert_eq!(store.get_settings().get("mode").unwrap(), "api");
        cleanup(&dir);
    }

    // === Atomic writes ===

    #[test]
    fn settings_persist_to_disk() {
        let dir = std::env::temp_dir().join("whisperclick_test_persist2");
        let _ = fs::remove_dir_all(&dir);
        {
            let store = Store::new(dir.clone(), false);
            let mut p = serde_json::Map::new();
            p.insert("saved".into(), Value::Bool(true));
            store.save_settings(p);
        }
        let store2 = Store::new(dir.clone(), false);
        assert_eq!(store2.get_settings().get("saved").unwrap(), true);
        cleanup(&dir);
    }

    #[test]
    fn backup_file_created_on_save() {
        let (store, dir) = temp_store("backup", false);
        let mut p = serde_json::Map::new();
        p.insert("first".into(), Value::Bool(true));
        store.save_settings(p.clone());
        // Second save should create .bak of first
        let mut p2 = serde_json::Map::new();
        p2.insert("second".into(), Value::Bool(true));
        store.save_settings(p2);
        assert!(dir.join("settings.json.bak").exists());
        cleanup(&dir);
    }

    // === Backup recovery ===

    #[test]
    fn recovers_from_corrupt_settings() {
        let dir = std::env::temp_dir().join("whisperclick_test_recover");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("settings.json"), "CORRUPT!!!").unwrap();
        fs::write(dir.join("settings.json.bak"), r#"{"mode":"local"}"#).unwrap();
        let store = Store::new(dir.clone(), false);
        assert_eq!(store.get_settings().get("mode").unwrap(), "local");
        cleanup(&dir);
    }

    #[test]
    fn both_corrupt_returns_defaults() {
        let dir = std::env::temp_dir().join("whisperclick_test_both_corrupt");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("settings.json"), "BAD").unwrap();
        fs::write(dir.join("settings.json.bak"), "ALSO BAD").unwrap();
        let store = Store::new(dir.clone(), false);
        // Should have defaults
        assert_eq!(store.get_settings().get("mode").unwrap(), "api");
        cleanup(&dir);
    }

    // === History ===

    #[test]
    fn add_history_entry() {
        let (store, dir) = temp_store("add_hist2", false);
        store.add_history(serde_json::json!({ "id": "1", "text": "hello" }));
        assert_eq!(store.get_history().len(), 1);
        cleanup(&dir);
    }

    #[test]
    fn history_newest_first() {
        let (store, dir) = temp_store("order2", false);
        store.add_history(serde_json::json!({ "id": "1", "text": "first" }));
        store.add_history(serde_json::json!({ "id": "2", "text": "second" }));
        assert_eq!(store.get_history()[0]["text"], "second");
        cleanup(&dir);
    }

    #[test]
    fn delete_history_by_id() {
        let (store, dir) = temp_store("delete2", false);
        store.add_history(serde_json::json!({ "id": "a", "text": "keep" }));
        store.add_history(serde_json::json!({ "id": "b", "text": "remove" }));
        store.delete_history("b");
        assert_eq!(store.get_history().len(), 1);
        assert_eq!(store.get_history()[0]["id"], "a");
        cleanup(&dir);
    }

    #[test]
    fn clear_history() {
        let (store, dir) = temp_store("clear2", false);
        store.add_history(serde_json::json!({ "id": "1" }));
        store.clear_history();
        assert!(store.get_history().is_empty());
        cleanup(&dir);
    }

    #[test]
    fn history_capped_at_500() {
        let (store, dir) = temp_store("cap2", false);
        for i in 0..510 {
            store.add_history(serde_json::json!({ "id": format!("{}", i) }));
        }
        assert_eq!(store.get_history().len(), 500);
        cleanup(&dir);
    }

    // === Corruption ===

    #[test]
    fn corrupted_history_recovers_from_backup() {
        let dir = std::env::temp_dir().join("whisperclick_test_hist_recover");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("history.json"), "NOT JSON").unwrap();
        fs::write(dir.join("history.json.bak"), r#"[{"id":"1","text":"recovered"}]"#).unwrap();
        let store = Store::new(dir.clone(), false);
        assert_eq!(store.get_history().len(), 1);
        assert_eq!(store.get_history()[0]["text"], "recovered");
        cleanup(&dir);
    }
}
