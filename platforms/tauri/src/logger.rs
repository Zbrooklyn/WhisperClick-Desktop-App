//! File logger — writes timestamped log entries to debug.log.
//!
//! Matches Electron logger.js: file rotation at 5MB, runtime enable/disable.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024; // 5 MB

pub struct Logger {
    path: PathBuf,
    enabled: Mutex<bool>,
}

impl Logger {
    pub fn new(config_dir: &PathBuf, enabled: bool) -> Self {
        let path = config_dir.join("debug.log");
        Self {
            path,
            enabled: Mutex::new(enabled),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        *self.enabled.lock().unwrap() = enabled;
    }

    pub fn is_enabled(&self) -> bool {
        *self.enabled.lock().unwrap()
    }

    pub fn log(&self, level: &str, tag: &str, message: &str) {
        if !self.is_enabled() {
            return;
        }

        // Rotate if needed
        if let Ok(meta) = fs::metadata(&self.path) {
            if meta.len() > MAX_LOG_SIZE {
                let rotated = self.path.with_extension("log.1");
                let _ = fs::rename(&self.path, &rotated);
            }
        }

        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let line = format!("[{}] {} [{}] {}\n", timestamp, level, tag, message);

        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&self.path) {
            let _ = file.write_all(line.as_bytes());
        }
    }

    pub fn info(&self, tag: &str, message: &str) {
        self.log("INFO", tag, message);
    }

    pub fn warn(&self, tag: &str, message: &str) {
        self.log("WARN", tag, message);
    }

    pub fn err(&self, tag: &str, message: &str) {
        self.log("ERR ", tag, message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_logger(name: &str, enabled: bool) -> (Logger, PathBuf) {
        let dir = std::env::temp_dir().join(format!("whisperclick_log_test_{}", name));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        (Logger::new(&dir, enabled), dir)
    }

    fn cleanup(dir: &PathBuf) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn disabled_logger_writes_nothing() {
        let (logger, dir) = temp_logger("disabled", false);
        logger.info("test", "should not appear");
        let log_path = dir.join("debug.log");
        assert!(!log_path.exists());
        cleanup(&dir);
    }

    #[test]
    fn enabled_logger_writes_to_file() {
        let (logger, dir) = temp_logger("enabled", true);
        logger.info("test", "hello world");
        let log_path = dir.join("debug.log");
        assert!(log_path.exists());
        let content = fs::read_to_string(&log_path).unwrap();
        assert!(content.contains("[test]"));
        assert!(content.contains("hello world"));
        assert!(content.contains("INFO"));
        cleanup(&dir);
    }

    #[test]
    fn multiple_log_levels() {
        let (logger, dir) = temp_logger("levels", true);
        logger.info("a", "info msg");
        logger.warn("b", "warn msg");
        logger.err("c", "err msg");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("INFO"));
        assert!(content.contains("WARN"));
        assert!(content.contains("ERR"));
        cleanup(&dir);
    }

    #[test]
    fn log_entries_are_timestamped() {
        let (logger, dir) = temp_logger("timestamp", true);
        logger.info("test", "timed");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        // Should have YYYY-MM-DD format
        assert!(content.contains("202"));
        cleanup(&dir);
    }

    #[test]
    fn set_enabled_toggles_logging() {
        let (logger, dir) = temp_logger("toggle", false);
        logger.info("test", "should not appear");
        assert!(!dir.join("debug.log").exists());
        logger.set_enabled(true);
        logger.info("test", "should appear");
        assert!(dir.join("debug.log").exists());
        cleanup(&dir);
    }

    #[test]
    fn is_enabled_returns_state() {
        let (logger, dir) = temp_logger("check", true);
        assert!(logger.is_enabled());
        logger.set_enabled(false);
        assert!(!logger.is_enabled());
        cleanup(&dir);
    }

    #[test]
    fn log_rotation_at_5mb() {
        let (logger, dir) = temp_logger("rotation", true);
        let log_path = dir.join("debug.log");
        // Write a 5MB+ file directly
        let big_content = "x".repeat(5 * 1024 * 1024 + 1);
        fs::write(&log_path, &big_content).unwrap();
        // Next log should trigger rotation
        logger.info("test", "after rotation");
        assert!(dir.join("debug.log.1").exists());
        // New debug.log should be small (just the new entry)
        let new_size = fs::metadata(&log_path).unwrap().len();
        assert!(new_size < 1000);
        cleanup(&dir);
    }
}
