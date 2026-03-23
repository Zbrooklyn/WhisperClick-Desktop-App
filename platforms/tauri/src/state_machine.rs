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
}
