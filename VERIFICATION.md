# Verification Checklist — WhisperClick (Electron + Tauri)

> Last updated: 2026-04-11. Items below are written for the Electron platform
> (shipping). Tauri verification items live in `platforms/tauri/` and are tracked
> separately — Tauri is alpha and not yet shipped to users.

## How to Use

Test each item. Mark `[x]` when passing, `[!]` if broken (add notes).
Items marked `(sidecar)` require the Python engine running.

---

## 1. App Lifecycle

- [x] App launches without console errors
- [ ] Single instance lock works (second launch focuses first window)
- [ ] Tray icon appears (blue in dev, terracotta in production)
- [ ] Close-to-tray works (close button hides window, tray remains)
- [ ] Quit from tray fully exits (no orphan processes)
- [ ] App remembers window position on relaunch

## 2. Window Management

- [ ] **Drag**: Click and drag title bar moves window
- [ ] **Double-click title bar**: Toggles maximize/restore
- [ ] **Native controls**: Min/max/close buttons visible in top-right
- [ ] **Snap layouts**: Hover maximize button shows Windows 11 split options
- [ ] **Snap to edges**: Drag to screen edge snaps half-screen
- [ ] **Snap to top**: Drag to top edge maximizes
- [ ] **Minimize**: Native minimize button works
- [ ] **Restore**: Click taskbar icon restores minimized window
- [ ] **Settings gear**: Not overlapped by native controls
- [ ] **Theme match**: Native controls background matches app theme (dark/light)

## 3. Pill Widget

- [ ] **Position**: Centered horizontally at bottom of screen
- [ ] **Visible**: Shows on launch (if `showPill` setting is true)
- [ ] **Dormant appearance**: 72x14 dark capsule with 14 mini-bars
- [ ] **Click dormant**: Starts recording (main window reflects it too)
- [ ] **Recording appearance**: Expands to 200x40 with cancel/bars/stop
- [ ] **Click stop**: Stops recording → processing state
- [ ] **Click cancel (recording)**: Discards audio (NOT transcribe), returns to dormant
- [ ] **Click cancel (processing)**: Discards, returns to dormant (no transcription produced)
- [ ] **State sync**: Pill and main window always show same state
- [ ] **Drag**: Click and drag pill moves it
- [ ] **Drag vs click**: Short click = toggle, drag = move (no false triggers)
- [ ] **Tooltip**: Hover dormant capsule → tooltip appears above with hotkey text
- [ ] **Right-click menu**: Native OS context menu appears (not HTML)
- [ ] **Menu → Start/Stop Recording**: Dynamic label, toggles recording
- [ ] **Menu → Start Recording disabled during processing**: Item greyed out
- [ ] **Menu → Show WhisperClick**: Main window shows and focuses
- [ ] **Menu → Settings**: Main window opens settings drawer
- [ ] **Menu → Hide Pill**: Pill disappears, setting persists
- [ ] **Re-show pill**: Toggle in settings re-shows pill
- [ ] (sidecar) **Voice bars animate**: Bars respond to audio level during recording
- [ ] (sidecar) **Processing pulsing**: Bars pulse during transcription
- [ ] (sidecar) **Success flash**: Green border flash, auto-return to dormant
- [ ] (sidecar) **Error flash**: Red border flash, auto-return to dormant

## 4. Recording Flow (requires sidecar)

- [ ] (sidecar) Click record surface → starts recording
- [ ] (sidecar) Visualizer bars animate during recording
- [ ] (sidecar) Timer counts up during recording
- [ ] (sidecar) Click stop → processing state shown
- [ ] (sidecar) Transcription completes → idle state, history updated
- [ ] (sidecar) Cancel during processing → returns to idle
- [ ] (sidecar) Auto-paste works (text pasted to focused app)
- [ ] (sidecar) Error during transcription → error toast shown

## 5. Global Hotkey

- [ ] Default hotkey (Ctrl+Alt+R) starts recording
- [ ] Hotkey during recording stops it
- [ ] Hotkey during processing cancels it
- [ ] Hotkey works when main window is hidden/minimized
- [ ] Hotkey triggers both main window AND pill state change
- [ ] Custom hotkey: change in settings, new key works
- [ ] Old hotkey unregistered after change
- [ ] Hotkey format normalized ("Ctrl + Alt + R" → "Ctrl+Alt+R")

## 6. Settings Drawer

- [ ] Settings gear opens drawer
- [ ] Drawer slides in from right
- [ ] Close (X) closes drawer
- [ ] **Field name translation**: Settings load correctly (snake_case ↔ camelCase)

### 6a. Individual Settings

- [ ] **Theme toggle**: Switches dark/light, native controls update color
- [ ] **Global Hotkey**: Shows current hotkey, "Record" button captures new key
- [ ] **Auto-Paste toggle**: Persists on/off
- [ ] **Start with Windows toggle**: Sets login item
- [ ] **Always on Top toggle**: Window stays on top when enabled
- [ ] **Sound toggle**: Persists
- [ ] **Close behavior**: Tray vs quit options work
- [ ] **Show Pill Widget toggle**: Shows/hides pill
- [ ] **Pill monitor select**: Moves pill to selected display
- [ ] **Mode switch** (Local/API): Persists, sidecar reconfigured
- [ ] **Model select**: Dropdown works, persists
- [ ] **Language select**: Dropdown works, persists
- [ ] **Provider tabs** (OpenAI/Gemini): Switch between providers
- [ ] **API key input**: Saves key, masked display
- [ ] **API key verify**: Format validation works
- [ ] **Visualizer style**: Changes bar style
- [ ] **Visualizer motion**: Changes animation speed
- [ ] **Output mode** (transcribe/translate/both): Persists

### 6b. Settings Persistence

- [ ] Change a setting → close app → relaunch → setting retained
- [ ] Partial save (one field) doesn't wipe other fields
- [ ] Settings pushed to sidecar on change (mode, model, language, keys)

## 7. History

- [ ] (sidecar) Transcription adds entry to history list
- [ ] History items show time, duration, preview text
- [ ] Click item → detail modal opens
- [ ] Copy button copies text to clipboard
- [ ] Delete button removes item (with animation)
- [ ] Clear All → confirmation modal → clears history
- [ ] History persists across app restarts
- [ ] (sidecar) Audio playback button works (if audio stored)
- [ ] Export as TXT → save dialog → file created

## 8. Tray Menu

- [ ] **Show WhisperClick**: Opens/focuses main window
- [ ] **Start Recording**: Toggles recording (routes through frontend)
- [ ] **Settings**: Opens main window + settings drawer
- [ ] **Quit**: Fully exits app

## 9. Preload API Coverage

Every method in `window.pywebview.api` must resolve without throwing:

| Method | IPC Handler | Test |
|--------|------------|------|
| `get_settings()` | `get-settings` | [ ] Returns object with settings |
| `save_settings(patch)` | `save-settings` | [ ] Merges patch, doesn't wipe |
| `start_recording()` | `start-recording` | [ ] Returns `{success}` |
| `stop_recording()` | `stop-recording` | [ ] Blocks until result |
| `cancel_processing()` | `cancel-processing` | [ ] Returns `{success}` |
| `get_recording_state()` | `get-state` | [ ] Returns `{is_recording}` |
| `get_models()` | `list-models` | [ ] Returns array |
| `set_model(name)` | `save-settings` | [ ] Saves localModel |
| `download_model(name)` | `download-model` | [ ] Starts download |
| `delete_model(name)` | `delete-model` | [ ] Removes model |
| `get_download_progress()` | (cached) | [ ] Returns progress obj |
| `get_microphones()` | `list-mics` | [ ] Returns array |
| `set_microphone(id)` | `set-mic` | [ ] Selects mic |
| `get_api_keys()` | `get-settings` | [ ] Returns `{openai, gemini}` |
| `set_api_key(p, k)` | `save-settings` | [ ] Saves correct field |
| `verify_api_key(p, k)` | `verify-api-key` | [ ] Returns `{valid}` |
| `get_history()` | `get-history` | [ ] Returns array |
| `delete_history(id)` | `delete-history` | [ ] Removes entry |
| `clear_history()` | `clear-history` | [ ] Empties history |
| `copy_to_clipboard(t)` | `copy-to-clipboard` | [ ] Text in clipboard |
| `paste_last_transcript()` | `paste-last-transcript` | [ ] Pastes text |
| `minimize()` | `window-minimize` | [ ] Window minimizes |
| `close()` | `window-close` | [ ] Window closes/hides |
| `toggle_maximize()` | `window-maximize` | [ ] Toggles max/restore |
| `is_maximized()` | `window-is-maximized` | [ ] Returns boolean |
| `drag_start()` | (no-op) | [ ] No error |
| `nc_resize_start()` | (no-op) | [ ] No error |
| `get_version()` | `get-app-info` | [ ] Returns `{version, dev}` |
| `get_monitors()` | `get-displays` | [ ] Returns `[{index, label}]` |
| `set_pill_display(i)` | `move-pill-to-display` | [ ] Moves pill |
| `toggle_pill()` | `toggle-pill` | [ ] Shows/hides pill |
| `get_audio(id)` | `get-audio` | [ ] Returns base64 or error |
| `export_transcription(t,f)` | `export-transcription` | [ ] Save dialog works |

## 10. State Synchronization Matrix

All state sources must keep all consumers in sync:

| Action Source | Main Window | Pill | Tray Icon |
|--------------|-------------|------|-----------|
| Click main record button | [ ] Updates | [ ] Updates | [ ] Updates |
| Click pill | [ ] Updates | [ ] Updates | [ ] Updates |
| Press hotkey | [ ] Updates | [ ] Updates | [ ] Updates |
| Tray "Start Recording" | [ ] Updates | [ ] Updates | [ ] Updates |
| Sidecar transcription done | [ ] Updates | [ ] Updates | [ ] Updates |
| Sidecar error | [ ] Updates | [ ] Updates | [ ] Updates |

## 11. Store Hardening

- [ ] **API key encryption**: Save an API key → check `settings.json` → key shows `enc:BASE64...` not plaintext
- [ ] **Plaintext migration**: Start with plaintext key in `settings.json` → app loads → save any setting → key now encrypted
- [ ] **Corrupt settings recovery**: Corrupt `settings.json` → app loads from `.bak` or uses defaults
- [ ] **Corrupt history recovery**: Corrupt `history.json` → app loads from `.bak` or returns empty array
- [ ] **Atomic write artifacts**: After save, `.tmp` file should NOT exist (renamed), `.bak` should exist
- [ ] **History cap**: Add 500+ entries → only 500 retained (oldest trimmed)

## 12. Sidecar Auto-Restart

- [ ] **Crash recovery**: Kill `python.exe` manually → sidecar restarts within 1-3s
- [ ] **Backoff**: Kill again → restart takes 2s, then 3s on next kill
- [ ] **Max restarts**: Kill 4 times → "giving up" in console, no more restarts
- [ ] **Reset on success**: After successful restart, counter resets (can recover from future crashes)
- [ ] **Clean quit**: Quit via tray → no restart attempt (isQuitting flag)
- [ ] **Clean quit via window-all-closed**: Close all windows → no restart attempt

## Quick Smoke Test (5 minutes)

Run these in order to catch the most common issues:

1. Launch app — window and pill both appear
2. Drag main window by title bar
3. Hover maximize button — snap layout appears
4. Open settings — drawer slides in
5. Toggle theme — colors change, native controls match
6. Close settings
7. Click pill — both pill and main window show recording state
8. Click pill stop — both return to idle
9. Press Ctrl+Alt+R — both show recording
10. Right-click tray → Settings — drawer opens
11. Right-click tray → Quit — app fully exits, no orphan processes

---

### Auto-Enter Mode

- [ ] Settings: Auto-Enter dropdown appears in Quick Settings with Off/Button/Auto options
- [ ] Settings: Changing Auto-Enter mode persists across app restart
- [ ] Off mode: No enter behavior after transcription (default)
- [ ] Button mode: Record button transforms to red Enter (↵) after successful transcription
- [ ] Button mode: Clicking Enter button simulates Enter keypress and returns to idle
- [ ] Button mode: Enter button auto-dismisses after 2–5 seconds
- [ ] Auto mode: Enter fires automatically after transcription with smart delay
- [ ] Auto mode: Pill stop button shows ↵ icon instead of square during recording
- [ ] Pill (Button mode): Shows enter-ready state after transcription (red border, ↵ + Send)
- [ ] Pill (Button mode): Clicking pill in enter-ready state fires Enter
- [ ] Pill (Auto mode): Dormant state not overridden by enter-ready
- [ ] Back-to-back recording: Can start new recording immediately after transcription completes
- [ ] No "Already recording" error when starting recording after recent transcription
