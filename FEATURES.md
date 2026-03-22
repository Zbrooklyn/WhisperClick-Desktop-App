# Features — WhisperClick Electron

> Complete inventory of every user-facing feature and function.
> Last updated: 2026-03-18 (v2.1.1)

---

## 1. Recording

| Feature | Description |
|---------|-------------|
| Click-to-record | Click the recording surface to start/stop recording |
| Hotkey toggle | Global hotkey (default Ctrl+Alt+R) starts/stops recording from any app |
| Pill toggle | Click the floating pill widget to start/stop recording |
| Tray toggle | "Start Recording" in system tray context menu |
| Timer | MM:SS timer counts up during recording |
| Cancel (main) | Click during processing to cancel transcription |
| Cancel (pill) | Pill X button discards audio without transcribing |
| Processing timeout | 120s fallback timer recovers from stalled transcription |

### Recording States

| State | Visual | Icon |
|-------|--------|------|
| Idle | Gray mic icon, dimmed visualizer | Microphone |
| Recording | Pulsing "Listening..." text, active visualizer, accent color | Stop square |
| Processing | Pulsing "Processing" text, pulse background animation | Cancel X |
| Success | Brief green flash, auto-returns to idle | — |
| Error | Error toast, auto-returns to idle after 3s | — |

---

## 2. Audio Visualizer

### Styles (8)

| Style | Bar Width | Description |
|-------|-----------|-------------|
| Classic Bars | 6px | Full radius, 0.95 opacity |
| Spectrum Lines | 3px | Thin lines, tight spacing |
| Soft Pillars | 7px | Full radius, full opacity |
| Segmented Blocks | 8px | Square corners, 2px radius |
| Neon Pulse | 2px | Ultra-thin glowing lines |
| Prism Wave | 5px | Medium width, 3px radius |
| Peak Spikes | 10px | Wide bars, sharp 1px radius |
| Dot Matrix | 6px | 3x3px dot grid, glow effect |

### Motion Presets (3)

| Preset | Interval | Height Range |
|--------|----------|-------------|
| Subtle | 140ms | 4–18px |
| Balanced | 100ms | 6–26px |
| Energetic | 70ms | 8–34px |

### Density Levels (4)

| Level | Bar Count | Scale |
|-------|-----------|-------|
| Sparse | 14 | 1.0 |
| Balanced | 25 | 0.9 |
| Dense | 36 | 0.78 |
| Ultra | 48 | 0.66 |

---

## 3. Transcription

### Providers

| Provider | Models | Languages |
|----------|--------|-----------|
| OpenAI | gpt-4o-mini-transcribe, gpt-4o-transcribe, gpt-4o-transcribe-diarize, whisper-1 | 50+ |
| Gemini | 2.5 Flash, 2.5 Flash Lite, 2.5 Pro, 3 Flash Preview, 3 Pro Preview | 40+ |

### Local Models

| Feature | Description |
|---------|-------------|
| Model list | View available faster-whisper models |
| Download | Download models from Hugging Face |
| Delete | Remove downloaded models |
| Progress | Real-time download progress bar |
| Switch | Select active model for local transcription |

### Output Modes

| Mode | Description |
|------|-------------|
| Transcribe | Transcription only |
| Translate | Translation only |
| Both | Transcript + translation, shown as separate sections |

### Language Support

- **Source**: Auto-detect + 11 languages (English, Spanish, French, German, Italian, Portuguese, Japanese, Korean, Chinese, Hindi, Arabic)
- **Target**: Same 11 languages (no auto-detect)
- Full language lists vary by provider (50+ OpenAI, 40+ Gemini)

---

## 4. History

| Feature | Description |
|---------|-------------|
| List view | Scrollable list with time, duration, and text preview |
| Search | Real-time case-insensitive text filtering |
| Detail modal | Full-screen view with complete text, metadata |
| Editable title | Rename transcription entries in detail view |
| Copy | Copy text to clipboard (per-item or full text) |
| Delete | Remove individual entries with animation |
| Clear all | Confirmation modal, then wipe all history |
| Audio playback | Play/pause recorded audio, progress bar, seek |
| Export | Save transcription as .txt file via save dialog |
| Persistence | History survives app restarts (JSON file storage, crash-safe) |
| Size cap | History capped at 500 entries (oldest trimmed automatically) |
| Badge count | Header shows total entry count |

---

## 5. Settings

### Appearance

| Setting | Type | Options |
|---------|------|---------|
| Dark/Light theme | Toggle | Dark (default), Light |
| Visualizer style | Dropdown | 8 styles (see Visualizer section) |
| Visualizer motion | Dropdown | Subtle, Balanced, Energetic |
| Show pill widget | Toggle | On/Off |
| Pill monitor | Dropdown | Auto or specific display |

### Transcription

| Setting | Type | Options |
|---------|------|---------|
| Mode | Slider | Local / API |
| API provider | Dropdown | OpenAI, Gemini |
| OpenAI API key | Password input | With format verification |
| Gemini API key | Password input | With format verification |
| API model | Dropdown | Provider-specific model list |
| Base URL | Display | Locked/readonly per provider |
| Local model | Dropdown | Downloaded faster-whisper models |
| Microphone | Dropdown | System audio input devices |

### Output

| Setting | Type | Options |
|---------|------|---------|
| Output mode | Dropdown | Transcribe, Translate, Both |
| Source language | Dropdown | Auto + 11 languages |
| Target language | Dropdown | 11 languages (visible when translating) |
| Auto-paste | Toggle | Paste transcription to focused app |
| Runtime | Dropdown | After stop (live streaming planned) |

### System

| Setting | Type | Options |
|---------|------|---------|
| Global hotkey | Capture button | Press keys to record new hotkey |
| Hotkey (manual) | Text input | Type key combo directly |
| Sound effects | Toggle | Play sounds on events |
| Start with Windows | Toggle | Launch on login |
| Always on top | Toggle | Window stays above others |

### Settings Behavior

- Partial saves merge with existing (no data loss)
- Settings pushed to Python sidecar on change
- Theme change updates native title bar overlay colors
- Settings persist across app restarts (crash-safe atomic writes)
- API keys encrypted at rest via Electron `safeStorage` (auto-migrates plaintext)

---

## 6. Global Hotkey

| Feature | Description |
|---------|-------------|
| Default | Ctrl + Alt + R |
| Capture mode | Click "Record" button, press desired key combo |
| Manual entry | Click hotkey display to type combo directly |
| Validation | Requires modifier key (Ctrl/Alt/Shift/Win) or F-key |
| Conflict detection | Blocked (red), Risky (amber), Safe (green) |
| Hotkey guide | Modal explaining conflicts, suggesting safe combos |
| Format normalization | "Ctrl + Alt + R" auto-normalized to "Ctrl+Alt+R" |
| Scope | System-wide — works when app is minimized/hidden |

### Blocked Hotkeys (examples)

Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+Z, Ctrl+W, Ctrl+T, Ctrl+N, Alt+F4, F1–F6, F11

### Suggested Safe Combos

Ctrl+Alt+R, Ctrl+Alt+W, Ctrl+Alt+S, F9, F10, Shift+F9, Ctrl+F10

---

## 7. Pill Widget

| Feature | Description |
|---------|-------------|
| Dormant | 72x14 dark capsule with 14 mini voice bars |
| Recording | Expands to 200x40 with cancel, bars, stop buttons |
| Processing | Pulsing bars animation |
| Success | Green border flash, auto-returns to dormant |
| Error | Red border flash, auto-returns to dormant |
| Click | Toggle recording (short click) |
| Cancel button | X button discards audio (sends cancel, not stop) |
| Tooltip | Hover shows hotkey hint above capsule (visible within window) |
| Drag | Move pill anywhere on screen (long press + drag) |
| Right-click menu | Native OS context menu: Start/Stop Recording, Show WhisperClick, Settings, Hide Pill |
| Monitor selection | Move pill to any connected display |
| State sync | Always matches main window and tray state |
| Toggle | Show/hide from settings or tray menu |

---

## 8. Window Management

| Feature | Description |
|---------|-------------|
| Title bar drag | CSS-based drag via `-webkit-app-region: drag` |
| Minimize | Native Windows minimize button |
| Maximize/restore | Native Windows maximize button, double-click title bar |
| Close | Close button (hides to tray or quits based on setting) |
| Snap layouts | Hover maximize button for Windows 11 split options |
| Snap to edges | Drag to screen edge for half-screen snap |
| Theme-matched controls | Native title bar overlay matches dark/light theme |

---

## 9. System Tray

| Feature | Description |
|---------|-------------|
| Icon | Colored circle (blue=dev, terracotta=production) |
| Icon states | Terracotta (dormant), red (recording), green (success) |
| Click | Show/focus main window |
| Show WhisperClick | Open and focus main window |
| Start Recording | Toggle recording (routes through frontend) |
| Settings | Open main window with settings drawer |
| Quit | Fully exit app (closes all windows, kills sidecar) |

---

## 10. Onboarding

### Step 1: Local Capture

- Checks if local model is available
- Progress bar shows model readiness
- "Continue with Local Capture" or "Use API Key" options

### Step 2: Connect API

- Provider dropdown (OpenAI/Gemini)
- API key input with verification
- Links to get API keys from providers
- Validates and persists key, switches to API mode

---

## 11. App Lifecycle

| Feature | Description |
|---------|-------------|
| Single instance | Second launch focuses existing window |
| Close to tray | Configurable: close hides to tray or fully quits |
| Auto-start | Optional launch on Windows login |
| Always on top | Optional window stays above all others |
| Sidecar management | Python engine auto-starts, auto-restarts on crash (max 3, backoff) |
| Crash-safe storage | Atomic writes with `.tmp`/`.bak` fallback for settings and history |

---

## 12. Clipboard & Auto-Paste

| Feature | Description |
|---------|-------------|
| Copy to clipboard | Any transcription can be copied with one click |
| Auto-paste | After transcription, text is pasted to the previously focused app |
| Paste simulation | Uses PowerShell SendKeys to simulate Ctrl+V |
| Paste delay | 150ms delay to ensure target app has focus |

---

## 13. Auto-Enter Mode

After transcription completes and text is pasted, WhisperClick can optionally press Enter:

| Mode | Behavior |
|------|----------|
| Off (default) | Nothing — user presses Enter themselves |
| Button | Record button transforms to red Enter (↵) icon. Click to send. Auto-dismisses after 2–5s based on recording length |
| Auto | Enter fires automatically after smart delay (300ms + 5ms per character, max 3s) |

**Pill widget integration:**
- Auto mode: stop button shows ↵ icon during recording
- Button mode: pill shows enter-ready state after transcription (red border, ↵ + "Send" label)

**Implementation:**
- Setting: `auto_enter_mode` / `autoEnterMode` (values: `off`, `button`, `auto`)
- Sidecar command: `press_enter` — simulates Enter keypress via `keybd_event`
- IPC: `simulate-enter` (main process), `show-enter-button` (to pill renderer)
- Smart delay: `Math.min(300 + (text.length * 5), 3000)` ms

---

## 14. API Methods (Preload Bridge)

The frontend communicates via `window.pywebview.api` — a compatibility shim that routes to Electron IPC.

| Method | Purpose |
|--------|---------|
| `get_settings()` | Load all settings |
| `save_settings(patch)` | Merge-save settings |
| `start_recording()` | Begin recording via sidecar |
| `stop_recording()` | Stop and wait for transcription |
| `cancel_processing()` | Cancel in-flight transcription |
| `get_recording_state()` | Poll current state |
| `get_models()` | List available local models |
| `set_model(name)` | Select active local model |
| `download_model(name)` | Download model from Hugging Face |
| `delete_model(name)` | Remove downloaded model |
| `get_download_progress()` | Poll model download progress |
| `get_microphones()` | List audio input devices |
| `set_microphone(id)` | Select active microphone |
| `get_api_keys()` | Retrieve stored API keys |
| `set_api_key(provider, key)` | Store API key |
| `verify_api_key(provider, key)` | Format-validate API key |
| `get_history()` | Load all history entries |
| `delete_history(id)` | Remove one history entry |
| `clear_history()` | Remove all history entries |
| `copy_to_clipboard(text)` | Write text to clipboard |
| `paste_last_transcript()` | Paste most recent transcription |
| `minimize()` | Minimize main window |
| `close()` | Close/hide main window |
| `toggle_maximize()` | Maximize or restore window |
| `is_maximized()` | Check window maximized state |
| `drag_start()` | No-op (CSS handles drag) |
| `nc_resize_start()` | No-op (Electron handles resize) |
| `get_version()` | App version and dev flag |
| `get_monitors()` | List connected displays |
| `set_pill_display(idx)` | Move pill to specific display |
| `toggle_pill()` | Show/hide pill widget |
| `get_audio(id)` | Load audio as base64 for playback |
| `export_transcription(text, fmt)` | Save transcription to file |
