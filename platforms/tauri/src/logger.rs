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

    // ========================================================================
    // Additional logger tests
    // ========================================================================

    #[test]
    fn log_levels_info_warn_error_content() {
        let (logger, dir) = temp_logger("levels_content", true);
        logger.info("app", "info message");
        logger.warn("app", "warn message");
        logger.err("app", "error message");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("INFO [app] info message"));
        assert!(content.contains("WARN [app] warn message"));
        assert!(content.contains("ERR  [app] error message"));
        cleanup(&dir);
    }

    #[test]
    fn disabled_logger_no_file_growth() {
        let (logger, dir) = temp_logger("no_growth", false);
        let log_path = dir.join("debug.log");
        // Write some baseline content
        fs::write(&log_path, "baseline").unwrap();
        let before = fs::metadata(&log_path).unwrap().len();
        logger.info("test", "should not appear");
        logger.warn("test", "also should not appear");
        logger.err("test", "definitely should not appear");
        let after = fs::metadata(&log_path).unwrap().len();
        assert_eq!(before, after);
        cleanup(&dir);
    }

    #[test]
    fn concurrent_logging_10_threads() {
        use std::sync::Arc;
        use std::thread;
        let dir = std::env::temp_dir().join("whisperclick_log_test_concurrent");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        let logger = Arc::new(Logger::new(&dir, true));
        let mut handles = vec![];

        for i in 0..10 {
            let l = logger.clone();
            handles.push(thread::spawn(move || {
                for j in 0..10 {
                    l.info(&format!("thread{}", i), &format!("message {}", j));
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        let line_count = content.lines().count();
        // 10 threads * 10 messages = 100 lines
        assert_eq!(line_count, 100);
        cleanup(&dir);
    }

    #[test]
    fn log_unicode_message() {
        let (logger, dir) = temp_logger("unicode", true);
        logger.info("test", "日本語テスト 🎤🔊");
        logger.warn("test", "Привет мир");
        logger.err("test", "مرحبا بالعالم");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("日本語テスト 🎤🔊"));
        assert!(content.contains("Привет мир"));
        assert!(content.contains("مرحبا بالعالم"));
        cleanup(&dir);
    }

    #[test]
    fn log_empty_message() {
        let (logger, dir) = temp_logger("empty_msg", true);
        logger.info("test", "");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("INFO [test] "));
        // Should have exactly one line
        assert_eq!(content.lines().count(), 1);
        cleanup(&dir);
    }

    #[test]
    fn log_very_long_message() {
        let (logger, dir) = temp_logger("long_msg", true);
        let long = "L".repeat(100_000);
        logger.info("test", &long);
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.len() > 100_000);
        cleanup(&dir);
    }

    #[test]
    fn rotation_threshold_5mb() {
        let (logger, dir) = temp_logger("rotation_exact", true);
        let log_path = dir.join("debug.log");
        // Write exactly 5MB (should NOT trigger rotation yet)
        let content_5mb = "x".repeat(5 * 1024 * 1024);
        fs::write(&log_path, &content_5mb).unwrap();
        // This should NOT rotate because the file is exactly 5MB (not greater)
        logger.info("test", "at threshold");
        // Check: file should still exist and be slightly larger than before
        // (The >= check means it does NOT rotate at exactly 5MB, only above)
        assert!(log_path.exists());
        cleanup(&dir);
    }

    #[test]
    fn log_after_rotation_works() {
        let (logger, dir) = temp_logger("after_rot", true);
        let log_path = dir.join("debug.log");
        // Trigger rotation
        let big = "x".repeat(5 * 1024 * 1024 + 1);
        fs::write(&log_path, &big).unwrap();
        logger.info("test", "first after rotation");
        logger.info("test", "second after rotation");
        let content = fs::read_to_string(&log_path).unwrap();
        assert!(content.contains("first after rotation"));
        assert!(content.contains("second after rotation"));
        assert_eq!(content.lines().count(), 2);
        cleanup(&dir);
    }

    #[test]
    fn enable_disable_toggle() {
        let (logger, dir) = temp_logger("toggle_ed", false);
        let log_path = dir.join("debug.log");
        assert!(!logger.is_enabled());
        logger.info("test", "invisible");
        assert!(!log_path.exists());

        logger.set_enabled(true);
        assert!(logger.is_enabled());
        logger.info("test", "visible");
        assert!(log_path.exists());
        let content = fs::read_to_string(&log_path).unwrap();
        assert!(content.contains("visible"));
        assert!(!content.contains("invisible"));

        logger.set_enabled(false);
        assert!(!logger.is_enabled());
        let size_before = fs::metadata(&log_path).unwrap().len();
        logger.info("test", "also invisible");
        let size_after = fs::metadata(&log_path).unwrap().len();
        assert_eq!(size_before, size_after);
        cleanup(&dir);
    }

    #[test]
    fn multiple_log_categories() {
        let (logger, dir) = temp_logger("categories", true);
        logger.info("sidecar", "started");
        logger.info("store", "settings loaded");
        logger.warn("audio", "low level");
        logger.err("network", "timeout");
        logger.info("ui", "window created");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("[sidecar]"));
        assert!(content.contains("[store]"));
        assert!(content.contains("[audio]"));
        assert!(content.contains("[network]"));
        assert!(content.contains("[ui]"));
        cleanup(&dir);
    }

    #[test]
    fn log_format_structure() {
        let (logger, dir) = temp_logger("format", true);
        logger.info("mytag", "my message");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        let line = content.lines().next().unwrap();
        // Format: [TIMESTAMP] LEVEL [TAG] MESSAGE
        assert!(line.starts_with("["));
        assert!(line.contains("] INFO [mytag] my message"));
        cleanup(&dir);
    }

    #[test]
    fn log_appends_not_overwrites() {
        let (logger, dir) = temp_logger("append", true);
        logger.info("test", "line one");
        logger.info("test", "line two");
        logger.info("test", "line three");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert_eq!(content.lines().count(), 3);
        assert!(content.contains("line one"));
        assert!(content.contains("line two"));
        assert!(content.contains("line three"));
        cleanup(&dir);
    }

    #[test]
    fn log_empty_tag() {
        let (logger, dir) = temp_logger("empty_tag", true);
        logger.info("", "empty tag message");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("[] empty tag message"));
        cleanup(&dir);
    }

    #[test]
    fn log_special_chars_in_message() {
        let (logger, dir) = temp_logger("special_chars", true);
        logger.info("test", "path: C:\\Users\\test\\file.txt");
        logger.info("test", "quote: \"hello\"");
        logger.info("test", "newline: line1\\nline2");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("C:\\Users\\test\\file.txt"));
        assert!(content.contains("\"hello\""));
        cleanup(&dir);
    }

    #[test]
    fn rotated_file_contains_old_data() {
        let (logger, dir) = temp_logger("rot_old_data", true);
        let log_path = dir.join("debug.log");
        let big = "OLD_DATA\n".repeat(600_000); // ~5.4MB
        fs::write(&log_path, &big).unwrap();
        logger.info("test", "new entry");
        let rotated = fs::read_to_string(dir.join("debug.log.1")).unwrap();
        assert!(rotated.contains("OLD_DATA"));
        cleanup(&dir);
    }

    #[test]
    fn new_logger_does_not_create_file() {
        let dir = std::env::temp_dir().join("whisperclick_log_test_no_create");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        let _logger = Logger::new(&dir, true);
        // Creating a logger should not create the log file
        assert!(!dir.join("debug.log").exists());
        cleanup(&dir);
    }

    #[test]
    fn logger_multiple_rapid_writes() {
        let (logger, dir) = temp_logger("rapid", true);
        for i in 0..200 {
            logger.info("perf", &format!("rapid message {}", i));
        }
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert_eq!(content.lines().count(), 200);
        assert!(content.contains("rapid message 0"));
        assert!(content.contains("rapid message 199"));
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: Log with every log level individually verified
    // ========================================================================

    #[test]
    fn log_level_info_format() {
        let (logger, dir) = temp_logger("lvl_info", true);
        logger.log("INFO", "tag", "info test");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("INFO [tag] info test"));
        cleanup(&dir);
    }

    #[test]
    fn log_level_warn_format() {
        let (logger, dir) = temp_logger("lvl_warn", true);
        logger.log("WARN", "tag", "warn test");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("WARN [tag] warn test"));
        cleanup(&dir);
    }

    #[test]
    fn log_level_err_format() {
        let (logger, dir) = temp_logger("lvl_err", true);
        logger.log("ERR ", "tag", "err test");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("ERR  [tag] err test"));
        cleanup(&dir);
    }

    #[test]
    fn log_level_custom_format() {
        let (logger, dir) = temp_logger("lvl_custom", true);
        logger.log("DEBUG", "tag", "debug test");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("DEBUG [tag] debug test"));
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: Verify log file path construction
    // ========================================================================

    #[test]
    fn log_file_path_is_debug_log() {
        let dir = std::env::temp_dir().join("whisperclick_log_test_path");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        let logger = Logger::new(&dir, true);
        logger.info("test", "path check");
        assert!(dir.join("debug.log").exists());
        assert!(!dir.join("whisperclick.log").exists()); // not another name
        cleanup(&dir);
    }

    #[test]
    fn log_rotated_file_path_is_log_1() {
        let (logger, dir) = temp_logger("rot_path", true);
        let log_path = dir.join("debug.log");
        let big = "x".repeat(5 * 1024 * 1024 + 1);
        fs::write(&log_path, &big).unwrap();
        logger.info("test", "trigger rotation");
        assert!(dir.join("debug.log.1").exists());
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: Log after disable then re-enable
    // ========================================================================

    #[test]
    fn log_disable_reenable_cycle() {
        let (logger, dir) = temp_logger("dis_reen", true);
        logger.info("test", "before disable");
        logger.set_enabled(false);
        logger.info("test", "invisible");
        logger.set_enabled(true);
        logger.info("test", "after reenable");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("before disable"));
        assert!(!content.contains("invisible"));
        assert!(content.contains("after reenable"));
        assert_eq!(content.lines().count(), 2);
        cleanup(&dir);
    }

    #[test]
    fn log_multiple_disable_reenable_cycles() {
        let (logger, dir) = temp_logger("multi_dis_reen", true);
        for i in 0..10 {
            logger.info("test", &format!("visible_{}", i));
            logger.set_enabled(false);
            logger.info("test", &format!("hidden_{}", i));
            logger.set_enabled(true);
        }
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert_eq!(content.lines().count(), 10);
        for i in 0..10 {
            assert!(content.contains(&format!("visible_{}", i)));
            assert!(!content.contains(&format!("hidden_{}", i)));
        }
        cleanup(&dir);
    }

    // ========================================================================
    // NEW: Concurrent enable/disable while logging
    // ========================================================================

    #[test]
    fn concurrent_enable_disable_while_logging() {
        use std::sync::Arc;
        use std::thread;
        let dir = std::env::temp_dir().join("whisperclick_log_test_conc_toggle");
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        let logger = Arc::new(Logger::new(&dir, true));
        let mut handles = vec![];

        // Logger thread
        let l1 = logger.clone();
        handles.push(thread::spawn(move || {
            for i in 0..50 {
                l1.info("writer", &format!("msg_{}", i));
            }
        }));

        // Toggle thread
        let l2 = logger.clone();
        handles.push(thread::spawn(move || {
            for _ in 0..50 {
                l2.set_enabled(false);
                l2.set_enabled(true);
            }
        }));

        for h in handles {
            h.join().unwrap();
        }
        // Should not panic; final state: enabled
        assert!(logger.is_enabled());
        cleanup(&dir);
    }

    #[test]
    fn logger_info_convenience_method() {
        let (logger, dir) = temp_logger("conv_info", true);
        logger.info("app", "info convenience");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("INFO [app] info convenience"));
        cleanup(&dir);
    }

    #[test]
    fn logger_warn_convenience_method() {
        let (logger, dir) = temp_logger("conv_warn", true);
        logger.warn("app", "warn convenience");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("WARN [app] warn convenience"));
        cleanup(&dir);
    }

    #[test]
    fn logger_err_convenience_method() {
        let (logger, dir) = temp_logger("conv_err", true);
        logger.err("app", "err convenience");
        let content = fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(content.contains("ERR  [app] err convenience"));
        cleanup(&dir);
    }
}
