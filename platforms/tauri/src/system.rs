//! System integration — tray, hotkey, pill window, updater.
//!
//! These features require Tauri plugins and runtime testing.
//! This module provides the structure; implementation comes during M8 testing.

use tauri::AppHandle;

/// Initialize system tray with icon and context menu
/// Requires: tauri tray API (built-in since Tauri 2.0)
pub fn init_tray(_app: &AppHandle) -> Result<(), String> {
    // TODO: Create tray icon from ../../icons/icon.png
    // TODO: Build context menu (Start Recording, Settings, Show, Quit)
    // TODO: Handle tray click → toggle recording via canAcceptAction
    // TODO: Update tray icon based on state (dormant/recording/processing)
    println!("[system] Tray initialization stub — implement in M8");
    Ok(())
}

/// Register global hotkey (Ctrl+Alt+R default)
/// Requires: tauri-plugin-global-shortcut
pub fn register_hotkey(_app: &AppHandle, _accelerator: &str) -> Result<(), String> {
    // TODO: Register global shortcut via plugin
    // TODO: On trigger → canAcceptAction('toggle') → route to recording
    // TODO: Handle re-registration when user changes hotkey in settings
    println!("[system] Hotkey registration stub — implement in M8");
    Ok(())
}

/// Create the pill window (transparent, frameless, always-on-top)
/// Requires: Tauri multi-window support
pub fn create_pill_window(_app: &AppHandle) -> Result<(), String> {
    // TODO: Create WebviewWindow with:
    //   - url: ../../shared/pill/pill.html
    //   - transparent: true
    //   - decorations: false
    //   - always_on_top: true
    //   - skip_taskbar: true
    //   - width: 200, height: 80
    //   - position: bottom-center of primary display
    // TODO: Set click-through (platform-specific)
    // TODO: Load pill-bridge.js for Tauri invoke() mapping
    println!("[system] Pill window creation stub — implement in M8");
    Ok(())
}

/// Initialize auto-updater
/// Requires: tauri-plugin-updater
pub fn init_updater(_app: &AppHandle) -> Result<(), String> {
    // TODO: Configure updater to check GitHub releases
    // TODO: Handle stable/beta channel based on version string
    // TODO: Check for updates 10s after startup, then periodically
    println!("[system] Updater initialization stub — implement in M8");
    Ok(())
}

/// Simulate clipboard paste (Ctrl+V)
/// Requires: platform-specific key simulation
pub fn simulate_paste() -> Result<(), String> {
    // TODO: Windows: keybd_event for Ctrl+V
    // TODO: macOS: CGEventCreateKeyboardEvent for Cmd+V
    // TODO: Linux: xdotool or similar
    println!("[system] Paste simulation stub — implement in M8");
    Ok(())
}

/// Simulate Enter keypress
/// Requires: platform-specific key simulation
pub fn simulate_enter_key() -> Result<(), String> {
    // TODO: Windows: keybd_event for Enter
    // TODO: macOS: CGEventCreateKeyboardEvent for Return
    // TODO: Linux: xdotool
    println!("[system] Enter simulation stub — implement in M8");
    Ok(())
}
