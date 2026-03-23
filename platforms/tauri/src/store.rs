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

    // === History integration tests ===

    #[test]
    fn add_history_includes_all_fields() {
        let (store, dir) = temp_store("hist_all_fields", false);
        let entry = serde_json::json!({
            "id": "test-1",
            "text": "Hello world",
            "timestamp": "2026-03-23T00:00:00Z",
            "duration": 2.5,
            "provider": "openai",
            "model": "whisper-1",
            "language": "en",
            "audio_file": "/tmp/test.wav",
        });
        store.add_history(entry);
        let history = store.get_history();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].get("text").unwrap(), "Hello world");
        assert_eq!(history[0].get("audio_file").unwrap(), "/tmp/test.wav");
        assert_eq!(history[0].get("provider").unwrap(), "openai");
        cleanup(&dir);
    }

    #[test]
    fn delete_history_removes_correct_entry() {
        let (store, dir) = temp_store("hist_del_correct", false);
        store.add_history(serde_json::json!({"id": "a", "text": "first"}));
        store.add_history(serde_json::json!({"id": "b", "text": "second"}));
        store.add_history(serde_json::json!({"id": "c", "text": "third"}));
        assert_eq!(store.get_history().len(), 3);
        store.delete_history("b");
        let history = store.get_history();
        assert_eq!(history.len(), 2);
        assert!(history.iter().all(|e| e.get("id").unwrap() != "b"));
        cleanup(&dir);
    }

    #[test]
    fn clear_history_empties_all() {
        let (store, dir) = temp_store("hist_clear_all", false);
        for i in 0..5 {
            store.add_history(serde_json::json!({"id": format!("e{}", i), "text": format!("entry {}", i)}));
        }
        assert_eq!(store.get_history().len(), 5);
        store.clear_history();
        assert_eq!(store.get_history().len(), 0);
        cleanup(&dir);
    }

    #[test]
    fn settings_merge_preserves_existing_keys() {
        let (store, dir) = temp_store("settings_merge_preserve", false);
        let mut p1 = serde_json::Map::new();
        p1.insert("mode".into(), Value::String("local".into()));
        p1.insert("theme".into(), Value::String("dark".into()));
        store.save_settings(p1);

        let mut p2 = serde_json::Map::new();
        p2.insert("mode".into(), Value::String("api".into()));
        store.save_settings(p2);

        let s = store.get_settings();
        assert_eq!(s.get("mode").unwrap(), "api"); // updated
        assert_eq!(s.get("theme").unwrap(), "dark"); // preserved
        cleanup(&dir);
    }

    #[test]
    fn settings_default_values_present() {
        let (store, dir) = temp_store("settings_defaults_check", false);
        let s = store.get_settings();
        // Check all expected defaults exist
        assert!(s.get("mode").is_some());
        assert!(s.get("provider").is_some());
        assert!(s.get("soundEnabled").is_some());
        assert!(s.get("alwaysOnTop").is_some());
        assert!(s.get("showPill").is_some());
        assert!(s.get("hotkey").is_some());
        assert!(s.get("theme").is_some());
        assert!(s.get("autoStart").is_some());
        assert!(s.get("autoPaste").is_some());
        assert!(s.get("closeBehavior").is_some());
        assert!(s.get("outputMode").is_some());
        assert!(s.get("targetLanguage").is_some());
        assert!(s.get("sourceLanguage").is_some());
        assert!(s.get("audioRetentionDays").is_some());
        assert!(s.get("autoEnterMode").is_some());
        assert!(s.get("debugLogging").is_some());
        cleanup(&dir);
    }

    // === Additional edge-case tests ===

    #[test]
    fn delete_nonexistent_history_entry_is_noop() {
        let (store, dir) = temp_store("hist_del_noop", false);
        store.add_history(serde_json::json!({"id": "a", "text": "keep"}));
        store.delete_history("nonexistent");
        assert_eq!(store.get_history().len(), 1);
        assert_eq!(store.get_history()[0]["id"], "a");
        cleanup(&dir);
    }

    #[test]
    fn history_persists_to_disk() {
        let dir = std::env::temp_dir().join("whisperclick_test_hist_persist");
        let _ = fs::remove_dir_all(&dir);
        {
            let store = Store::new(dir.clone(), false);
            store.add_history(serde_json::json!({"id": "p1", "text": "persisted"}));
        }
        let store2 = Store::new(dir.clone(), false);
        assert_eq!(store2.get_history().len(), 1);
        assert_eq!(store2.get_history()[0]["text"], "persisted");
        cleanup(&dir);
    }

    #[test]
    fn reset_settings_removes_custom_keys() {
        let (store, dir) = temp_store("reset_custom", false);
        let mut p = serde_json::Map::new();
        p.insert("customKey".into(), Value::String("custom_value".into()));
        store.save_settings(p);
        assert!(store.get_settings().get("customKey").is_some());
        store.reset_settings();
        assert!(store.get_settings().get("customKey").is_none());
        cleanup(&dir);
    }

    #[test]
    fn settings_default_values_are_correct() {
        let (store, dir) = temp_store("defaults_correct", false);
        let s = store.get_settings();
        assert_eq!(s.get("mode").unwrap(), "api");
        assert_eq!(s.get("hotkey").unwrap(), "ctrl+alt+r");
        assert_eq!(s.get("theme").unwrap(), "dark");
        assert_eq!(s.get("autoPaste").unwrap(), true);
        assert_eq!(s.get("autoStart").unwrap(), false);
        assert_eq!(s.get("soundEnabled").unwrap(), true);
        assert_eq!(s.get("alwaysOnTop").unwrap(), false);
        assert_eq!(s.get("showPill").unwrap(), true);
        assert_eq!(s.get("provider").unwrap(), "openai");
        assert_eq!(s.get("outputMode").unwrap(), "transcribe");
        assert_eq!(s.get("targetLanguage").unwrap(), "en");
        assert_eq!(s.get("sourceLanguage").unwrap(), "auto");
        assert_eq!(s.get("audioRetentionDays").unwrap(), 7);
        assert_eq!(s.get("autoEnterMode").unwrap(), "off");
        assert_eq!(s.get("debugLogging").unwrap(), false);
        assert_eq!(s.get("updateChannel").unwrap(), "stable");
        assert_eq!(s.get("autoDownloadUpdates").unwrap(), true);
        assert_eq!(s.get("visualizerStyle").unwrap(), "classic");
        cleanup(&dir);
    }

    #[test]
    fn empty_history_on_fresh_store() {
        let (store, dir) = temp_store("empty_hist", false);
        assert!(store.get_history().is_empty());
        cleanup(&dir);
    }

    #[test]
    fn clear_history_persists_to_disk() {
        let dir = std::env::temp_dir().join("whisperclick_test_clear_persist");
        let _ = fs::remove_dir_all(&dir);
        {
            let store = Store::new(dir.clone(), false);
            store.add_history(serde_json::json!({"id": "1", "text": "temp"}));
            store.clear_history();
        }
        let store2 = Store::new(dir.clone(), false);
        assert!(store2.get_history().is_empty());
        cleanup(&dir);
    }

    #[test]
    fn history_ordering_preserved_after_delete() {
        let (store, dir) = temp_store("hist_order_del", false);
        store.add_history(serde_json::json!({"id": "1", "text": "first"}));
        store.add_history(serde_json::json!({"id": "2", "text": "second"}));
        store.add_history(serde_json::json!({"id": "3", "text": "third"}));
        // Newest first: 3, 2, 1
        store.delete_history("2");
        let history = store.get_history();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0]["id"], "3"); // newest still first
        assert_eq!(history[1]["id"], "1"); // oldest still last
        cleanup(&dir);
    }

    #[test]
    fn concurrent_settings_access() {
        use std::sync::Arc;
        use std::thread;
        let dir = std::env::temp_dir().join("whisperclick_test_concurrent_settings");
        let _ = fs::remove_dir_all(&dir);
        let store = Arc::new(Store::new(dir.clone(), false));
        let mut handles = vec![];

        for i in 0..10 {
            let store_clone = store.clone();
            handles.push(thread::spawn(move || {
                let mut p = serde_json::Map::new();
                p.insert(format!("key_{}", i), Value::String(format!("val_{}", i)));
                store_clone.save_settings(p);
                let _ = store_clone.get_settings();
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        // All 10 keys should be present
        let s = store.get_settings();
        for i in 0..10 {
            assert!(s.get(&format!("key_{}", i)).is_some(), "Missing key_{}", i);
        }
        cleanup(&dir);
    }

    // ========================================================================
    // Torture / stress tests
    // ========================================================================

    #[test]
    fn torture_concurrent_saves_10_threads() {
        use std::sync::Arc;
        use std::thread;
        let dir = std::env::temp_dir().join("whisperclick_test_torture_saves");
        let _ = fs::remove_dir_all(&dir);
        let store = Arc::new(Store::new(dir.clone(), false));
        let mut handles = vec![];

        for i in 0..10 {
            let s = store.clone();
            handles.push(thread::spawn(move || {
                for j in 0..10 {
                    let mut p = serde_json::Map::new();
                    p.insert(format!("t{}_{}", i, j), Value::Number(serde_json::Number::from(j)));
                    s.save_settings(p);
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        let s = store.get_settings();
        // Each thread wrote 10 keys — all 100 should be present
        for i in 0..10 {
            for j in 0..10 {
                assert!(s.get(&format!("t{}_{}", i, j)).is_some(), "Missing t{}_{}", i, j);
            }
        }
        cleanup(&dir);
    }

    #[test]
    fn torture_concurrent_history_adds_10_threads() {
        use std::sync::Arc;
        use std::thread;
        let dir = std::env::temp_dir().join("whisperclick_test_torture_hist");
        let _ = fs::remove_dir_all(&dir);
        let store = Arc::new(Store::new(dir.clone(), false));
        let mut handles = vec![];

        for i in 0..10 {
            let s = store.clone();
            handles.push(thread::spawn(move || {
                for j in 0..5 {
                    s.add_history(serde_json::json!({"id": format!("h{}_{}", i, j), "text": "entry"}));
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        // 10 threads * 5 entries = 50 total
        assert_eq!(store.get_history().len(), 50);
        cleanup(&dir);
    }

    #[test]
    fn torture_rapid_save_load_100() {
        let (store, dir) = temp_store("rapid_save_load", false);
        for i in 0..100 {
            let mut p = serde_json::Map::new();
            p.insert("counter".into(), Value::Number(serde_json::Number::from(i)));
            store.save_settings(p);
            let s = store.get_settings();
            assert_eq!(s.get("counter").unwrap(), i);
        }
        cleanup(&dir);
    }

    #[test]
    fn torture_rapid_history_add_delete_50() {
        let (store, dir) = temp_store("rapid_add_del", false);
        for i in 0..50 {
            store.add_history(serde_json::json!({"id": format!("rd{}", i), "text": "temp"}));
            store.delete_history(&format!("rd{}", i));
        }
        assert_eq!(store.get_history().len(), 0);
        cleanup(&dir);
    }

    #[test]
    fn torture_alternating_save_reset_20() {
        let (store, dir) = temp_store("alt_save_reset", false);
        for i in 0..20 {
            let mut p = serde_json::Map::new();
            p.insert("round".into(), Value::Number(serde_json::Number::from(i)));
            store.save_settings(p);
            store.reset_settings();
        }
        // After reset, should be defaults
        assert_eq!(store.get_settings().get("mode").unwrap(), "api");
        assert!(store.get_settings().get("round").is_none());
        cleanup(&dir);
    }

    // ========================================================================
    // Edge case settings
    // ========================================================================

    #[test]
    fn settings_unicode_values() {
        let (store, dir) = temp_store("unicode_vals", false);
        let mut p = serde_json::Map::new();
        p.insert("name".into(), Value::String("日本語テスト".into()));
        p.insert("emoji".into(), Value::String("🎤🔊✅❌".into()));
        p.insert("arabic".into(), Value::String("مرحبا".into()));
        store.save_settings(p);
        let s = store.get_settings();
        assert_eq!(s.get("name").unwrap(), "日本語テスト");
        assert_eq!(s.get("emoji").unwrap(), "🎤🔊✅❌");
        assert_eq!(s.get("arabic").unwrap(), "مرحبا");
        cleanup(&dir);
    }

    #[test]
    fn settings_empty_string_values() {
        let (store, dir) = temp_store("empty_str", false);
        let mut p = serde_json::Map::new();
        p.insert("emptyField".into(), Value::String("".into()));
        store.save_settings(p);
        let s = store.get_settings();
        assert_eq!(s.get("emptyField").unwrap(), "");
        // Ensure it's a string, not null
        assert!(s.get("emptyField").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn settings_large_value_10kb() {
        let (store, dir) = temp_store("large_val", false);
        let large = "x".repeat(10 * 1024);
        let mut p = serde_json::Map::new();
        p.insert("bigData".into(), Value::String(large.clone()));
        store.save_settings(p);
        let s = store.get_settings();
        assert_eq!(s.get("bigData").unwrap().as_str().unwrap().len(), 10 * 1024);
        cleanup(&dir);
    }

    #[test]
    fn settings_boolean_types() {
        let (store, dir) = temp_store("bool_types", false);
        let mut p = serde_json::Map::new();
        p.insert("flagTrue".into(), Value::Bool(true));
        p.insert("flagFalse".into(), Value::Bool(false));
        store.save_settings(p);
        let s = store.get_settings();
        assert_eq!(s.get("flagTrue").unwrap(), &Value::Bool(true));
        assert_eq!(s.get("flagFalse").unwrap(), &Value::Bool(false));
        assert!(s.get("flagTrue").unwrap().is_boolean());
        assert!(s.get("flagFalse").unwrap().is_boolean());
        cleanup(&dir);
    }

    #[test]
    fn settings_numeric_types() {
        let (store, dir) = temp_store("num_types", false);
        let mut p = serde_json::Map::new();
        p.insert("intVal".into(), Value::Number(serde_json::Number::from(42)));
        p.insert("floatVal".into(), Value::Number(serde_json::Number::from_f64(3.14).unwrap()));
        store.save_settings(p);
        let s = store.get_settings();
        assert_eq!(s.get("intVal").unwrap(), 42);
        assert!(s.get("floatVal").unwrap().is_f64());
        cleanup(&dir);
    }

    #[test]
    fn settings_null_value() {
        let (store, dir) = temp_store("null_val", false);
        let mut p = serde_json::Map::new();
        p.insert("nothing".into(), Value::Null);
        store.save_settings(p);
        let s = store.get_settings();
        assert!(s.get("nothing").unwrap().is_null());
        cleanup(&dir);
    }

    #[test]
    fn settings_nested_object() {
        let (store, dir) = temp_store("nested_obj", false);
        let nested = serde_json::json!({"inner": {"deep": true, "list": [1,2,3]}});
        let mut p = serde_json::Map::new();
        p.insert("complex".into(), nested);
        store.save_settings(p);
        let s = store.get_settings();
        let complex = s.get("complex").unwrap();
        assert_eq!(complex["inner"]["deep"], true);
        assert_eq!(complex["inner"]["list"][1], 2);
        cleanup(&dir);
    }

    #[test]
    fn settings_array_value() {
        let (store, dir) = temp_store("arr_val", false);
        let mut p = serde_json::Map::new();
        p.insert("tags".into(), serde_json::json!(["a", "b", "c"]));
        store.save_settings(p);
        let s = store.get_settings();
        assert_eq!(s.get("tags").unwrap().as_array().unwrap().len(), 3);
        cleanup(&dir);
    }

    #[test]
    fn settings_special_chars_in_keys() {
        let (store, dir) = temp_store("special_keys", false);
        let mut p = serde_json::Map::new();
        p.insert("key-with-dash".into(), Value::String("a".into()));
        p.insert("key.with.dots".into(), Value::String("b".into()));
        p.insert("key_with_underscores".into(), Value::String("c".into()));
        store.save_settings(p);
        let s = store.get_settings();
        assert_eq!(s.get("key-with-dash").unwrap(), "a");
        assert_eq!(s.get("key.with.dots").unwrap(), "b");
        assert_eq!(s.get("key_with_underscores").unwrap(), "c");
        cleanup(&dir);
    }

    #[test]
    fn settings_overwrite_default_with_different_type() {
        let (store, dir) = temp_store("type_override", false);
        // Default "mode" is a string, overwrite with a number
        let mut p = serde_json::Map::new();
        p.insert("mode".into(), Value::Number(serde_json::Number::from(999)));
        store.save_settings(p);
        let s = store.get_settings();
        assert_eq!(s.get("mode").unwrap(), 999);
        cleanup(&dir);
    }

    // ========================================================================
    // History edge cases
    // ========================================================================

    #[test]
    fn history_duplicate_ids() {
        let (store, dir) = temp_store("dup_ids", false);
        store.add_history(serde_json::json!({"id": "dup", "text": "first"}));
        store.add_history(serde_json::json!({"id": "dup", "text": "second"}));
        let h = store.get_history();
        // Both should exist (store doesn't deduplicate)
        assert_eq!(h.len(), 2);
        // Newest first
        assert_eq!(h[0]["text"], "second");
        assert_eq!(h[1]["text"], "first");
        cleanup(&dir);
    }

    #[test]
    fn history_empty_text() {
        let (store, dir) = temp_store("empty_text", false);
        store.add_history(serde_json::json!({"id": "e1", "text": ""}));
        let h = store.get_history();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0]["text"], "");
        cleanup(&dir);
    }

    #[test]
    fn history_unicode_text() {
        let (store, dir) = temp_store("unicode_hist", false);
        store.add_history(serde_json::json!({"id": "u1", "text": "日本語テスト 🎤"}));
        store.add_history(serde_json::json!({"id": "u2", "text": "مرحبا بالعالم"}));
        store.add_history(serde_json::json!({"id": "u3", "text": "Привет мир"}));
        let h = store.get_history();
        assert_eq!(h.len(), 3);
        assert_eq!(h[0]["text"], "Привет мир");
        assert_eq!(h[1]["text"], "مرحبا بالعالم");
        assert_eq!(h[2]["text"], "日本語テスト 🎤");
        cleanup(&dir);
    }

    #[test]
    fn history_very_long_text() {
        let (store, dir) = temp_store("long_text", false);
        let long = "w".repeat(100 * 1024);
        store.add_history(serde_json::json!({"id": "long1", "text": long}));
        let h = store.get_history();
        assert_eq!(h[0]["text"].as_str().unwrap().len(), 100 * 1024);
        cleanup(&dir);
    }

    #[test]
    fn history_500_entries_cap() {
        let (store, dir) = temp_store("cap_600", false);
        for i in 0..600 {
            store.add_history(serde_json::json!({"id": format!("cap{}", i)}));
        }
        assert_eq!(store.get_history().len(), 500);
        cleanup(&dir);
    }

    #[test]
    fn history_ordering_after_500_cap() {
        let (store, dir) = temp_store("cap_order", false);
        for i in 0..600 {
            store.add_history(serde_json::json!({"id": format!("o{}", i)}));
        }
        let h = store.get_history();
        // Newest entry (o599) should be first
        assert_eq!(h[0]["id"], "o599");
        // Oldest kept entry should be o100 (first 100 dropped)
        assert_eq!(h[499]["id"], "o100");
        cleanup(&dir);
    }

    #[test]
    fn history_delete_from_empty() {
        let (store, dir) = temp_store("del_empty", false);
        // Should not crash
        store.delete_history("nonexistent");
        assert_eq!(store.get_history().len(), 0);
        cleanup(&dir);
    }

    #[test]
    fn history_clear_empty() {
        let (store, dir) = temp_store("clear_empty", false);
        // Should not crash
        store.clear_history();
        assert_eq!(store.get_history().len(), 0);
        cleanup(&dir);
    }

    #[test]
    fn history_entry_without_id() {
        let (store, dir) = temp_store("no_id_hist", false);
        store.add_history(serde_json::json!({"text": "no id here"}));
        let h = store.get_history();
        assert_eq!(h.len(), 1);
        assert!(h[0].get("id").is_none());
        cleanup(&dir);
    }

    #[test]
    fn history_entry_with_numeric_id() {
        let (store, dir) = temp_store("num_id_hist", false);
        store.add_history(serde_json::json!({"id": 42, "text": "numeric id"}));
        let h = store.get_history();
        assert_eq!(h.len(), 1);
        // delete_history looks for string id, so numeric id won't match string "42"
        store.delete_history("42");
        assert_eq!(store.get_history().len(), 1); // still there (id is number, not string)
        cleanup(&dir);
    }

    #[test]
    fn history_delete_all_with_same_id() {
        let (store, dir) = temp_store("del_all_same", false);
        store.add_history(serde_json::json!({"id": "x", "text": "1"}));
        store.add_history(serde_json::json!({"id": "x", "text": "2"}));
        store.add_history(serde_json::json!({"id": "y", "text": "3"}));
        store.delete_history("x");
        let h = store.get_history();
        // retain removes ALL matching ids
        assert_eq!(h.len(), 1);
        assert_eq!(h[0]["id"], "y");
        cleanup(&dir);
    }

    // ========================================================================
    // Atomic write safety
    // ========================================================================

    #[test]
    fn atomic_write_creates_backup() {
        let (store, dir) = temp_store("atomic_bak", false);
        let mut p1 = serde_json::Map::new();
        p1.insert("v".into(), Value::Number(serde_json::Number::from(1)));
        store.save_settings(p1);
        let mut p2 = serde_json::Map::new();
        p2.insert("v".into(), Value::Number(serde_json::Number::from(2)));
        store.save_settings(p2);
        assert!(dir.join("settings.json.bak").exists());
        cleanup(&dir);
    }

    #[test]
    fn recovery_from_missing_main_file() {
        let dir = std::env::temp_dir().join("whisperclick_test_no_main");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        // Only backup exists
        fs::write(dir.join("settings.json.bak"), r#"{"mode":"recovered"}"#).unwrap();
        let store = Store::new(dir.clone(), false);
        assert_eq!(store.get_settings().get("mode").unwrap(), "recovered");
        cleanup(&dir);
    }

    #[test]
    fn recovery_from_empty_main_file() {
        let dir = std::env::temp_dir().join("whisperclick_test_empty_main");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("settings.json"), "").unwrap();
        fs::write(dir.join("settings.json.bak"), r#"{"mode":"backup_mode"}"#).unwrap();
        let store = Store::new(dir.clone(), false);
        assert_eq!(store.get_settings().get("mode").unwrap(), "backup_mode");
        cleanup(&dir);
    }

    #[test]
    fn recovery_from_invalid_json_main() {
        let dir = std::env::temp_dir().join("whisperclick_test_invalid_main");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        fs::write(dir.join("settings.json"), "NOT JSON AT ALL").unwrap();
        fs::write(dir.join("settings.json.bak"), r#"{"theme":"light"}"#).unwrap();
        let store = Store::new(dir.clone(), false);
        assert_eq!(store.get_settings().get("theme").unwrap(), "light");
        cleanup(&dir);
    }

    #[test]
    fn recovery_from_array_json_main() {
        let dir = std::env::temp_dir().join("whisperclick_test_array_main");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        // settings.json is an array (wrong type for map)
        fs::write(dir.join("settings.json"), "[]").unwrap();
        fs::write(dir.join("settings.json.bak"), r#"{"provider":"deepgram"}"#).unwrap();
        let store = Store::new(dir.clone(), false);
        assert_eq!(store.get_settings().get("provider").unwrap(), "deepgram");
        cleanup(&dir);
    }

    #[test]
    fn history_recovery_from_object_json() {
        let dir = std::env::temp_dir().join("whisperclick_test_hist_obj");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        // history.json is an object (wrong type for array)
        fs::write(dir.join("history.json"), r#"{"not":"array"}"#).unwrap();
        fs::write(dir.join("history.json.bak"), r#"[{"id":"1","text":"ok"}]"#).unwrap();
        let store = Store::new(dir.clone(), false);
        assert_eq!(store.get_history().len(), 1);
        assert_eq!(store.get_history()[0]["text"], "ok");
        cleanup(&dir);
    }

    #[test]
    fn both_files_missing_uses_defaults() {
        let dir = std::env::temp_dir().join("whisperclick_test_both_missing");
        let _ = fs::remove_dir_all(&dir);
        // Don't even create the directory — Store::new will create it
        let store = Store::new(dir.clone(), false);
        let s = store.get_settings();
        assert_eq!(s.get("mode").unwrap(), "api");
        assert!(store.get_history().is_empty());
        cleanup(&dir);
    }

    // ========================================================================
    // Reset behavior
    // ========================================================================

    #[test]
    fn reset_preserves_nothing() {
        let (store, dir) = temp_store("reset_nothing", false);
        let mut p = serde_json::Map::new();
        p.insert("mode".into(), Value::String("local".into()));
        p.insert("theme".into(), Value::String("light".into()));
        p.insert("custom1".into(), Value::String("val1".into()));
        p.insert("custom2".into(), Value::Number(serde_json::Number::from(99)));
        store.save_settings(p);
        store.reset_settings();
        let s = store.get_settings();
        assert_eq!(s.get("mode").unwrap(), "api");
        assert_eq!(s.get("theme").unwrap(), "dark");
        assert!(s.get("custom1").is_none());
        assert!(s.get("custom2").is_none());
        cleanup(&dir);
    }

    #[test]
    fn reset_clears_only_settings_not_history() {
        let (store, dir) = temp_store("reset_not_hist", false);
        store.add_history(serde_json::json!({"id": "h1", "text": "survive reset"}));
        let mut p = serde_json::Map::new();
        p.insert("mode".into(), Value::String("local".into()));
        store.save_settings(p);
        store.reset_settings();
        // Settings reset to defaults
        assert_eq!(store.get_settings().get("mode").unwrap(), "api");
        // History still present (reset_settings doesn't touch history)
        assert_eq!(store.get_history().len(), 1);
        assert_eq!(store.get_history()[0]["text"], "survive reset");
        cleanup(&dir);
    }

    // ========================================================================
    // Persistence across instances (drop + reload)
    // ========================================================================

    #[test]
    fn settings_survive_drop_and_reload() {
        let dir = std::env::temp_dir().join("whisperclick_test_drop_reload_settings");
        let _ = fs::remove_dir_all(&dir);
        {
            let store = Store::new(dir.clone(), false);
            let mut p = serde_json::Map::new();
            p.insert("survived".into(), Value::Bool(true));
            p.insert("theme".into(), Value::String("light".into()));
            store.save_settings(p);
        } // store dropped here
        let store2 = Store::new(dir.clone(), false);
        let s = store2.get_settings();
        assert_eq!(s.get("survived").unwrap(), true);
        assert_eq!(s.get("theme").unwrap(), "light");
        cleanup(&dir);
    }

    #[test]
    fn history_survives_drop_and_reload() {
        let dir = std::env::temp_dir().join("whisperclick_test_drop_reload_hist");
        let _ = fs::remove_dir_all(&dir);
        {
            let store = Store::new(dir.clone(), false);
            store.add_history(serde_json::json!({"id": "surv1", "text": "persisted A"}));
            store.add_history(serde_json::json!({"id": "surv2", "text": "persisted B"}));
        }
        let store2 = Store::new(dir.clone(), false);
        let h = store2.get_history();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0]["id"], "surv2"); // newest first
        assert_eq!(h[1]["id"], "surv1");
        cleanup(&dir);
    }

    #[test]
    fn settings_and_history_survive_together() {
        let dir = std::env::temp_dir().join("whisperclick_test_both_survive");
        let _ = fs::remove_dir_all(&dir);
        {
            let store = Store::new(dir.clone(), false);
            let mut p = serde_json::Map::new();
            p.insert("combo".into(), Value::String("test".into()));
            store.save_settings(p);
            store.add_history(serde_json::json!({"id": "c1"}));
        }
        let store2 = Store::new(dir.clone(), false);
        assert_eq!(store2.get_settings().get("combo").unwrap(), "test");
        assert_eq!(store2.get_history().len(), 1);
        cleanup(&dir);
    }

    #[test]
    fn is_dev_flag_does_not_affect_behavior() {
        let dir = std::env::temp_dir().join("whisperclick_test_dev_flag");
        let _ = fs::remove_dir_all(&dir);
        let store_dev = Store::new(dir.clone(), true);
        let s = store_dev.get_settings();
        assert_eq!(s.get("mode").unwrap(), "api");
        cleanup(&dir);

        let dir2 = std::env::temp_dir().join("whisperclick_test_prod_flag");
        let _ = fs::remove_dir_all(&dir2);
        let store_prod = Store::new(dir2.clone(), false);
        let s2 = store_prod.get_settings();
        assert_eq!(s2.get("mode").unwrap(), "api");
        cleanup(&dir2);
    }

    #[test]
    fn multiple_patches_accumulate() {
        let (store, dir) = temp_store("multi_patch", false);
        for i in 0..20 {
            let mut p = serde_json::Map::new();
            p.insert(format!("key{}", i), Value::Number(serde_json::Number::from(i)));
            store.save_settings(p);
        }
        let s = store.get_settings();
        for i in 0..20 {
            assert_eq!(s.get(&format!("key{}", i)).unwrap(), i);
        }
        cleanup(&dir);
    }

    #[test]
    fn save_settings_empty_patch_is_noop() {
        let (store, dir) = temp_store("empty_patch", false);
        let before = store.get_settings();
        store.save_settings(serde_json::Map::new());
        let after = store.get_settings();
        assert_eq!(before, after);
        cleanup(&dir);
    }

    #[test]
    fn history_clear_then_add() {
        let (store, dir) = temp_store("clear_then_add", false);
        store.add_history(serde_json::json!({"id": "old"}));
        store.clear_history();
        store.add_history(serde_json::json!({"id": "new"}));
        let h = store.get_history();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0]["id"], "new");
        cleanup(&dir);
    }

    #[test]
    fn history_add_complex_entry() {
        let (store, dir) = temp_store("complex_entry", false);
        let entry = serde_json::json!({
            "id": "c1",
            "text": "Hello world",
            "metadata": {
                "duration": 2.5,
                "provider": "openai",
                "tokens": [1, 2, 3],
                "nested": {"a": true}
            }
        });
        store.add_history(entry);
        let h = store.get_history();
        assert_eq!(h[0]["metadata"]["duration"], 2.5);
        assert_eq!(h[0]["metadata"]["tokens"][1], 2);
        assert_eq!(h[0]["metadata"]["nested"]["a"], true);
        cleanup(&dir);
    }

    #[test]
    fn settings_persist_after_history_ops() {
        let (store, dir) = temp_store("settings_after_hist", false);
        let mut p = serde_json::Map::new();
        p.insert("important".into(), Value::String("keep".into()));
        store.save_settings(p);
        store.add_history(serde_json::json!({"id": "h1"}));
        store.clear_history();
        // Settings should be unaffected by history operations
        assert_eq!(store.get_settings().get("important").unwrap(), "keep");
        cleanup(&dir);
    }

    #[test]
    fn history_persists_after_settings_ops() {
        let (store, dir) = temp_store("hist_after_settings", false);
        store.add_history(serde_json::json!({"id": "h1", "text": "stay"}));
        let mut p = serde_json::Map::new();
        p.insert("theme".into(), Value::String("light".into()));
        store.save_settings(p);
        store.reset_settings();
        // History should be unaffected by settings operations
        assert_eq!(store.get_history().len(), 1);
        assert_eq!(store.get_history()[0]["text"], "stay");
        cleanup(&dir);
    }

    #[test]
    fn backup_contains_previous_data() {
        let dir = std::env::temp_dir().join("whisperclick_test_bak_data");
        let _ = fs::remove_dir_all(&dir);
        let store = Store::new(dir.clone(), false);
        let mut p1 = serde_json::Map::new();
        p1.insert("version".into(), Value::Number(serde_json::Number::from(1)));
        store.save_settings(p1);
        let mut p2 = serde_json::Map::new();
        p2.insert("version".into(), Value::Number(serde_json::Number::from(2)));
        store.save_settings(p2);
        // Backup should contain version 1
        let bak_content = fs::read_to_string(dir.join("settings.json.bak")).unwrap();
        let bak: Value = serde_json::from_str(&bak_content).unwrap();
        assert_eq!(bak["version"], 1);
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: Default settings key validation — every key exists with correct type
    // ========================================================================

    #[test]
    fn default_mode_is_string() {
        let (store, dir) = temp_store("dk_mode", false);
        assert!(store.get_settings().get("mode").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn default_hotkey_is_string() {
        let (store, dir) = temp_store("dk_hotkey", false);
        assert!(store.get_settings().get("hotkey").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn default_theme_is_string() {
        let (store, dir) = temp_store("dk_theme", false);
        assert!(store.get_settings().get("theme").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn default_auto_paste_is_bool() {
        let (store, dir) = temp_store("dk_autopaste", false);
        assert!(store.get_settings().get("autoPaste").unwrap().is_boolean());
        cleanup(&dir);
    }

    #[test]
    fn default_auto_start_is_bool() {
        let (store, dir) = temp_store("dk_autostart", false);
        assert!(store.get_settings().get("autoStart").unwrap().is_boolean());
        cleanup(&dir);
    }

    #[test]
    fn default_close_behavior_is_string() {
        let (store, dir) = temp_store("dk_closebehavior", false);
        assert!(store.get_settings().get("closeBehavior").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn default_sound_enabled_is_bool() {
        let (store, dir) = temp_store("dk_sound", false);
        assert!(store.get_settings().get("soundEnabled").unwrap().is_boolean());
        cleanup(&dir);
    }

    #[test]
    fn default_always_on_top_is_bool() {
        let (store, dir) = temp_store("dk_ontop", false);
        assert!(store.get_settings().get("alwaysOnTop").unwrap().is_boolean());
        cleanup(&dir);
    }

    #[test]
    fn default_show_pill_is_bool() {
        let (store, dir) = temp_store("dk_pill", false);
        assert!(store.get_settings().get("showPill").unwrap().is_boolean());
        cleanup(&dir);
    }

    #[test]
    fn default_provider_is_string() {
        let (store, dir) = temp_store("dk_provider", false);
        assert!(store.get_settings().get("provider").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn default_api_model_is_string() {
        let (store, dir) = temp_store("dk_apimodel", false);
        let s = store.get_settings();
        assert!(s.get("apiModel").unwrap().is_string());
        assert_eq!(s.get("apiModel").unwrap(), "whisper-1");
        cleanup(&dir);
    }

    #[test]
    fn default_output_mode_is_string() {
        let (store, dir) = temp_store("dk_outputmode", false);
        assert!(store.get_settings().get("outputMode").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn default_local_model_is_string() {
        let (store, dir) = temp_store("dk_localmodel", false);
        let s = store.get_settings();
        assert!(s.get("localModel").unwrap().is_string());
        assert_eq!(s.get("localModel").unwrap(), "");
        cleanup(&dir);
    }

    #[test]
    fn default_target_language_is_string() {
        let (store, dir) = temp_store("dk_targetlang", false);
        assert!(store.get_settings().get("targetLanguage").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn default_source_language_is_string() {
        let (store, dir) = temp_store("dk_sourcelang", false);
        assert!(store.get_settings().get("sourceLanguage").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn default_custom_base_url_is_string() {
        let (store, dir) = temp_store("dk_baseurl", false);
        let s = store.get_settings();
        assert!(s.get("customBaseUrl").unwrap().is_string());
        assert_eq!(s.get("customBaseUrl").unwrap(), "");
        cleanup(&dir);
    }

    #[test]
    fn default_pill_monitor_is_number() {
        let (store, dir) = temp_store("dk_pillmon", false);
        let s = store.get_settings();
        assert!(s.get("pillMonitor").unwrap().is_number());
        assert_eq!(s.get("pillMonitor").unwrap(), 0);
        cleanup(&dir);
    }

    #[test]
    fn default_audio_retention_days_is_number() {
        let (store, dir) = temp_store("dk_retention", false);
        assert!(store.get_settings().get("audioRetentionDays").unwrap().is_number());
        cleanup(&dir);
    }

    #[test]
    fn default_auto_enter_mode_is_string() {
        let (store, dir) = temp_store("dk_autoenter", false);
        assert!(store.get_settings().get("autoEnterMode").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn default_tray_click_action_is_string() {
        let (store, dir) = temp_store("dk_trayclick", false);
        let s = store.get_settings();
        assert!(s.get("trayClickAction").unwrap().is_string());
        assert_eq!(s.get("trayClickAction").unwrap(), "toggle");
        cleanup(&dir);
    }

    #[test]
    fn default_debug_logging_is_bool() {
        let (store, dir) = temp_store("dk_debuglog", false);
        assert!(store.get_settings().get("debugLogging").unwrap().is_boolean());
        cleanup(&dir);
    }

    #[test]
    fn default_update_channel_is_string() {
        let (store, dir) = temp_store("dk_updatech", false);
        assert!(store.get_settings().get("updateChannel").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn default_auto_download_updates_is_bool() {
        let (store, dir) = temp_store("dk_autoupd", false);
        assert!(store.get_settings().get("autoDownloadUpdates").unwrap().is_boolean());
        cleanup(&dir);
    }

    #[test]
    fn default_visualizer_style_is_string() {
        let (store, dir) = temp_store("dk_vizstyle", false);
        assert!(store.get_settings().get("visualizerStyle").unwrap().is_string());
        cleanup(&dir);
    }

    #[test]
    fn default_settings_has_exactly_23_keys() {
        let (store, dir) = temp_store("dk_count", false);
        let s = store.get_settings();
        assert_eq!(s.len(), 24, "Expected 24 default settings keys, got {}", s.len());
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: Unknown keys preserved (extensibility)
    // ========================================================================

    #[test]
    fn save_settings_unknown_key_preserved() {
        let (store, dir) = temp_store("unknown_key", false);
        let mut p = serde_json::Map::new();
        p.insert("futureFeatureFlag".into(), Value::Bool(true));
        store.save_settings(p);
        assert_eq!(store.get_settings().get("futureFeatureFlag").unwrap(), true);
        cleanup(&dir);
    }

    #[test]
    fn save_settings_multiple_unknown_keys_preserved() {
        let (store, dir) = temp_store("multi_unknown", false);
        let mut p = serde_json::Map::new();
        p.insert("pluginA".into(), Value::String("config_a".into()));
        p.insert("pluginB".into(), Value::Number(serde_json::Number::from(42)));
        p.insert("pluginC".into(), Value::Bool(false));
        store.save_settings(p);
        let s = store.get_settings();
        assert_eq!(s.get("pluginA").unwrap(), "config_a");
        assert_eq!(s.get("pluginB").unwrap(), 42);
        assert_eq!(s.get("pluginC").unwrap(), false);
        // defaults still present
        assert_eq!(s.get("mode").unwrap(), "api");
        cleanup(&dir);
    }

    #[test]
    fn unknown_keys_persist_across_reload() {
        let dir = std::env::temp_dir().join("whisperclick_test_unknown_persist");
        let _ = fs::remove_dir_all(&dir);
        {
            let store = Store::new(dir.clone(), false);
            let mut p = serde_json::Map::new();
            p.insert("myPlugin".into(), Value::String("data".into()));
            store.save_settings(p);
        }
        let store2 = Store::new(dir.clone(), false);
        assert_eq!(store2.get_settings().get("myPlugin").unwrap(), "data");
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: History entry field combinations
    // ========================================================================

    #[test]
    fn history_entry_minimal_fields() {
        let (store, dir) = temp_store("hist_minimal", false);
        store.add_history(serde_json::json!({"id": "m1"}));
        let h = store.get_history();
        assert_eq!(h[0]["id"], "m1");
        assert!(h[0].get("text").is_none());
        cleanup(&dir);
    }

    #[test]
    fn history_entry_all_standard_fields() {
        let (store, dir) = temp_store("hist_all_std", false);
        let entry = serde_json::json!({
            "id": "full1",
            "text": "transcribed text",
            "timestamp": "2026-03-23T12:00:00Z",
            "duration": 3.5,
            "provider": "deepgram",
            "model": "nova-2",
            "language": "en",
            "audio_file": "/tmp/rec.wav",
            "mode": "api",
            "outputMode": "transcribe"
        });
        store.add_history(entry);
        let h = store.get_history();
        assert_eq!(h[0]["text"], "transcribed text");
        assert_eq!(h[0]["duration"], 3.5);
        assert_eq!(h[0]["provider"], "deepgram");
        assert_eq!(h[0]["model"], "nova-2");
        assert_eq!(h[0]["audio_file"], "/tmp/rec.wav");
        cleanup(&dir);
    }

    #[test]
    fn history_entry_with_only_text() {
        let (store, dir) = temp_store("hist_only_text", false);
        store.add_history(serde_json::json!({"text": "just text no id"}));
        assert_eq!(store.get_history().len(), 1);
        assert_eq!(store.get_history()[0]["text"], "just text no id");
        cleanup(&dir);
    }

    #[test]
    fn history_entry_with_extra_metadata() {
        let (store, dir) = temp_store("hist_extra_meta", false);
        let entry = serde_json::json!({
            "id": "em1",
            "text": "hello",
            "customScore": 0.95,
            "tags": ["meeting", "important"],
            "nested": {"a": 1}
        });
        store.add_history(entry);
        let h = store.get_history();
        assert_eq!(h[0]["customScore"], 0.95);
        assert_eq!(h[0]["tags"][0], "meeting");
        assert_eq!(h[0]["nested"]["a"], 1);
        cleanup(&dir);
    }

    #[test]
    fn history_entry_empty_object() {
        let (store, dir) = temp_store("hist_empty_obj", false);
        store.add_history(serde_json::json!({}));
        assert_eq!(store.get_history().len(), 1);
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: Concurrent read/write settings AND history simultaneously
    // ========================================================================

    #[test]
    fn concurrent_settings_and_history_simultaneously() {
        use std::sync::Arc;
        use std::thread;
        let dir = std::env::temp_dir().join("whisperclick_test_sim_rw");
        let _ = fs::remove_dir_all(&dir);
        let store = Arc::new(Store::new(dir.clone(), false));
        let mut handles = vec![];

        // Settings writers
        for i in 0..5 {
            let s = store.clone();
            handles.push(thread::spawn(move || {
                for j in 0..10 {
                    let mut p = serde_json::Map::new();
                    p.insert(format!("sw{}_{}", i, j), Value::Number(serde_json::Number::from(j)));
                    s.save_settings(p);
                }
            }));
        }

        // History writers
        for i in 0..5 {
            let s = store.clone();
            handles.push(thread::spawn(move || {
                for j in 0..10 {
                    s.add_history(serde_json::json!({"id": format!("hw{}_{}", i, j)}));
                }
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        // All 50 settings keys present
        let settings = store.get_settings();
        for i in 0..5 {
            for j in 0..10 {
                assert!(settings.get(&format!("sw{}_{}", i, j)).is_some());
            }
        }
        // All 50 history entries present
        assert_eq!(store.get_history().len(), 50);
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: Rapid alternating between settings save and history add
    // ========================================================================

    #[test]
    fn rapid_alternating_settings_history() {
        let (store, dir) = temp_store("alt_settings_hist", false);
        for i in 0..50 {
            let mut p = serde_json::Map::new();
            p.insert(format!("alt_{}", i), Value::Number(serde_json::Number::from(i)));
            store.save_settings(p);
            store.add_history(serde_json::json!({"id": format!("ah_{}", i)}));
        }
        let s = store.get_settings();
        for i in 0..50 {
            assert!(s.get(&format!("alt_{}", i)).is_some());
        }
        assert_eq!(store.get_history().len(), 50);
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: Store creation in deeply nested directory
    // ========================================================================

    #[test]
    fn store_in_deeply_nested_directory() {
        let dir = std::env::temp_dir()
            .join("whisperclick_test_deep")
            .join("level1")
            .join("level2")
            .join("level3")
            .join("level4");
        let _ = fs::remove_dir_all(std::env::temp_dir().join("whisperclick_test_deep"));
        let store = Store::new(dir.clone(), false);
        let mut p = serde_json::Map::new();
        p.insert("deep".into(), Value::Bool(true));
        store.save_settings(p);
        assert_eq!(store.get_settings().get("deep").unwrap(), true);
        assert!(dir.join("settings.json").exists());
        let _ = fs::remove_dir_all(std::env::temp_dir().join("whisperclick_test_deep"));
    }

    // ========================================================================
    // NEW: Settings save with every JSON value type
    // ========================================================================

    #[test]
    fn settings_save_all_json_types_together() {
        let (store, dir) = temp_store("all_types", false);
        let mut p = serde_json::Map::new();
        p.insert("str".into(), Value::String("hello".into()));
        p.insert("int".into(), Value::Number(serde_json::Number::from(42)));
        p.insert("float".into(), Value::Number(serde_json::Number::from_f64(3.14).unwrap()));
        p.insert("bool_true".into(), Value::Bool(true));
        p.insert("bool_false".into(), Value::Bool(false));
        p.insert("null_val".into(), Value::Null);
        p.insert("arr".into(), serde_json::json!([1, "two", null, true]));
        p.insert("obj".into(), serde_json::json!({"nested": "value"}));
        store.save_settings(p);
        let s = store.get_settings();
        assert!(s.get("str").unwrap().is_string());
        assert!(s.get("int").unwrap().is_number());
        assert!(s.get("float").unwrap().is_f64());
        assert_eq!(s.get("bool_true").unwrap(), true);
        assert_eq!(s.get("bool_false").unwrap(), false);
        assert!(s.get("null_val").unwrap().is_null());
        assert!(s.get("arr").unwrap().is_array());
        assert!(s.get("obj").unwrap().is_object());
        cleanup(&dir);
    }

    #[test]
    fn settings_negative_number() {
        let (store, dir) = temp_store("neg_num", false);
        let mut p = serde_json::Map::new();
        p.insert("offset".into(), Value::Number(serde_json::Number::from(-100)));
        store.save_settings(p);
        assert_eq!(store.get_settings().get("offset").unwrap(), -100);
        cleanup(&dir);
    }

    #[test]
    fn settings_zero_values() {
        let (store, dir) = temp_store("zeros", false);
        let mut p = serde_json::Map::new();
        p.insert("zeroInt".into(), Value::Number(serde_json::Number::from(0)));
        p.insert("zeroFloat".into(), Value::Number(serde_json::Number::from_f64(0.0).unwrap()));
        p.insert("emptyStr".into(), Value::String("".into()));
        store.save_settings(p);
        let s = store.get_settings();
        assert_eq!(s.get("zeroInt").unwrap(), 0);
        assert_eq!(s.get("emptyStr").unwrap(), "");
        cleanup(&dir);
    }

    #[test]
    fn settings_very_long_key_name() {
        let (store, dir) = temp_store("longkey", false);
        let long_key = "k".repeat(500);
        let mut p = serde_json::Map::new();
        p.insert(long_key.clone(), Value::String("val".into()));
        store.save_settings(p);
        assert_eq!(store.get_settings().get(&long_key).unwrap(), "val");
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: History with various duration formats
    // ========================================================================

    #[test]
    fn history_entry_zero_duration() {
        let (store, dir) = temp_store("hist_zero_dur", false);
        store.add_history(serde_json::json!({"id": "zd1", "duration": 0.0}));
        assert_eq!(store.get_history()[0]["duration"], 0.0);
        cleanup(&dir);
    }

    #[test]
    fn history_entry_very_long_duration() {
        let (store, dir) = temp_store("hist_long_dur", false);
        store.add_history(serde_json::json!({"id": "ld1", "duration": 3600.0}));
        assert_eq!(store.get_history()[0]["duration"], 3600.0);
        cleanup(&dir);
    }

    #[test]
    fn history_entry_fractional_duration() {
        let (store, dir) = temp_store("hist_frac_dur", false);
        store.add_history(serde_json::json!({"id": "fd1", "duration": 0.001}));
        assert_eq!(store.get_history()[0]["duration"], 0.001);
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: Overwriting individual default keys
    // ========================================================================

    #[test]
    fn overwrite_each_default_individually() {
        let (store, dir) = temp_store("overwrite_each", false);
        let overrides: Vec<(&str, Value)> = vec![
            ("mode", Value::String("local".into())),
            ("hotkey", Value::String("ctrl+shift+r".into())),
            ("theme", Value::String("light".into())),
            ("autoPaste", Value::Bool(false)),
            ("autoStart", Value::Bool(true)),
            ("closeBehavior", Value::String("quit".into())),
            ("soundEnabled", Value::Bool(false)),
            ("alwaysOnTop", Value::Bool(true)),
            ("showPill", Value::Bool(false)),
            ("provider", Value::String("deepgram".into())),
        ];
        for (key, val) in &overrides {
            let mut p = serde_json::Map::new();
            p.insert(key.to_string(), val.clone());
            store.save_settings(p);
        }
        let s = store.get_settings();
        assert_eq!(s.get("mode").unwrap(), "local");
        assert_eq!(s.get("hotkey").unwrap(), "ctrl+shift+r");
        assert_eq!(s.get("theme").unwrap(), "light");
        assert_eq!(s.get("autoPaste").unwrap(), false);
        assert_eq!(s.get("autoStart").unwrap(), true);
        assert_eq!(s.get("closeBehavior").unwrap(), "quit");
        assert_eq!(s.get("soundEnabled").unwrap(), false);
        assert_eq!(s.get("alwaysOnTop").unwrap(), true);
        assert_eq!(s.get("showPill").unwrap(), false);
        assert_eq!(s.get("provider").unwrap(), "deepgram");
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: Concurrent read while writing (readers must not panic)
    // ========================================================================

    #[test]
    fn concurrent_readers_while_writing() {
        use std::sync::Arc;
        use std::thread;
        let dir = std::env::temp_dir().join("whisperclick_test_read_write");
        let _ = fs::remove_dir_all(&dir);
        let store = Arc::new(Store::new(dir.clone(), false));
        let mut handles = vec![];

        // Writer thread
        let sw = store.clone();
        handles.push(thread::spawn(move || {
            for i in 0..50 {
                let mut p = serde_json::Map::new();
                p.insert("counter".into(), Value::Number(serde_json::Number::from(i)));
                sw.save_settings(p);
            }
        }));

        // Reader threads
        for _ in 0..5 {
            let sr = store.clone();
            handles.push(thread::spawn(move || {
                for _ in 0..50 {
                    let s = sr.get_settings();
                    // mode default should always be present
                    assert!(s.get("mode").is_some());
                }
            }));
        }

        for h in handles {
            h.join().unwrap();
        }
        cleanup(&dir);
    }
}
