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

    // === Start action ===

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
    fn start_from_success() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(r.allowed);
    }

    #[test]
    fn start_from_error() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("test"));
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(r.allowed);
    }

    #[test]
    fn start_rejected_during_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Cannot start"));
    }

    #[test]
    fn start_rejected_during_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(!r.allowed);
    }

    // === Stop action ===

    #[test]
    fn stop_from_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "stop", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "stop");
    }

    #[test]
    fn stop_rejected_from_dormant() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "stop", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Not recording"));
    }

    #[test]
    fn stop_rejected_from_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        let r = can_accept_action(&sm, "stop", true, "api");
        assert!(!r.allowed);
    }

    // === Cancel action ===

    #[test]
    fn cancel_from_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "cancel");
    }

    #[test]
    fn cancel_from_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(r.allowed);
    }

    #[test]
    fn cancel_from_dormant_rejected() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Nothing to cancel"));
    }

    #[test]
    fn cancel_from_success_rejected() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(!r.allowed);
    }

    #[test]
    fn cancel_from_error_rejected() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("test"));
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(!r.allowed);
    }

    // === Toggle action ===

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
    fn toggle_from_success_becomes_start() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    #[test]
    fn toggle_from_error_becomes_start() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("test"));
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    #[test]
    fn toggle_without_key_in_api_mode() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "toggle", false, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("API key"));
    }

    #[test]
    fn toggle_without_key_in_local_mode() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "toggle", false, "local");
        assert!(r.allowed);
    }

    // === Unknown action ===

    #[test]
    fn unknown_action_rejected() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "invalid_action", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Unknown action"));
    }

    // === GateResult denied has no actual_action ===

    #[test]
    fn denied_result_has_no_action() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(!r.allowed);
        assert!(r.actual_action.is_none());
    }

    // === Stress/edge case tests ===

    #[test]
    fn gate_rapid_toggle_stress() {
        let sm = StateMachine::new();
        for _ in 0..100 {
            let r = can_accept_action(&sm, "toggle", true, "local");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("start"));
        }
    }

    #[test]
    fn gate_all_actions_from_all_states() {
        let actions = ["start", "stop", "cancel", "toggle", "unknown_action"];

        // Dormant
        let sm = StateMachine::new();
        for action in &actions {
            let r = can_accept_action(&sm, action, true, "api");
            let _ = r.allowed;
            let _ = r.actual_action;
            let _ = r.error;
        }

        // Recording
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        for action in &actions {
            let r = can_accept_action(&sm, action, true, "api");
            let _ = r.allowed;
            let _ = r.actual_action;
            let _ = r.error;
        }

        // Processing
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        for action in &actions {
            let r = can_accept_action(&sm, action, true, "api");
            let _ = r.allowed;
            let _ = r.actual_action;
            let _ = r.error;
        }

        // Success
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        for action in &actions {
            let r = can_accept_action(&sm, action, true, "api");
            let _ = r.allowed;
            let _ = r.actual_action;
            let _ = r.error;
        }

        // Error
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("test"));
        for action in &actions {
            let r = can_accept_action(&sm, action, true, "api");
            let _ = r.allowed;
            let _ = r.actual_action;
            let _ = r.error;
        }
    }

    // =========================================================================
    // Exhaustive gate matrix: (state, action, mode, has_key) -> expected
    // =========================================================================

    // --- API mode, no key ---

    #[test]
    fn gate_api_mode_no_key_rejects_start() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("API key"));
    }

    #[test]
    fn gate_api_mode_no_key_rejects_toggle_from_dormant() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "toggle", false, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("API key"));
    }

    #[test]
    fn gate_api_mode_no_key_rejects_toggle_from_success() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        let r = can_accept_action(&sm, "toggle", false, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("API key"));
    }

    #[test]
    fn gate_api_mode_no_key_rejects_toggle_from_error() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        let r = can_accept_action(&sm, "toggle", false, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("API key"));
    }

    #[test]
    fn gate_api_mode_no_key_allows_stop() {
        // stop doesn't care about API key
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "stop", false, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "stop");
    }

    #[test]
    fn gate_api_mode_no_key_allows_cancel() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "cancel", false, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "cancel");
    }

    #[test]
    fn gate_api_mode_no_key_toggle_from_recording_allows_stop() {
        // Toggle from recording becomes stop, which doesn't need a key
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "toggle", false, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "stop");
    }

    #[test]
    fn gate_api_mode_no_key_toggle_from_processing_allows_cancel() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        let r = can_accept_action(&sm, "toggle", false, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "cancel");
    }

    // --- API mode, with key ---

    #[test]
    fn gate_api_mode_with_key_allows_start() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    #[test]
    fn gate_api_mode_with_key_allows_toggle_from_dormant() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    // --- Local mode, no key ---

    #[test]
    fn gate_local_mode_no_key_allows_start() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, "local");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    #[test]
    fn gate_local_mode_no_key_allows_toggle() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "toggle", false, "local");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    // --- Local mode, with key ---

    #[test]
    fn gate_local_mode_with_key_allows_start() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", true, "local");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    // --- Stop action exhaustive ---

    #[test]
    fn gate_stop_from_recording_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "stop", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "stop");
    }

    #[test]
    fn gate_stop_from_dormant_rejected() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "stop", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Not recording"));
    }

    #[test]
    fn gate_stop_from_processing_rejected() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        let r = can_accept_action(&sm, "stop", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Not recording"));
    }

    #[test]
    fn gate_stop_from_success_rejected() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        let r = can_accept_action(&sm, "stop", true, "api");
        assert!(!r.allowed);
    }

    #[test]
    fn gate_stop_from_error_rejected() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        let r = can_accept_action(&sm, "stop", true, "api");
        assert!(!r.allowed);
    }

    // --- Cancel action exhaustive ---

    #[test]
    fn gate_cancel_from_recording_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "cancel");
    }

    #[test]
    fn gate_cancel_from_processing_allowed() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "cancel");
    }

    #[test]
    fn gate_cancel_from_dormant_rejected() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Nothing to cancel"));
    }

    #[test]
    fn gate_cancel_from_success_rejected_exhaustive() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Nothing to cancel"));
    }

    #[test]
    fn gate_cancel_from_error_rejected_exhaustive() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Nothing to cancel"));
    }

    // --- Toggle action exhaustive ---

    #[test]
    fn gate_toggle_from_dormant_produces_start() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    #[test]
    fn gate_toggle_from_recording_produces_stop() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "stop");
    }

    #[test]
    fn gate_toggle_from_processing_produces_cancel() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "cancel");
    }

    #[test]
    fn gate_toggle_from_success_produces_start() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    #[test]
    fn gate_toggle_from_error_produces_start() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "start");
    }

    // --- Start from every recordable state ---

    #[test]
    fn gate_start_from_dormant_api_with_key() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(r.allowed);
    }

    #[test]
    fn gate_start_from_success_api_with_key() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(r.allowed);
    }

    #[test]
    fn gate_start_from_error_api_with_key() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(r.allowed);
    }

    #[test]
    fn gate_start_from_recording_rejected() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Cannot start"));
    }

    #[test]
    fn gate_start_from_processing_rejected() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Cannot start"));
    }

    // --- Unknown action from every state ---

    #[test]
    fn gate_unknown_action_from_dormant() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "foobar", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Unknown action"));
    }

    #[test]
    fn gate_unknown_action_from_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "pause", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Unknown action"));
    }

    #[test]
    fn gate_unknown_action_from_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        let r = can_accept_action(&sm, "resume", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Unknown action"));
    }

    #[test]
    fn gate_empty_action_rejected() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Unknown action"));
    }

    // --- Stress: rapid gate calls ---

    #[test]
    fn gate_1000_toggles_from_dormant() {
        let sm = StateMachine::new();
        for _ in 0..1000 {
            let r = can_accept_action(&sm, "toggle", true, "api");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("start"));
        }
    }

    #[test]
    fn gate_1000_starts_from_dormant() {
        let sm = StateMachine::new();
        for _ in 0..1000 {
            let r = can_accept_action(&sm, "start", true, "api");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("start"));
        }
    }

    #[test]
    fn gate_1000_stops_from_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        for _ in 0..1000 {
            let r = can_accept_action(&sm, "stop", true, "api");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("stop"));
        }
    }

    #[test]
    fn gate_1000_cancels_from_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        for _ in 0..1000 {
            let r = can_accept_action(&sm, "cancel", true, "api");
            assert!(r.allowed);
        }
    }

    #[test]
    fn gate_1000_toggles_from_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        for _ in 0..1000 {
            let r = can_accept_action(&sm, "toggle", true, "api");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("stop"));
        }
    }

    #[test]
    fn gate_1000_toggles_from_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        for _ in 0..1000 {
            let r = can_accept_action(&sm, "toggle", true, "api");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("cancel"));
        }
    }

    #[test]
    fn gate_1000_rejected_starts_from_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        for _ in 0..1000 {
            let r = can_accept_action(&sm, "start", true, "api");
            assert!(!r.allowed);
        }
    }

    // --- Triple loop: all actions x all states x both modes ---

    #[test]
    fn gate_all_actions_all_states_all_modes() {
        let actions = ["start", "stop", "cancel", "toggle"];
        let modes = ["api", "local"];
        let has_keys = [true, false];

        for action in &actions {
            for mode in &modes {
                for &has_key in &has_keys {
                    // Dormant
                    {
                        let sm = StateMachine::new();
                        let r = can_accept_action(&sm, action, has_key, mode);
                        // Just verify no panics, result is consistent
                        assert!(r.allowed || r.error.is_some());
                        if r.allowed {
                            assert!(r.actual_action.is_some());
                        } else {
                            assert!(r.actual_action.is_none());
                        }
                    }
                    // Recording
                    {
                        let sm = StateMachine::new();
                        sm.transition(AppState::Recording, None);
                        let r = can_accept_action(&sm, action, has_key, mode);
                        assert!(r.allowed || r.error.is_some());
                        if r.allowed {
                            assert!(r.actual_action.is_some());
                        } else {
                            assert!(r.actual_action.is_none());
                        }
                    }
                    // Processing
                    {
                        let sm = StateMachine::new();
                        sm.transition(AppState::Recording, None);
                        sm.transition(AppState::Processing, None);
                        let r = can_accept_action(&sm, action, has_key, mode);
                        assert!(r.allowed || r.error.is_some());
                        if r.allowed {
                            assert!(r.actual_action.is_some());
                        } else {
                            assert!(r.actual_action.is_none());
                        }
                    }
                    // Success
                    {
                        let sm = StateMachine::new();
                        sm.transition(AppState::Recording, None);
                        sm.transition(AppState::Success, None);
                        let r = can_accept_action(&sm, action, has_key, mode);
                        assert!(r.allowed || r.error.is_some());
                        if r.allowed {
                            assert!(r.actual_action.is_some());
                        } else {
                            assert!(r.actual_action.is_none());
                        }
                    }
                    // Error
                    {
                        let sm = StateMachine::new();
                        sm.transition(AppState::Error, Some("e"));
                        let r = can_accept_action(&sm, action, has_key, mode);
                        assert!(r.allowed || r.error.is_some());
                        if r.allowed {
                            assert!(r.actual_action.is_some());
                        } else {
                            assert!(r.actual_action.is_none());
                        }
                    }
                }
            }
        }
    }

    // --- GateResult structural invariants ---

    #[test]
    fn gate_allowed_always_has_action() {
        // For every allowed result, actual_action must be Some
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(r.allowed);
        assert!(r.actual_action.is_some());
        assert!(r.error.is_none());
    }

    #[test]
    fn gate_denied_always_has_error() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "stop", true, "api");
        assert!(!r.allowed);
        assert!(r.actual_action.is_none());
        assert!(r.error.is_some());
    }

    #[test]
    fn gate_denied_error_message_never_empty() {
        // Every denied result should have a non-empty error message
        let sm = StateMachine::new();
        let denied_cases: Vec<GateResult> = vec![
            can_accept_action(&sm, "stop", true, "api"), // Not recording
            can_accept_action(&sm, "cancel", true, "api"), // Nothing to cancel
            can_accept_action(&sm, "start", false, "api"), // No API key
            can_accept_action(&sm, "unknown", true, "api"), // Unknown action
        ];
        for r in denied_cases {
            assert!(!r.allowed);
            let err = r.error.unwrap();
            assert!(!err.is_empty(), "Error message should not be empty");
        }
    }

    // --- Mode edge cases ---

    #[test]
    fn gate_unknown_mode_treated_as_non_api() {
        // Any mode that isn't "api" should not require a key
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, "hybrid");
        assert!(r.allowed);
    }

    #[test]
    fn gate_empty_mode_string() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, "");
        assert!(r.allowed);
    }

    #[test]
    fn gate_case_sensitive_mode() {
        // "API" (uppercase) is not "api" — should not require key
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, "API");
        assert!(r.allowed);
    }

    #[test]
    fn gate_case_sensitive_action() {
        // "Start" (capitalized) is an unknown action
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "Start", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Unknown action"));
    }

    // --- Integration: gate + state machine together ---

    #[test]
    fn gate_full_recording_cycle_integration() {
        let sm = StateMachine::new();

        // Start
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.as_deref(), Some("start"));
        sm.transition(AppState::Recording, None);

        // Stop
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.as_deref(), Some("stop"));
        sm.transition(AppState::Processing, None);

        // Cancel (while processing)
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.as_deref(), Some("cancel"));
        sm.transition(AppState::Dormant, None);

        // Start again
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        assert_eq!(r.actual_action.as_deref(), Some("start"));
    }

    #[test]
    fn gate_full_cycle_100_iterations() {
        let sm = StateMachine::new();
        for _ in 0..100 {
            let r = can_accept_action(&sm, "toggle", true, "local");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("start"));
            sm.transition(AppState::Recording, None);

            let r = can_accept_action(&sm, "toggle", true, "local");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("stop"));
            sm.transition(AppState::Processing, None);
            sm.transition(AppState::Success, None);
            sm.transition(AppState::Dormant, None);
        }
    }

    #[test]
    fn gate_error_recovery_cycle_100() {
        let sm = StateMachine::new();
        for _ in 0..100 {
            let r = can_accept_action(&sm, "start", true, "api");
            assert!(r.allowed);
            sm.transition(AppState::Recording, None);
            sm.transition(AppState::Error, Some("fail"));

            // From error, can start again
            let r = can_accept_action(&sm, "start", true, "api");
            assert!(r.allowed);
            sm.transition(AppState::Dormant, None);
        }
    }

    // =========================================================================
    // NEW: Every action with empty/unusual mode strings
    // =========================================================================

    #[test]
    fn gate_start_with_empty_mode_no_key() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, "");
        assert!(r.allowed); // empty mode != "api", so no key required
    }

    #[test]
    fn gate_start_with_whitespace_mode() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, " api ");
        assert!(r.allowed); // " api " != "api"
    }

    #[test]
    fn gate_stop_with_empty_mode() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "stop", false, "");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "stop");
    }

    #[test]
    fn gate_cancel_with_empty_mode() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "cancel", false, "");
        assert!(r.allowed);
        assert_eq!(r.actual_action.unwrap(), "cancel");
    }

    #[test]
    fn gate_toggle_with_empty_mode_no_key() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "toggle", false, "");
        assert!(r.allowed); // empty mode != "api"
    }

    // =========================================================================
    // NEW: Denied results never have an action field
    // =========================================================================

    #[test]
    fn gate_denied_no_action_start_no_key() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, "api");
        assert!(!r.allowed);
        assert!(r.actual_action.is_none());
    }

    #[test]
    fn gate_denied_no_action_stop_from_dormant() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "stop", true, "api");
        assert!(!r.allowed);
        assert!(r.actual_action.is_none());
    }

    #[test]
    fn gate_denied_no_action_cancel_from_dormant() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(!r.allowed);
        assert!(r.actual_action.is_none());
    }

    #[test]
    fn gate_denied_no_action_unknown_action() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "rewind", true, "api");
        assert!(!r.allowed);
        assert!(r.actual_action.is_none());
    }

    #[test]
    fn gate_denied_no_action_start_during_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(!r.allowed);
        assert!(r.actual_action.is_none());
    }

    #[test]
    fn gate_denied_no_action_start_during_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(!r.allowed);
        assert!(r.actual_action.is_none());
    }

    // =========================================================================
    // NEW: Allowed results always have a non-empty action
    // =========================================================================

    #[test]
    fn gate_allowed_action_non_empty_start() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", true, "api");
        assert!(r.allowed);
        let action = r.actual_action.unwrap();
        assert!(!action.is_empty());
    }

    #[test]
    fn gate_allowed_action_non_empty_stop() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "stop", true, "api");
        assert!(r.allowed);
        let action = r.actual_action.unwrap();
        assert!(!action.is_empty());
    }

    #[test]
    fn gate_allowed_action_non_empty_cancel() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "cancel", true, "api");
        assert!(r.allowed);
        let action = r.actual_action.unwrap();
        assert!(!action.is_empty());
    }

    #[test]
    fn gate_allowed_action_non_empty_toggle() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "toggle", true, "api");
        assert!(r.allowed);
        let action = r.actual_action.unwrap();
        assert!(!action.is_empty());
    }

    // =========================================================================
    // NEW: Per-action stress — 500x from valid states
    // =========================================================================

    #[test]
    fn gate_500x_start_from_dormant() {
        let sm = StateMachine::new();
        for _ in 0..500 {
            let r = can_accept_action(&sm, "start", true, "api");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("start"));
        }
    }

    #[test]
    fn gate_500x_stop_from_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        for _ in 0..500 {
            let r = can_accept_action(&sm, "stop", true, "api");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("stop"));
        }
    }

    #[test]
    fn gate_500x_cancel_from_recording() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        for _ in 0..500 {
            let r = can_accept_action(&sm, "cancel", true, "api");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("cancel"));
        }
    }

    #[test]
    fn gate_500x_cancel_from_processing() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Processing, None);
        for _ in 0..500 {
            let r = can_accept_action(&sm, "cancel", true, "api");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("cancel"));
        }
    }

    #[test]
    fn gate_500x_start_from_success() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        sm.transition(AppState::Success, None);
        for _ in 0..500 {
            let r = can_accept_action(&sm, "start", true, "api");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("start"));
        }
    }

    #[test]
    fn gate_500x_start_from_error() {
        let sm = StateMachine::new();
        sm.transition(AppState::Error, Some("e"));
        for _ in 0..500 {
            let r = can_accept_action(&sm, "start", true, "api");
            assert!(r.allowed);
            assert_eq!(r.actual_action.as_deref(), Some("start"));
        }
    }

    // =========================================================================
    // NEW: Action with partial settings (only mode set, no provider)
    // =========================================================================

    #[test]
    fn gate_partial_settings_local_mode_start() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, "local");
        assert!(r.allowed);
    }

    #[test]
    fn gate_partial_settings_api_mode_needs_key() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "start", false, "api");
        assert!(!r.allowed);
    }

    // =========================================================================
    // NEW: Multiple unknown actions
    // =========================================================================

    #[test]
    fn gate_unknown_action_pause() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "pause", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Unknown action: pause"));
    }

    #[test]
    fn gate_unknown_action_resume() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "resume", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Unknown action: resume"));
    }

    #[test]
    fn gate_unknown_action_restart() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "restart", true, "api");
        assert!(!r.allowed);
        assert!(r.error.unwrap().contains("Unknown action: restart"));
    }

    #[test]
    fn gate_unknown_action_with_spaces() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, " start ", true, "api");
        assert!(!r.allowed); // " start " != "start"
    }

    #[test]
    fn gate_unknown_action_uppercase_toggle() {
        let sm = StateMachine::new();
        let r = can_accept_action(&sm, "Toggle", true, "api");
        assert!(!r.allowed); // case-sensitive
    }

    #[test]
    fn gate_unknown_action_uppercase_stop() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "Stop", true, "api");
        assert!(!r.allowed); // "Stop" != "stop"
    }

    #[test]
    fn gate_unknown_action_uppercase_cancel() {
        let sm = StateMachine::new();
        sm.transition(AppState::Recording, None);
        let r = can_accept_action(&sm, "Cancel", true, "api");
        assert!(!r.allowed);
    }
}
