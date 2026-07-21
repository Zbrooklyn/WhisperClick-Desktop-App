# WhisperClick Electron — External Integrations

## AI / Speech-to-Text APIs

### OpenAI Whisper API

**Status:** Primary cloud provider
**Configuration:** `electron/store.js` line 34, `preload.js` line 24
**Settings Keys:**
- `provider: 'openai'` (provider selection)
- `apiModel: 'whisper-1'` (API model)
- `openaiApiKey: ''` (encrypted via `safeStorage`)
- `customBaseUrl: ''` (optional custom API endpoint)

**Integration Points:**
- Python sidecar (`engine/engine.py`) sends recording audio to OpenAI Whisper API
- Main process stores/encrypts API key in `settings.json`
- Preload shim translates `api_provider` (V3) → `provider` (Electron store)
- IPC handler: `save-settings` (line ~450 in `electron/main.js`)

**Auth:** Bearer token in Authorization header (stored in encrypted settings)

---

### Google Gemini API

**Status:** Secondary cloud provider (supported but less common)
**Configuration:** `electron/store.js` line 35, `preload.js` line 33
**Settings Keys:**
- `provider: 'google'` (provider selection)
- `apiModel: 'custom'` (user-configurable)
- `geminiApiKey: ''` (encrypted via `safeStorage`)
- `customBaseUrl: ''` (optional custom API endpoint)

**Integration Points:**
- Python sidecar sends transcription requests to Google Gemini API
- Main process stores/encrypts API key in `settings.json`
- IPC handler: `save-settings`

**Auth:** API key in request (stored in encrypted settings)

---

### Local Whisper Models (faster-whisper)

**Status:** Offline mode (no external API required)
**Python Package:** `faster-whisper` (from `engine/requirements.txt`)
**Settings Keys:**
- `mode: 'local'` (mode selection)
- `localModel: 'base'` (model size: tiny, base, small, medium, large)
- `sourceLanguage: 'auto'` (language auto-detection)
- `targetLanguage: 'en'` (translation target)

**Integration Points:**
- Python sidecar downloads models from HuggingFace Hub on first use
- IPC handler: `download-model` (line ~470 in `electron/main.js`)
- Sidecar supports long-running operations (600s timeout for model download)

**Dependencies:**
- `onnxruntime` (ML inference engine)
- `huggingface_hub` (model repository client)

---

## Audio System Integration

### Audio Device Recording (sounddevice + soundfile)

**Python Packages:** `sounddevice`, `soundfile` (from `engine/requirements.txt`)
**Recording Flow:**
1. V3 frontend calls `start_recording()` → preload → IPC `start-recording`
2. Main process sends `start_rec` command to Python sidecar (with API config)
3. Sidecar uses `sounddevice` to enumerate & capture from default device
4. Audio frames buffered in-memory, processed, saved as WAV or streamed to API
5. Sidecar emits `transcription` event on completion
6. Main process waits for event (120s timeout), then resolves IPC handler

**Settings Keys:**
- `soundEnabled: true` (disable to skip pre-recording beep)

**Integration Points:**
- `electron/main.js` line ~550: `ipcMain.handle('start-recording', ...)`
- `electron/sidecar.js` line ~88: `send('start_rec', {...})`
- Python sidecar stdin/stdout JSON protocol

---

## System Integration

### Global Hotkey (electron.globalShortcut)

**Default Hotkey:** `Ctrl+Alt+R` (configurable)
**Settings Key:** `hotkey: 'Ctrl+Alt+R'` (stored in `electron/store.js` line 13)
**Binding Location:** `electron/main.js` line ~700

**Flow:**
1. Main process registers global hotkey via `globalShortcut.register(hotkey, callback)`
2. On hotkey press → `mainWindow.executeJavaScript('triggerTrustedHotkeyToggle()')`
3. V3 frontend handles validation (API key check, recording state)
4. Calls `start_recording()` or `stop_recording()`

**Integration Points:**
- `electron/main.js` lines 700–730: hotkey registration & unregistration
- Settings save triggers hotkey re-registration (`electron/main.js` line ~450)
- Hotkey survives window minimize/hidden state

---

### Clipboard / Auto-Paste Integration

**Status:** Clipboard write after transcription
**Electron API:** `electron.clipboard.writeText()`
**Settings Key:** `autoPaste: true` (default behavior)

**Flow:**
1. Sidecar emits `transcription` event with transcript text
2. Main process handler (`electron/main.js` line ~950) checks `autoPaste` setting
3. If enabled: `clipboard.writeText(transcript)`
4. Renderer polls `get-clipboard-changed` IPC to detect clipboard changes

**Integration Points:**
- `electron/main.js` line ~950: `'stop-recording'` handler
- V3 frontend (`src/frontend/index.html`): polling loop for clipboard state

---

### System Tray Integration

**Electron API:** `electron.Menu.buildFromTemplate()`, `electron.Tray`
**Tray Icon Location:** `icons/icon.ico` (Windows)
**Code Location:** `electron/tray.js` (250+ lines)

**Features:**
1. Right-click context menu (Show, Settings, Quit)
2. Left-click behavior (configurable via `trayClickAction`)
3. Tooltip display (shows current status + hotkey)
4. Balloon notifications (update ready, errors)
5. Icon flashing/highlighting on error

**Settings Keys:**
- `trayClickAction: 'show'` (left-click behavior)
- `closeBehavior: 'tray'` (close → minimize to tray)

**Integration Points:**
- `electron/main.js` line ~50: `createTray()`
- `electron/main.js` line ~80: `mainWindow.on('close', ...)`
- `electron/updater.js` line ~95: `showTrayBalloon('Update Ready')`
- `electron/tray.js` line ~1: menu building + state updates

---

## Auto-Updater Integration (electron-updater)

**Module:** `electron-updater` (v6.6.2, from `package.json` line 100)
**GitHub Release Provider:** Configured in `package.json` lines 93–96
**Code Location:** `electron/updater.js` (200+ lines)

**Features:**
1. Checks GitHub releases for new versions (stable + beta channels)
2. Downloads updates automatically (if `autoDownloadUpdates: true`)
3. Installs on app quit
4. IPC messaging to renderer for UI updates

**Release Channels:**
- **Stable:** Latest release tag (non-pre-release)
- **Beta:** Pre-release tags (version contains "beta")
- Selection: stored in `settings.updateChannel` (default determined by app version)

**GitHub Configuration:**
```json
"publish": {
  "provider": "github",
  "owner": "Zbrooklyn",
  "repo": "WhisperClick-Desktop-App"
}
```

**Flow:**
1. App startup → `initUpdater()` registers event handlers
2. Background check: `checkUpdateMarker()` → `autoUpdater.checkForUpdates()`
3. Available update → emit `update-available` → send IPC `update-status`
4. Renderer shows notification (if `autoDownloadUpdates: true`)
5. User clicks "Install" → `autoUpdater.quitAndInstall()`

**Settings Keys:**
- `autoDownloadUpdates: false` (auto-download enabled)
- `updateChannel: 'beta'` (stable | beta)

**IPC Channels:**
- **Main → Renderer:** `update-status` (checking, available, downloading, ready, up-to-date)
- **Renderer → Main:** `download-update`, `install-update`, `check-for-update`

**Integration Points:**
- `electron/updater.js` line ~50: event handlers (checking, available, download-progress, ready)
- `electron/main.js` line ~30: `initUpdater(mainWindow, store, sidecar)`
- `electron/main.js` line ~150: IPC handlers for update control

---

## Data Storage & Encryption

### Electron safeStorage (OS Credential Store)

**Status:** Encrypts API keys at rest
**Usage:** `safeStorage.encryptString()` / `safeStorage.decryptString()`
**Code Location:** `electron/store.js` lines 81–99

**Encrypted Fields:**
- `openaiApiKey`
- `geminiApiKey`

**Storage Format:** `enc:BASE64_ENCODED_ENCRYPTED_DATA`

**Flow:**
1. User enters API key in settings
2. IPC `save-settings` → `store.saveSettings()`
3. Store checks `safeStorage.isEncryptionAvailable()`
4. If available: encrypt key as `enc:...`, write to `settings.json`
5. On read: detect `enc:` prefix, decrypt via `safeStorage.decryptString()`
6. Legacy plaintext keys auto-upgrade to encrypted on next save

**Fallback:** Plaintext storage if OS credential store unavailable (rare)

**Integration Points:**
- `electron/store.js` lines 81–99: encryption/decryption logic
- `electron/store.js` lines 110–140: settings merge & save

---

### File-Based Settings & History

**Files:**
- `%APPDATA%\Electron\whisperclick\settings.json` (production)
- `%APPDATA%\Electron\whisperclick\history.json` (transcription history)

**Code Location:** `electron/store.js` (250+ lines)

**Atomic Write Strategy:**
1. Write to `.tmp` file
2. Copy existing file to `.bak` (crash recovery)
3. Rename `.tmp` → original (atomic on NTFS)
4. If crash occurs: next startup reads `.bak` file

**Crash Recovery:**
- Corrupt `settings.json` → fall back to `settings.json.bak` → restore good copy
- Never loses settings even on SIGKILL during write

**Integration Points:**
- `electron/store.js` line ~60: `_atomicWrite()`
- `electron/store.js` line ~70: `_safeReadJSON()` (with fallback)

---

## Sidecar Communication Protocol

**Transport:** stdin/stdout (parent process pipes)
**Format:** JSON, one message per line
**Code Location:** `electron/sidecar.js` (150+ lines)

**Message Format (Request):**
```json
{"id": 1, "command": "start_rec", "api_provider": "openai", "api_key": "sk-...", ...}
```

**Message Format (Response):**
```json
{"id": 1, "result": "ok"}
```

**Message Format (Event):**
```json
{"event": "transcription", "data": {"text": "Hello world", ...}}
```

**Timeout Handling:**
- Standard commands: 60 seconds
- Long-running commands (`download_model`): 600 seconds (10 minutes)

**Integration Points:**
- `electron/sidecar.js` line ~88: `async send(command, payload)`
- `electron/main.js` line ~550: `sidecar.send('start_rec', {...})`
- `electron/main.js` line ~950: `sidecar.on('transcription', ...)`

---

## State Machine Integration

**Location:** `electron/state-machine.js` (100+ lines)
**States:** `dormant` (idle), `recording` (active), `processing` (transcribing)

**Flow:**
1. `start-recording` IPC → state machine transition `dormant → recording`
2. Sidecar processes audio
3. Sidecar emits `transcription` event → state machine transition `recording → dormant`
4. Frontend polls `get-state` IPC to display current state

**Integration Points:**
- `electron/main.js` line ~30: `new StateMachine('dormant', ...)`
- `electron/main.js` line ~550: `sm.transition('recording', 'start-recording')`
- IPC handler `get-state` (line ~300)

---

## Environment Detection

**Detection Variables:** `isDev`, `isBeta`, `isPackaged`
**Code Location:** `electron/main.js` lines 34–39

**Logic:**
- `isDev = !app.isPackaged` (true during development, false in dist)
- `isBeta = app.getVersion().includes('beta')` (checks version string)
- Determines config directory (`whisperclick-dev` vs `whisperclick-beta` vs `whisperclick`)

**Usage:**
- Config paths: `electron/store.js` line ~41
- Auto-updater channel: `electron/updater.js` line ~44
- Sidecar paths: `electron/sidecar.js` line ~35
