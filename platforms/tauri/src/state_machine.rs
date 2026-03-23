//! WhisperClick State Machine — single source of truth for app state.
//!
//! Port of electron/state-machine.js to Rust. Same states, same transitions,
//! same guards. The Tauri command layer uses this as the sole authority.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppState {
    Dormant,
    Recording,
    Processing,
    Success,
    Error,
}

impl AppState {
    /// Valid transitions from this state
    fn allowed_transitions(&self) -> &[AppState] {
        match self {
            AppState::Dormant => &[AppState::Recording, AppState::Error],
            AppState::Recording => &[
                AppState::Processing,
                AppState::Dormant,
                AppState::Error,
                AppState::Success,
            ],
            AppState::Processing => &[AppState::Success, AppState::Dormant, AppState::Error],
            AppState::Success => &[AppState::Dormant, AppState::Recording],
            AppState::Error => &[AppState::Dormant, AppState::Recording],
        }
    }

    pub fn can_transition_to(&self, target: AppState) -> bool {
        self.allowed_transitions().contains(&target)
    }

    pub fn can_record(&self) -> bool {
        self.can_transition_to(AppState::Recording)
    }

    pub fn can_cancel(&self) -> bool {
        matches!(self, AppState::Recording | AppState::Processing)
    }

    pub fn is_active(&self) -> bool {
        matches!(self, AppState::Recording | AppState::Processing)
    }

    pub fn is_transient(&self) -> bool {
        matches!(self, AppState::Success | AppState::Error)
    }
}

impl std::fmt::Display for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppState::Dormant => write!(f, "dormant"),
            AppState::Recording => write!(f, "recording"),
            AppState::Processing => write!(f, "processing"),
            AppState::Success => write!(f, "success"),
            AppState::Error => write!(f, "error"),
        }
    }
}

pub struct StateMachine {
    state: Mutex<AppState>,
    message: Mutex<String>,
}

impl StateMachine {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(AppState::Dormant),
            message: Mutex::new(String::new()),
        }
    }

    pub fn state(&self) -> AppState {
        *self.state.lock().unwrap()
    }

    pub fn message(&self) -> String {
        self.message.lock().unwrap().clone()
    }

    /// Attempt a state transition. Returns true if successful.
    pub fn transition(&self, to: AppState, message: Option<&str>) -> bool {
        let mut state = self.state.lock().unwrap();
        let from = *state;

        if !from.can_transition_to(to) {
            eprintln!("[state-machine] Invalid transition: {} → {}", from, to);
            return false;
        }

        *state = to;
        drop(state);

        // Update message
        let mut msg = self.message.lock().unwrap();
        if let Some(m) = message {
            *msg = m.to_string();
        } else if matches!(to, AppState::Dormant | AppState::Success) {
            msg.clear();
        }

        println!("[state-machine] {} → {}{}", from, to,
            message.map(|m| format!(" ({})", m)).unwrap_or_default());

        true
    }

    /// Force reset to dormant. Use only for error recovery.
    pub fn reset(&self, message: Option<&str>) {
        let mut state = self.state.lock().unwrap();
        let from = *state;
        *state = AppState::Dormant;
        drop(state);

        let mut msg = self.message.lock().unwrap();
        *msg = message.unwrap_or("").to_string();

        println!("[state-machine] RESET: {} → dormant{}", from,
            message.map(|m| format!(" ({})", m)).unwrap_or_default());
    }

    /// Check if current state is one of the given states
    pub fn is(&self, states: &[AppState]) -> bool {
        states.contains(&self.state())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    // === Basic state tests ===

    #[test]
    fn starts_dormant() {
        let sm = StateMachine::new();
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn starts_with_empty_message() {
        let sm = StateMachine::new();
        assert!(sm.message().is_empty());
    }

    // === Valid transition paths ===

    #[test]
    fn valid_recording_flow() {
        let sm = StateMachine::new();
        assert!(sm.transition(AppState::Recording, None));
        assert!(sm.transition(AppState::Processing, None));
        assert!(sm.transition(AppState::Success, None));
        assert!(sm.transition(AppState::Dormant, None));
    }

    #[test]
    fn cancel_during_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        assert!(sm.transition(AppState::Dormant, None));
    }

    #[test]
    fn cancel_during_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        assert!(sm.transition(AppState::Dormant, None));
    }

    #[test]
    fn error_from_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        assert!(sm.transition(AppState::Error, Some("mic failed")));
    }

    #[test]
    fn error_from_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        assert!(sm.transition(AppState::Error, Some("API error")));
    }

    #[test]
    fn error_from_dormant() {
        let sm = StateMachine::new();
        assert!(sm.transition(AppState::Error, Some("sidecar crash")));
    }

    #[test]
    fn fast_transcription_recording_to_success() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        assert!(sm.transition(AppState::Success, None));
    }

    #[test]
    fn back_to_back_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        sm.transition(AppState::Success, None);
        assert!(sm.transition(AppState::Recording, None));
    }

    #[test]
    fn record_from_error() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("test"));
        assert!(sm.transition(AppState::Recording, None));
    }

    #[test]
    fn dormant_from_error() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("test"));
        assert!(sm.transition(AppState::Dormant, None));
    }

    #[test]
    fn dormant_from_success() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(sm.transition(AppState::Dormant, None));
    }

    // === Invalid transitions ===

    #[test]
    fn invalid_dormant_to_processing() {
        let sm = StateMachine::new();
        assert!(!sm.transition(AppState::Processing, None));
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn invalid_dormant_to_success() {
        let sm = StateMachine::new();
        assert!(!sm.transition(AppState::Success, None));
    }

    #[test]
    fn invalid_recording_to_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        assert!(!sm.transition(AppState::Recording, None));
    }

    #[test]
    fn invalid_processing_to_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        assert!(!sm.transition(AppState::Recording, None));
    }

    #[test]
    fn invalid_processing_to_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        assert!(!sm.transition(AppState::Processing, None));
    }

    #[test]
    fn invalid_success_to_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(!sm.transition(AppState::Processing, None));
    }

    #[test]
    fn invalid_success_to_error() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(!sm.transition(AppState::Error, None));
    }

    #[test]
    fn invalid_error_to_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("test"));
        assert!(!sm.transition(AppState::Processing, None));
    }

    #[test]
    fn invalid_error_to_success() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("test"));
        assert!(!sm.transition(AppState::Success, None));
    }

    #[test]
    fn invalid_error_to_error() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("test"));
        assert!(!sm.transition(AppState::Error, None));
    }

    // === Message handling ===

    #[test]
    fn error_sets_message() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Error, Some("test error"));
        assert_eq!(sm.message(), "test error");
    }

    #[test]
    fn dormant_clears_message() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Error, Some("test error"));
        sm.transition(AppState::Dormant, None);
        assert!(sm.message().is_empty());
    }

    #[test]
    fn success_clears_message() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(sm.message().is_empty());
    }

    #[test]
    fn recording_preserves_message() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("old error"));
        sm.transition(AppState::Recording, None);
        assert_eq!(sm.message(), "old error");
    }

    // === State property methods ===

    #[test]
    fn can_record_states() {
        assert!(AppState::Dormant.can_record());
        assert!(!AppState::Recording.can_record());
        assert!(!AppState::Processing.can_record());
        assert!(AppState::Success.can_record());
        assert!(AppState::Error.can_record());
    }

    #[test]
    fn can_cancel_states() {
        assert!(!AppState::Dormant.can_cancel());
        assert!(AppState::Recording.can_cancel());
        assert!(AppState::Processing.can_cancel());
        assert!(!AppState::Success.can_cancel());
        assert!(!AppState::Error.can_cancel());
    }

    #[test]
    fn is_active_states() {
        assert!(!AppState::Dormant.is_active());
        assert!(AppState::Recording.is_active());
        assert!(AppState::Processing.is_active());
        assert!(!AppState::Success.is_active());
        assert!(!AppState::Error.is_active());
    }

    #[test]
    fn is_transient_states() {
        assert!(!AppState::Dormant.is_transient());
        assert!(!AppState::Recording.is_transient());
        assert!(!AppState::Processing.is_transient());
        assert!(AppState::Success.is_transient());
        assert!(AppState::Error.is_transient());
    }

    // === Display trait ===

    #[test]
    fn display_strings() {
        assert_eq!(format!("{}", AppState::Dormant), "dormant");
        assert_eq!(format!("{}", AppState::Recording), "recording");
        assert_eq!(format!("{}", AppState::Processing), "processing");
        assert_eq!(format!("{}", AppState::Success), "success");
        assert_eq!(format!("{}", AppState::Error), "error");
    }

    // === is() check ===

    #[test]
    fn is_checks_multiple_states() {
        let sm = StateMachine::new();
        assert!(sm.is(&[AppState::Dormant, AppState::Error]));
        assert!(!sm.is(&[AppState::Recording]));
    }

    #[test]
    fn is_empty_list_returns_false() {
        let sm = StateMachine::new();
        assert!(!sm.is(&[]));
    }

    // === Reset ===

    #[test]
    fn reset_from_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.reset(None);
        assert_eq!(sm.state(), AppState::Dormant);
        assert!(sm.message().is_empty());
    }

    #[test]
    fn reset_from_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        sm.reset(Some("forced"));
        assert_eq!(sm.state(), AppState::Dormant);
        assert_eq!(sm.message(), "forced");
    }

    #[test]
    fn reset_from_error() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("err"));
        sm.reset(None);
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn reset_from_success() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        sm.reset(None);
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn reset_from_dormant_is_noop() {
        let sm = StateMachine::new();
        sm.reset(None);
        assert_eq!(sm.state(), AppState::Dormant);
    }

    // === Concurrent access ===

    #[test]
    fn concurrent_transitions() {
        let sm = Arc::new(StateMachine::new());
        let handles: Vec<_> = (0..10).map(|_| {
            let sm = sm.clone();
            thread::spawn(move || {
                sm.transition(AppState::Recording, None);
            })
        }).collect();
        for h in handles { h.join().unwrap(); }
        // State machine should be in a valid state (only one transition succeeds)
        let state = sm.state();
        assert!(state == AppState::Dormant || state == AppState::Recording);
    }

    // === Multi-cycle torture test ===

    #[test]
    fn rapid_full_cycles() {
        let sm = StateMachine::new();
        for i in 0..100 {
            assert!(sm.transition(AppState::Recording, None), "cycle {} start", i);
            assert!(sm.transition(AppState::Processing, None), "cycle {} process", i);
            assert!(sm.transition(AppState::Success, None), "cycle {} success", i);
            assert!(sm.transition(AppState::Dormant, None), "cycle {} ack", i);
        }
    }

    #[test]
    fn rapid_cancel_cycles() {
        let sm = StateMachine::new();
        for _ in 0..50 {
            sm.transition(AppState::Recording, None);
            sm.transition(AppState::Dormant, None); // cancel
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn rapid_error_recovery_cycles() {
        let sm = StateMachine::new();
        for i in 0..50 {
            sm.transition(AppState::Recording, None);
            sm.transition(AppState::Error, Some(&format!("error {}", i)));
            sm.transition(AppState::Dormant, None);
        }
        assert_eq!(sm.state(), AppState::Dormant);
        assert!(sm.message().is_empty());
    }

    // === Additional stress/torture tests ===

    #[test]
    fn rapid_toggle_100_cycles() {
        let sm = StateMachine::new();
        for _ in 0..100 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Processing, None));
            assert!(sm.transition(AppState::Success, None));
            assert!(sm.transition(AppState::Dormant, None));
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn rapid_cancel_50_cycles() {
        let sm = StateMachine::new();
        for _ in 0..50 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Dormant, None)); // cancel
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn error_recovery_50_cycles() {
        let sm = StateMachine::new();
        for _ in 0..50 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Error, Some("test error")));
            assert!(sm.transition(AppState::Dormant, None));
        }
        assert_eq!(sm.state(), AppState::Dormant);
        assert!(sm.message().is_empty());
    }

    #[test]
    fn concurrent_access_stress() {
        let sm = Arc::new(StateMachine::new());
        let mut handles = vec![];

        for _ in 0..10 {
            let sm_clone = sm.clone();
            handles.push(thread::spawn(move || {
                for _ in 0..100 {
                    let _ = sm_clone.state();
                    let _ = sm_clone.message();
                    let _ = sm_clone.is(&[AppState::Dormant, AppState::Recording]);
                }
            }));
        }

        for h in handles {
            h.join().unwrap();
        }
    }

    // =========================================================================
    // Torture: Rapid state cycling
    // =========================================================================

    #[test]
    fn torture_full_cycle_1000() {
        let sm = StateMachine::new();
        for _ in 0..1000 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Processing, None));
            assert!(sm.transition(AppState::Success, None));
            assert!(sm.transition(AppState::Dormant, None));
        }
    }

    #[test]
    fn torture_record_cancel_1000() {
        let sm = StateMachine::new();
        for _ in 0..1000 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Dormant, None));
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn torture_record_error_recover_500() {
        let sm = StateMachine::new();
        for _ in 0..500 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Error, Some("crash")));
            assert!(sm.transition(AppState::Dormant, None));
        }
        assert!(sm.message().is_empty());
    }

    #[test]
    fn torture_processing_error_recover_500() {
        let sm = StateMachine::new();
        for _ in 0..500 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Processing, None));
            assert!(sm.transition(AppState::Error, Some("timeout")));
            assert!(sm.transition(AppState::Dormant, None));
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn torture_processing_cancel_500() {
        let sm = StateMachine::new();
        for _ in 0..500 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Processing, None));
            assert!(sm.transition(AppState::Dormant, None));
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn torture_success_to_record_rapid() {
        let sm = StateMachine::new();
        for _ in 0..500 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Processing, None));
            assert!(sm.transition(AppState::Success, None));
            // Immediately re-record without going through dormant
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Dormant, None));
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn torture_error_to_record_rapid() {
        let sm = StateMachine::new();
        for _ in 0..500 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Error, Some("fail")));
            // Immediately re-record from error without going through dormant
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Dormant, None));
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn torture_alternating_error_success() {
        let sm = StateMachine::new();
        for i in 0..500 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Processing, None));
            if i % 2 == 0 {
                assert!(sm.transition(AppState::Success, None));
            } else {
                assert!(sm.transition(AppState::Error, Some("alternate")));
            }
            assert!(sm.transition(AppState::Dormant, None));
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn torture_fast_transcription_1000() {
        // Recording -> Success directly (skip processing)
        let sm = StateMachine::new();
        for _ in 0..1000 {
            assert!(sm.transition(AppState::Recording, None));
            assert!(sm.transition(AppState::Success, None));
            assert!(sm.transition(AppState::Dormant, None));
        }
    }

    #[test]
    fn torture_direct_error_recover_500() {
        // Dormant -> Error -> Dormant (e.g. sidecar crash)
        let sm = StateMachine::new();
        for _ in 0..500 {
            assert!(sm.transition(AppState::Error, Some("sidecar")));
            assert!(sm.transition(AppState::Dormant, None));
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn torture_mixed_cancel_points_500() {
        let sm = StateMachine::new();
        for i in 0..500 {
            assert!(sm.transition(AppState::Recording, None));
            if i % 3 == 0 {
                // Cancel during recording
                assert!(sm.transition(AppState::Dormant, None));
            } else if i % 3 == 1 {
                assert!(sm.transition(AppState::Processing, None));
                // Cancel during processing
                assert!(sm.transition(AppState::Dormant, None));
            } else {
                assert!(sm.transition(AppState::Processing, None));
                assert!(sm.transition(AppState::Success, None));
                assert!(sm.transition(AppState::Dormant, None));
            }
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    // =========================================================================
    // Torture: Invalid transitions never corrupt state
    // =========================================================================

    #[test]
    fn torture_invalid_from_dormant_100() {
        let sm = StateMachine::new();
        for _ in 0..100 {
            assert!(!sm.transition(AppState::Processing, None));
            assert!(!sm.transition(AppState::Success, None));
            assert!(!sm.transition(AppState::Dormant, None));
            assert_eq!(sm.state(), AppState::Dormant);
        }
    }

    #[test]
    fn torture_invalid_from_recording_100() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        for _ in 0..100 {
            assert!(!sm.transition(AppState::Recording, None));
            assert_eq!(sm.state(), AppState::Recording);
        }
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_invalid_from_processing_100() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        for _ in 0..100 {
            assert!(!sm.transition(AppState::Processing, None));
            assert!(!sm.transition(AppState::Recording, None));
            assert_eq!(sm.state(), AppState::Processing);
        }
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_invalid_from_success_100() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        for _ in 0..100 {
            assert!(!sm.transition(AppState::Processing, None));
            assert!(!sm.transition(AppState::Error, None));
            assert!(!sm.transition(AppState::Success, None));
            assert_eq!(sm.state(), AppState::Success);
        }
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_invalid_from_error_100() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("test"));
        for _ in 0..100 {
            assert!(!sm.transition(AppState::Processing, None));
            assert!(!sm.transition(AppState::Success, None));
            assert!(!sm.transition(AppState::Error, None));
            assert_eq!(sm.state(), AppState::Error);
        }
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_invalid_never_changes_message() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Error, Some("preserved"));
        for _ in 0..100 {
            assert!(!sm.transition(AppState::Processing, None));
            assert_eq!(sm.message(), "preserved");
        }
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_self_transition_all_states() {
        let sm = StateMachine::new();
        // Dormant -> Dormant
        assert!(!sm.transition(AppState::Dormant, None));
        assert_eq!(sm.state(), AppState::Dormant);
        // Recording -> Recording
        sm.transition(AppState::Recording, None);
        assert!(!sm.transition(AppState::Recording, None));
        assert_eq!(sm.state(), AppState::Recording);
        // Processing -> Processing
        sm.transition(AppState::Processing, None);
        assert!(!sm.transition(AppState::Processing, None));
        assert_eq!(sm.state(), AppState::Processing);
        // Success -> Success
        sm.transition(AppState::Success, None);
        assert!(!sm.transition(AppState::Success, None));
        assert_eq!(sm.state(), AppState::Success);
        sm.transition(AppState::Dormant, None);
        // Error -> Error
        sm.transition(AppState::Error, Some("e"));
        assert!(!sm.transition(AppState::Error, None));
        assert_eq!(sm.state(), AppState::Error);
        sm.transition(AppState::Dormant, None);
    }

    // =========================================================================
    // Torture: Concurrent access under load
    // =========================================================================

    #[test]
    fn torture_concurrent_transitions_10_threads() {
        let sm = Arc::new(StateMachine::new());
        let mut handles = vec![];
        for _ in 0..10 {
            let s = sm.clone();
            handles.push(thread::spawn(move || {
                for _ in 0..1000 {
                    let _ = s.state();
                    let _ = s.message();
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
    }

    #[test]
    fn torture_concurrent_mixed_operations() {
        let sm = Arc::new(StateMachine::new());
        let mut handles = vec![];
        for _ in 0..5 {
            let s = sm.clone();
            handles.push(thread::spawn(move || {
                for _ in 0..500 {
                    let _ = s.state();
                    let _ = s.is(&[AppState::Dormant, AppState::Recording]);
                    let _ = s.message();
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
    }

    #[test]
    fn torture_concurrent_writers_10_threads() {
        let sm = Arc::new(StateMachine::new());
        let mut handles = vec![];
        for _ in 0..10 {
            let s = sm.clone();
            handles.push(thread::spawn(move || {
                for _ in 0..100 {
                    // Each thread attempts transitions; most will fail, but no panics
                    let _ = s.transition(AppState::Recording, None);
                    let _ = s.transition(AppState::Processing, None);
                    let _ = s.transition(AppState::Success, None);
                    let _ = s.transition(AppState::Dormant, None);
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        // After all threads, state must be valid
        let state = sm.state();
        assert!(matches!(
            state,
            AppState::Dormant
                | AppState::Recording
                | AppState::Processing
                | AppState::Success
                | AppState::Error
        ));
    }

    #[test]
    fn torture_concurrent_readers_and_writers() {
        let sm = Arc::new(StateMachine::new());
        let mut handles = vec![];
        // Writers
        for _ in 0..5 {
            let s = sm.clone();
            handles.push(thread::spawn(move || {
                for _ in 0..200 {
                    let _ = s.transition(AppState::Recording, None);
                    let _ = s.transition(AppState::Dormant, None);
                }
            }));
        }
        // Readers
        for _ in 0..5 {
            let s = sm.clone();
            handles.push(thread::spawn(move || {
                for _ in 0..500 {
                    let _ = s.state();
                    let _ = s.message();
                    let _ = s.is(&[AppState::Dormant, AppState::Recording]);
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
    }

    #[test]
    fn torture_concurrent_reset_contention() {
        let sm = Arc::new(StateMachine::new());
        let mut handles = vec![];
        for _ in 0..10 {
            let s = sm.clone();
            handles.push(thread::spawn(move || {
                for _ in 0..100 {
                    s.reset(None);
                    let _ = s.state();
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(sm.state(), AppState::Dormant);
    }

    // =========================================================================
    // Torture: Message handling
    // =========================================================================

    #[test]
    fn torture_error_messages_preserved() {
        let sm = StateMachine::new();
        for i in 0..100 {
            sm.transition(AppState::Recording, None);
            let msg = format!("error_{}", i);
            assert!(sm.transition(AppState::Error, Some(&msg)));
            assert!(sm.message().contains(&format!("{}", i)));
            sm.transition(AppState::Dormant, None);
        }
    }

    #[test]
    fn torture_long_error_message() {
        let sm = StateMachine::new();
        let long_msg = "x".repeat(10000);
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Error, Some(&long_msg));
        assert_eq!(sm.message().len(), 10000);
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_very_long_error_message() {
        let sm = StateMachine::new();
        let long_msg = "a".repeat(100_000);
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Error, Some(&long_msg));
        assert_eq!(sm.message().len(), 100_000);
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_empty_error_message() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Error, Some(""));
        assert_eq!(sm.message(), "");
        sm.transition(AppState::Dormant, None);
        assert!(sm.message().is_empty());
    }

    #[test]
    fn torture_unicode_error_message() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Error, Some("エラー 错误 오류 🔥"));
        assert!(sm.message().contains("🔥"));
        assert!(sm.message().contains("エラー"));
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_newline_error_message() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Error, Some("line1\nline2\nline3"));
        assert!(sm.message().contains("\n"));
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_special_chars_error_message() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(
            AppState::Error,
            Some("Error: \"null\" pointer at 0x0000 <&'static str>"),
        );
        assert!(sm.message().contains("null"));
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_message_overwrite_cycle() {
        let sm = StateMachine::new();
        for i in 0..100 {
            sm.transition(AppState::Error, Some(&format!("msg_{}", i)));
            assert_eq!(sm.message(), format!("msg_{}", i));
            sm.transition(AppState::Recording, None);
            // Message persists through recording (no clear)
            assert_eq!(sm.message(), format!("msg_{}", i));
            sm.transition(AppState::Dormant, None);
            // Dormant clears message
            assert!(sm.message().is_empty());
        }
    }

    #[test]
    fn torture_message_cleared_on_success() {
        let sm = StateMachine::new();
        for _ in 0..100 {
            sm.transition(AppState::Recording, None);
            sm.transition(AppState::Processing, None);
            sm.transition(AppState::Success, None);
            assert!(sm.message().is_empty());
            sm.transition(AppState::Dormant, None);
        }
    }

    // =========================================================================
    // Torture: Every valid and invalid transition path
    // =========================================================================

    #[test]
    fn every_valid_transition_path() {
        let sm = StateMachine::new();
        // dormant -> recording
        assert!(sm.transition(AppState::Recording, None));
        // recording -> processing
        assert!(sm.transition(AppState::Processing, None));
        // processing -> success
        assert!(sm.transition(AppState::Success, None));
        // success -> dormant
        assert!(sm.transition(AppState::Dormant, None));
        // dormant -> recording -> dormant (cancel)
        assert!(sm.transition(AppState::Recording, None));
        assert!(sm.transition(AppState::Dormant, None));
        // dormant -> recording -> processing -> dormant (cancel processing)
        assert!(sm.transition(AppState::Recording, None));
        assert!(sm.transition(AppState::Processing, None));
        assert!(sm.transition(AppState::Dormant, None));
        // dormant -> recording -> error
        assert!(sm.transition(AppState::Recording, None));
        assert!(sm.transition(AppState::Error, Some("test")));
        // error -> dormant
        assert!(sm.transition(AppState::Dormant, None));
        // dormant -> recording -> processing -> error
        assert!(sm.transition(AppState::Recording, None));
        assert!(sm.transition(AppState::Processing, None));
        assert!(sm.transition(AppState::Error, Some("test2")));
        // error -> recording (retry from error)
        assert!(sm.transition(AppState::Recording, None));
        sm.transition(AppState::Dormant, None);
        // dormant -> error (direct)
        assert!(sm.transition(AppState::Error, Some("direct")));
        assert!(sm.transition(AppState::Dormant, None));
        // success -> recording (immediate re-record)
        assert!(sm.transition(AppState::Recording, None));
        assert!(sm.transition(AppState::Processing, None));
        assert!(sm.transition(AppState::Success, None));
        assert!(sm.transition(AppState::Recording, None));
        sm.transition(AppState::Dormant, None);
        // recording -> success (fast transcription shortcut)
        assert!(sm.transition(AppState::Recording, None));
        assert!(sm.transition(AppState::Success, None));
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn every_invalid_transition() {
        let sm = StateMachine::new();
        // From dormant: cannot go to processing, success, or self
        assert!(!sm.transition(AppState::Processing, None));
        assert!(!sm.transition(AppState::Success, None));
        assert!(!sm.transition(AppState::Dormant, None));
        assert_eq!(sm.state(), AppState::Dormant);

        // From recording: cannot go to recording
        sm.transition(AppState::Recording, None);
        assert!(!sm.transition(AppState::Recording, None));
        assert_eq!(sm.state(), AppState::Recording);

        // From processing: cannot go to processing, recording
        sm.transition(AppState::Processing, None);
        assert!(!sm.transition(AppState::Processing, None));
        assert!(!sm.transition(AppState::Recording, None));
        assert_eq!(sm.state(), AppState::Processing);

        // From success: cannot go to processing, error, success
        sm.transition(AppState::Success, None);
        assert!(!sm.transition(AppState::Processing, None));
        assert!(!sm.transition(AppState::Error, None));
        assert!(!sm.transition(AppState::Success, None));
        assert_eq!(sm.state(), AppState::Success);

        sm.transition(AppState::Dormant, None);

        // From error: cannot go to processing, success, error
        sm.transition(AppState::Error, Some("test"));
        assert!(!sm.transition(AppState::Processing, None));
        assert!(!sm.transition(AppState::Success, None));
        assert!(!sm.transition(AppState::Error, None));
        assert_eq!(sm.state(), AppState::Error);

        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn exhaustive_invalid_from_dormant() {
        let sm = StateMachine::new();
        assert!(!sm.transition(AppState::Processing, None));
        assert!(!sm.transition(AppState::Success, None));
        assert!(!sm.transition(AppState::Dormant, None));
        // Valid ones still work
        assert!(sm.transition(AppState::Recording, None));
        sm.transition(AppState::Dormant, None);
        assert!(sm.transition(AppState::Error, Some("e")));
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn exhaustive_invalid_from_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        assert!(!sm.transition(AppState::Recording, None));
        // Valid: Processing, Dormant, Error, Success
        assert_eq!(sm.state(), AppState::Recording);
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn exhaustive_invalid_from_success() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(!sm.transition(AppState::Processing, None));
        assert!(!sm.transition(AppState::Error, None));
        assert!(!sm.transition(AppState::Success, None));
        // Valid: Dormant, Recording
        assert_eq!(sm.state(), AppState::Success);
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn exhaustive_invalid_from_error() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        assert!(!sm.transition(AppState::Processing, None));
        assert!(!sm.transition(AppState::Success, None));
        assert!(!sm.transition(AppState::Error, None));
        // Valid: Dormant, Recording
        assert_eq!(sm.state(), AppState::Error);
        sm.transition(AppState::Dormant, None);
    }

    // =========================================================================
    // Torture: Reset from every state
    // =========================================================================

    #[test]
    fn torture_reset_from_every_state() {
        // Reset from Dormant
        let sm = StateMachine::new();
        sm.reset(Some("reset_dormant"));
        assert_eq!(sm.state(), AppState::Dormant);
        assert_eq!(sm.message(), "reset_dormant");

        // Reset from Recording
        sm.transition(AppState::Recording, None);
        sm.reset(Some("reset_recording"));
        assert_eq!(sm.state(), AppState::Dormant);

        // Reset from Processing
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        sm.reset(Some("reset_processing"));
        assert_eq!(sm.state(), AppState::Dormant);

        // Reset from Success
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        sm.reset(Some("reset_success"));
        assert_eq!(sm.state(), AppState::Dormant);

        // Reset from Error
        sm.transition(AppState::Error, Some("err"));
        sm.reset(Some("reset_error"));
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn torture_reset_clears_message_without_arg() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("important error"));
        sm.reset(None);
        assert!(sm.message().is_empty());
    }

    #[test]
    fn torture_reset_sets_message_with_arg() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.reset(Some("forced reset"));
        assert_eq!(sm.message(), "forced reset");
    }

    #[test]
    fn torture_reset_rapid_500() {
        let sm = StateMachine::new();
        for i in 0..500 {
            // Put into various states and reset
            match i % 4 {
                0 => {
                    sm.transition(AppState::Recording, None);
                }
                1 => {
                    sm.transition(AppState::Recording, None);
                    sm.transition(AppState::Processing, None);
                }
                2 => {
                    sm.transition(AppState::Error, Some("e"));
                }
                _ => {}
            }
            sm.reset(None);
            assert_eq!(sm.state(), AppState::Dormant);
        }
    }

    #[test]
    fn torture_reset_then_normal_flow() {
        let sm = StateMachine::new();
        // Reset mid-processing, then verify normal flow still works
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        sm.reset(None);
        assert!(sm.transition(AppState::Recording, None));
        assert!(sm.transition(AppState::Processing, None));
        assert!(sm.transition(AppState::Success, None));
        assert!(sm.transition(AppState::Dormant, None));
    }

    // =========================================================================
    // Torture: is_active / is_transient / can_record / can_cancel during flows
    // =========================================================================

    #[test]
    fn torture_is_active_during_recording() {
        let sm = StateMachine::new();
        assert!(!sm.state().is_active());
        sm.transition(AppState::Recording, None);
        for _ in 0..100 {
            assert!(sm.state().is_active());
        }
        sm.transition(AppState::Dormant, None);
        assert!(!sm.state().is_active());
    }

    #[test]
    fn torture_is_active_during_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        for _ in 0..100 {
            assert!(sm.state().is_active());
        }
        sm.transition(AppState::Success, None);
        assert!(!sm.state().is_active());
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_is_active_never_true_for_inactive() {
        let sm = StateMachine::new();
        // Dormant
        assert!(!sm.state().is_active());
        // Success
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(!sm.state().is_active());
        sm.transition(AppState::Dormant, None);
        // Error
        sm.transition(AppState::Error, Some("e"));
        assert!(!sm.state().is_active());
        sm.transition(AppState::Dormant, None);
    }

    #[test]
    fn torture_can_record_tracks_through_cycle() {
        let sm = StateMachine::new();
        assert!(sm.state().can_record()); // Dormant
        sm.transition(AppState::Recording, None);
        assert!(!sm.state().can_record()); // Recording
        sm.transition(AppState::Processing, None);
        assert!(!sm.state().can_record()); // Processing
        sm.transition(AppState::Success, None);
        assert!(sm.state().can_record()); // Success
        sm.transition(AppState::Dormant, None);
        assert!(sm.state().can_record()); // Dormant again
    }

    #[test]
    fn torture_can_cancel_tracks_through_cycle() {
        let sm = StateMachine::new();
        assert!(!sm.state().can_cancel()); // Dormant
        sm.transition(AppState::Recording, None);
        assert!(sm.state().can_cancel()); // Recording
        sm.transition(AppState::Processing, None);
        assert!(sm.state().can_cancel()); // Processing
        sm.transition(AppState::Success, None);
        assert!(!sm.state().can_cancel()); // Success
        sm.transition(AppState::Dormant, None);
        assert!(!sm.state().can_cancel()); // Dormant
    }

    #[test]
    fn torture_is_transient_only_success_error() {
        let sm = StateMachine::new();
        assert!(!sm.state().is_transient()); // Dormant
        sm.transition(AppState::Recording, None);
        assert!(!sm.state().is_transient()); // Recording
        sm.transition(AppState::Processing, None);
        assert!(!sm.state().is_transient()); // Processing
        sm.transition(AppState::Success, None);
        assert!(sm.state().is_transient()); // Success
        sm.transition(AppState::Dormant, None);
        sm.transition(AppState::Error, Some("e"));
        assert!(sm.state().is_transient()); // Error
        sm.transition(AppState::Dormant, None);
    }

    // =========================================================================
    // Torture: is() helper
    // =========================================================================

    #[test]
    fn torture_is_check_all_combinations() {
        let all_states = [
            AppState::Dormant,
            AppState::Recording,
            AppState::Processing,
            AppState::Success,
            AppState::Error,
        ];
        let sm = StateMachine::new();

        // Test from Dormant
        assert!(sm.is(&[AppState::Dormant]));
        assert!(sm.is(&all_states));
        assert!(!sm.is(&[AppState::Recording, AppState::Processing]));
        assert!(!sm.is(&[]));

        // Test from Recording
        sm.transition(AppState::Recording, None);
        assert!(sm.is(&[AppState::Recording]));
        assert!(sm.is(&[AppState::Recording, AppState::Dormant]));
        assert!(!sm.is(&[AppState::Dormant]));
        sm.transition(AppState::Dormant, None);

        // Test from Processing
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        assert!(sm.is(&[AppState::Processing]));
        assert!(!sm.is(&[AppState::Recording, AppState::Dormant]));
        sm.transition(AppState::Dormant, None);

        // Test from Success
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(sm.is(&[AppState::Success]));
        sm.transition(AppState::Dormant, None);

        // Test from Error
        sm.transition(AppState::Error, Some("e"));
        assert!(sm.is(&[AppState::Error]));
        assert!(sm.is(&[AppState::Error, AppState::Success]));
        assert!(!sm.is(&[AppState::Dormant, AppState::Recording, AppState::Processing]));
        sm.transition(AppState::Dormant, None);
    }

    // =========================================================================
    // Torture: Display trait
    // =========================================================================

    #[test]
    fn torture_display_format_all_states() {
        let expected = vec![
            (AppState::Dormant, "dormant"),
            (AppState::Recording, "recording"),
            (AppState::Processing, "processing"),
            (AppState::Success, "success"),
            (AppState::Error, "error"),
        ];
        for (state, name) in &expected {
            assert_eq!(format!("{}", state), *name);
            // Also test within format strings
            assert_eq!(format!("state: {}", state), format!("state: {}", name));
        }
    }

    // =========================================================================
    // Torture: Serde round-trip
    // =========================================================================

    #[test]
    fn torture_serde_roundtrip() {
        let all_states = [
            AppState::Dormant,
            AppState::Recording,
            AppState::Processing,
            AppState::Success,
            AppState::Error,
        ];
        for state in &all_states {
            let json = serde_json::to_string(state).unwrap();
            let back: AppState = serde_json::from_str(&json).unwrap();
            assert_eq!(*state, back);
        }
    }

    #[test]
    fn torture_serde_lowercase_format() {
        assert_eq!(
            serde_json::to_string(&AppState::Dormant).unwrap(),
            "\"dormant\""
        );
        assert_eq!(
            serde_json::to_string(&AppState::Recording).unwrap(),
            "\"recording\""
        );
        assert_eq!(
            serde_json::to_string(&AppState::Processing).unwrap(),
            "\"processing\""
        );
        assert_eq!(
            serde_json::to_string(&AppState::Success).unwrap(),
            "\"success\""
        );
        assert_eq!(
            serde_json::to_string(&AppState::Error).unwrap(),
            "\"error\""
        );
    }

    // =========================================================================
    // Torture: Edge case flows
    // =========================================================================

    #[test]
    fn torture_recording_all_exit_paths() {
        // From Recording, all valid exits: Processing, Dormant, Error, Success
        let exits = [
            AppState::Processing,
            AppState::Dormant,
            AppState::Error,
            AppState::Success,
        ];
        for exit in &exits {
            let sm = StateMachine::new();
            assert!(sm.transition(AppState::Recording, None));
            assert!(
                sm.transition(
                    *exit,
                    if *exit == AppState::Error {
                        Some("e")
                    } else {
                        None
                    }
                ),
                "Recording -> {:?} should be valid",
                exit
            );
        }
    }

    #[test]
    fn torture_processing_all_exit_paths() {
        // From Processing: Success, Dormant, Error
        let exits = [AppState::Success, AppState::Dormant, AppState::Error];
        for exit in &exits {
            let sm = StateMachine::new();
            sm.transition(AppState::Recording, None);
            sm.transition(AppState::Processing, None);
            assert!(
                sm.transition(
                    *exit,
                    if *exit == AppState::Error {
                        Some("e")
                    } else {
                        None
                    }
                ),
                "Processing -> {:?} should be valid",
                exit
            );
        }
    }

    #[test]
    fn torture_error_all_exit_paths() {
        // From Error: Dormant, Recording
        let exits = [AppState::Dormant, AppState::Recording];
        for exit in &exits {
            let sm = StateMachine::new();
            sm.transition(AppState::Error, Some("e"));
            assert!(
                sm.transition(*exit, None),
                "Error -> {:?} should be valid",
                exit
            );
        }
    }

    #[test]
    fn torture_success_all_exit_paths() {
        // From Success: Dormant, Recording
        let exits = [AppState::Dormant, AppState::Recording];
        for exit in &exits {
            let sm = StateMachine::new();
            sm.transition(AppState::Recording, None);
            sm.transition(AppState::Success, None);
            assert!(
                sm.transition(*exit, None),
                "Success -> {:?} should be valid",
                exit
            );
        }
    }

    #[test]
    fn torture_dormant_all_exit_paths() {
        // From Dormant: Recording, Error
        let exits = [AppState::Recording, AppState::Error];
        for exit in &exits {
            let sm = StateMachine::new();
            assert!(
                sm.transition(
                    *exit,
                    if *exit == AppState::Error {
                        Some("e")
                    } else {
                        None
                    }
                ),
                "Dormant -> {:?} should be valid",
                exit
            );
        }
    }

    #[test]
    fn torture_allowed_transitions_count() {
        // Verify each state has the expected number of outbound transitions
        assert_eq!(AppState::Dormant.allowed_transitions().len(), 2);
        assert_eq!(AppState::Recording.allowed_transitions().len(), 4);
        assert_eq!(AppState::Processing.allowed_transitions().len(), 3);
        assert_eq!(AppState::Success.allowed_transitions().len(), 2);
        assert_eq!(AppState::Error.allowed_transitions().len(), 2);
    }

    #[test]
    fn torture_state_clone_copy() {
        let s = AppState::Recording;
        let s2 = s;
        let s3 = s.clone();
        assert_eq!(s, s2);
        assert_eq!(s, s3);
    }

    #[test]
    fn torture_state_debug_format() {
        // Ensure Debug trait works for all variants
        let all = [
            AppState::Dormant,
            AppState::Recording,
            AppState::Processing,
            AppState::Success,
            AppState::Error,
        ];
        for s in &all {
            let debug = format!("{:?}", s);
            assert!(!debug.is_empty());
        }
    }

    #[test]
    fn torture_state_eq_symmetry() {
        assert_eq!(AppState::Dormant, AppState::Dormant);
        assert_ne!(AppState::Dormant, AppState::Recording);
        assert_ne!(AppState::Recording, AppState::Processing);
        assert_ne!(AppState::Processing, AppState::Success);
        assert_ne!(AppState::Success, AppState::Error);
        assert_ne!(AppState::Error, AppState::Dormant);
    }

    #[test]
    fn torture_new_always_consistent() {
        for _ in 0..100 {
            let sm = StateMachine::new();
            assert_eq!(sm.state(), AppState::Dormant);
            assert!(sm.message().is_empty());
        }
    }

    // =========================================================================
    // NEW: Exhaustive 5x5 transition matrix — each pair as separate test
    // =========================================================================

    #[test]
    fn matrix_dormant_to_dormant_denied() {
        let sm = StateMachine::new();
        assert!(!sm.transition(AppState::Dormant, None));
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn matrix_dormant_to_recording_allowed() {
        let sm = StateMachine::new();
        assert!(sm.transition(AppState::Recording, None));
        assert_eq!(sm.state(), AppState::Recording);
    }

    #[test]
    fn matrix_dormant_to_processing_denied() {
        let sm = StateMachine::new();
        assert!(!sm.transition(AppState::Processing, None));
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn matrix_dormant_to_success_denied() {
        let sm = StateMachine::new();
        assert!(!sm.transition(AppState::Success, None));
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn matrix_dormant_to_error_allowed() {
        let sm = StateMachine::new();
        assert!(sm.transition(AppState::Error, Some("e")));
        assert_eq!(sm.state(), AppState::Error);
    }

    #[test]
    fn matrix_recording_to_dormant_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        assert!(sm.transition(AppState::Dormant, None));
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn matrix_recording_to_recording_denied() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        assert!(!sm.transition(AppState::Recording, None));
        assert_eq!(sm.state(), AppState::Recording);
    }

    #[test]
    fn matrix_recording_to_processing_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        assert!(sm.transition(AppState::Processing, None));
        assert_eq!(sm.state(), AppState::Processing);
    }

    #[test]
    fn matrix_recording_to_success_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        assert!(sm.transition(AppState::Success, None));
        assert_eq!(sm.state(), AppState::Success);
    }

    #[test]
    fn matrix_recording_to_error_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        assert!(sm.transition(AppState::Error, Some("e")));
        assert_eq!(sm.state(), AppState::Error);
    }

    #[test]
    fn matrix_processing_to_dormant_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        assert!(sm.transition(AppState::Dormant, None));
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn matrix_processing_to_recording_denied() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        assert!(!sm.transition(AppState::Recording, None));
        assert_eq!(sm.state(), AppState::Processing);
    }

    #[test]
    fn matrix_processing_to_processing_denied() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        assert!(!sm.transition(AppState::Processing, None));
        assert_eq!(sm.state(), AppState::Processing);
    }

    #[test]
    fn matrix_processing_to_success_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        assert!(sm.transition(AppState::Success, None));
        assert_eq!(sm.state(), AppState::Success);
    }

    #[test]
    fn matrix_processing_to_error_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        assert!(sm.transition(AppState::Error, Some("e")));
        assert_eq!(sm.state(), AppState::Error);
    }

    #[test]
    fn matrix_success_to_dormant_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(sm.transition(AppState::Dormant, None));
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn matrix_success_to_recording_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(sm.transition(AppState::Recording, None));
        assert_eq!(sm.state(), AppState::Recording);
    }

    #[test]
    fn matrix_success_to_processing_denied() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(!sm.transition(AppState::Processing, None));
        assert_eq!(sm.state(), AppState::Success);
    }

    #[test]
    fn matrix_success_to_success_denied() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(!sm.transition(AppState::Success, None));
        assert_eq!(sm.state(), AppState::Success);
    }

    #[test]
    fn matrix_success_to_error_denied() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(!sm.transition(AppState::Error, Some("e")));
        assert_eq!(sm.state(), AppState::Success);
    }

    #[test]
    fn matrix_error_to_dormant_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        assert!(sm.transition(AppState::Dormant, None));
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn matrix_error_to_recording_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        assert!(sm.transition(AppState::Recording, None));
        assert_eq!(sm.state(), AppState::Recording);
    }

    #[test]
    fn matrix_error_to_processing_denied() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        assert!(!sm.transition(AppState::Processing, None));
        assert_eq!(sm.state(), AppState::Error);
    }

    #[test]
    fn matrix_error_to_success_denied() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        assert!(!sm.transition(AppState::Success, None));
        assert_eq!(sm.state(), AppState::Error);
    }

    #[test]
    fn matrix_error_to_error_denied() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        assert!(!sm.transition(AppState::Error, Some("e2")));
        assert_eq!(sm.state(), AppState::Error);
    }

    // =========================================================================
    // NEW: Transition interleaved with message checks
    // =========================================================================

    #[test]
    fn transition_interleaved_message_dormant_to_recording() {
        let sm = StateMachine::new();
        assert!(sm.message().is_empty());
        sm.transition(AppState::Recording, None);
        assert!(sm.message().is_empty()); // no message set
    }

    #[test]
    fn transition_interleaved_message_recording_to_error() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Error, Some("mic fail"));
        assert_eq!(sm.message(), "mic fail");
        assert_eq!(sm.state(), AppState::Error);
    }

    #[test]
    fn transition_interleaved_message_error_to_dormant_clears() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("bad"));
        assert_eq!(sm.message(), "bad");
        sm.transition(AppState::Dormant, None);
        assert!(sm.message().is_empty());
    }

    #[test]
    fn transition_interleaved_message_success_clears() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Error, Some("err"));
        sm.transition(AppState::Recording, None);
        // message persists through Recording
        assert_eq!(sm.message(), "err");
        sm.transition(AppState::Success, None);
        // Success clears
        assert!(sm.message().is_empty());
    }

    // =========================================================================
    // NEW: State after N rapid resets
    // =========================================================================

    #[test]
    fn state_after_1000_rapid_resets() {
        let sm = StateMachine::new();
        for _ in 0..1000 {
            sm.reset(None);
        }
        assert_eq!(sm.state(), AppState::Dormant);
        assert!(sm.message().is_empty());
    }

    #[test]
    fn state_after_resets_with_messages() {
        let sm = StateMachine::new();
        for i in 0..100 {
            sm.reset(Some(&format!("reset_{}", i)));
        }
        assert_eq!(sm.state(), AppState::Dormant);
        assert_eq!(sm.message(), "reset_99");
    }

    #[test]
    fn reset_from_various_states_rapid() {
        let sm = StateMachine::new();
        for i in 0..200 {
            match i % 5 {
                0 => { sm.transition(AppState::Recording, None); }
                1 => {
                    sm.transition(AppState::Recording, None);
                    sm.transition(AppState::Processing, None);
                }
                2 => {
                    sm.transition(AppState::Recording, None);
                    sm.transition(AppState::Success, None);
                }
                3 => { sm.transition(AppState::Error, Some("e")); }
                _ => {} // dormant
            }
            sm.reset(None);
            assert_eq!(sm.state(), AppState::Dormant);
        }
    }

    // =========================================================================
    // NEW: Transition return value consistency
    // =========================================================================

    #[test]
    fn transition_return_true_means_state_changed() {
        let sm = StateMachine::new();
        let result = sm.transition(AppState::Recording, None);
        assert!(result);
        assert_eq!(sm.state(), AppState::Recording);
    }

    #[test]
    fn transition_return_false_means_state_unchanged() {
        let sm = StateMachine::new();
        let old = sm.state();
        let result = sm.transition(AppState::Processing, None);
        assert!(!result);
        assert_eq!(sm.state(), old);
    }

    #[test]
    fn transition_return_consistency_100_iterations() {
        let sm = StateMachine::new();
        for _ in 0..100 {
            let before = sm.state();
            let r = sm.transition(AppState::Processing, None);
            if r {
                assert_ne!(sm.state(), before);
            } else {
                assert_eq!(sm.state(), before);
            }
            sm.reset(None);
        }
    }
}
