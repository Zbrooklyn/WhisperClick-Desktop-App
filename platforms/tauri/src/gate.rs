//! Single input gate — the ONLY place that decides whether an action is allowed.
//!
//! Port of canAcceptAction() from electron/main.js to Rust.

use crate::state_machine::{AppState, StateMachine};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct GateResult {
    pub allowed: bool,
    pub error: Option<String>,
    pub actual_action: Option<String>,
}

impl GateResult {
    fn allow(action: &str) -> Self {
        Self {
            allowed: true,
            error: None,
            actual_action: Some(action.to_string()),
        }
    }

    fn deny(reason: &str) -> Self {
        Self {
            allowed: false,
            error: Some(reason.to_string()),
            actual_action: None,
        }
    }
}

pub fn can_accept_action(
    sm: &StateMachine,
    action: &str,
    has_api_key: bool,
    mode: &str,
) -> GateResult {
    let mut action = action.to_string();
    let state = sm.state();

    if action == "toggle" {
        if state == AppState::Recording {
            return GateResult::allow("stop");
        }
        if state == AppState::Processing {
            return GateResult::allow("cancel");
        }
        action = "start".to_string();
    }

    if action == "stop" {
        if state != AppState::Recording {
            return GateResult::deny("Not recording");
        }
        return GateResult::allow("stop");
    }

    if action == "cancel" {
        if !state.can_cancel() {
            return GateResult::deny("Nothing to cancel");
        }
        return GateResult::allow("cancel");
    }

    if action == "start" {
        if !state.can_record() {
            return GateResult::deny(&format!("Cannot start recording ({})", state));
        }
        if mode == "api" && !has_api_key {
            return GateResult::deny("No API key configured. Open Settings to add one.");
        }
        return GateResult::allow("start");
    }

    GateResult::deny(&format!("Unknown action: {}", action))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_from_dormant() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    #[test]
    fn start_rejected_without_key() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("API key"));
    }

    #[test]
    fn start_allowed_in_local_mode_without_key() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, "local");
        assert!(r.allowed);
    }

    #[test]
    fn toggle_from_dormant_becomes_start() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    #[test]
    fn toggle_from_recording_becomes_stop() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "stop");
    }

    #[test]
    fn toggle_from_processing_becomes_cancel() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "cancel");
    }

    #[test]
    fn cancel_from_dormant_rejected() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(!r.allowed);
    }

    #[test]
    fn start_from_success() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(r.allowed);
    }
}
