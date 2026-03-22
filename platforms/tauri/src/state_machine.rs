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

    #[test]
    fn starts_dormant() {
        let sm = StateMachine::new();
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn valid_recording_flow() {
        let sm = StateMachine::new();
        assert!(sm.transition(AppState::Recording, None));
        assert!(sm.transition(AppState::Processing, None));
        assert!(sm.transition(AppState::Success, None));
        assert!(sm.transition(AppState::Dormant, None));
    }

    #[test]
    fn invalid_transition_rejected() {
        let sm = StateMachine::new();
        assert!(!sm.transition(AppState::Processing, None));
        assert_eq!(sm.state(), AppState::Dormant);
    }

    #[test]
    fn cancel_during_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        assert!(sm.transition(AppState::Dormant, None));
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
    fn error_recovery() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Error, Some("test error"));
        assert_eq!(sm.message(), "test error");
        assert!(sm.transition(AppState::Dormant, None));
        assert!(sm.message().is_empty());
    }

    #[test]
    fn can_record_from_success() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        assert!(sm.state().can_record());
    }

    #[test]
    fn can_cancel_during_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        assert!(sm.state().can_cancel());
    }

    #[test]
    fn reset_from_any_state() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        sm.reset(Some("forced"));
        assert_eq!(sm.state(), AppState::Dormant);
        assert_eq!(sm.message(), "forced");
    }
}
