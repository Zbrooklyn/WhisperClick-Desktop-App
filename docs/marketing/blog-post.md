# Dev.to / Hashnode Blog Post

## Title Options

1. **How I Built a Desktop Voice-to-Text App with Electron and a Python Sidecar**
2. **Replacing Typing with Talking: Building WhisperClick from pywebview to Electron**
3. **Electron + Python: Building a Desktop App Where Two Runtimes Talk Over stdin**

---

## Article

# How I Built a Desktop Voice-to-Text App with Electron and a Python Sidecar

You talk 3-4x faster than you type. I kept thinking about that number while writing emails, Slack messages, and code comments. All that typing was the bottleneck, not the thinking.

I wanted one hotkey I could press from anywhere on my desktop to start talking, and have the text appear at my cursor when I stopped. No switching windows. No copy-paste. No separate dictation app. Just talk and keep working.

That's what WhisperClick does. Here's how I built it.

## The Problem with Existing Tools

Windows has Win+H for voice typing, but it doesn't work in every app and you can't pick your transcription model. Dragon NaturallySpeaking costs $200+ and is Windows-only. Google's voice typing only works in the browser. Apple's dictation is decent but macOS-only and gives you no control over the model.

I wanted:
- A global hotkey that works in **any** app with a text cursor
- Auto-paste -- text lands where I was typing, no clipboard dance
- Choice of transcription backend (cloud or local)
- Cross-platform (Windows, macOS, Linux)
- Zero telemetry, zero data collection

## V1-V3: The pywebview Era

I started with pywebview -- a Python library that wraps your system's native WebView (WebView2 on Windows, WebKit on macOS). The idea was attractive: write the UI in HTML/CSS/JS, write the backend in Python, and communicate through a bridge.

It worked, and I shipped three versions this way. But I kept hitting walls:

- **Frameless window drag** required Win32 API hooks (`WM_NCHITTEST`, `WM_NCLBUTTONDOWN`) via ctypes. Getting drag, maximize, snap-to-edge, and double-click-to-maximize all working together was brutal.
- **Cross-platform distribution** was painful. PyInstaller bundles are enormous and platform-specific. Auto-updates required a custom solution.
- **WebView2 quirks.** Some CSS and JS features behaved differently than in Chromium. Edge cases everywhere.

The app worked well on Windows, but macOS and Linux support was a constant uphill battle.

## The Electron Decision

I resisted Electron for a long time (the usual reasons: memory, bundle size, "shipping a whole browser"). But when I honestly evaluated what I was spending my time on, most of it was fighting platform-level problems that Electron solves out of the box:

- Global hotkeys that actually work cross-platform
- System tray with native menus
- Auto-updates via electron-updater
- Code signing for macOS
- Frameless windows with native title bar overlays
- Proper multi-monitor support

The trade-off was worth it. I stopped fighting the platform and started building features.

## Architecture: Two Runtimes, One App

WhisperClick has an unusual architecture: Electron handles the UI, windows, and system integration, while a Python sidecar handles audio capture and transcription.

```
┌────────────────────────────────────┐
│         Electron (Node.js)         │
│                                    │
│  main.js ── IPC ── preload.js      │
│    │                    │          │
│    ├─ Window mgmt       ▼          │
│    ├─ Global hotkey    index.html   │
│    ├─ System tray      (Tailwind)  │
│    ├─ Auto-updates                 │
│    └─ Store (settings/history)     │
│         │                          │
│    stdin/stdout (JSON)             │
│         │                          │
│    ┌────▼────┐                     │
│    │ Python  │                     │
│    │ sidecar │                     │
│    │         │                     │
│    │ engine  │                     │
│    │  .py    │                     │
│    └─────────┘                     │
│    Audio capture, transcription,   │
│    model management                │
└────────────────────────────────────┘
```

### Why a Python Sidecar?

The transcription ecosystem is in Python. OpenAI's SDK, faster-whisper, sounddevice for audio capture -- all Python. I could have ported everything to Node.js, but:

1. The Python code already worked well from V3
2. faster-whisper doesn't have a Node equivalent
3. Audio capture in Node is a mess of native addons
4. Keeping Python meant I could iterate on the AI/audio side independently

The communication protocol is simple: JSON messages over stdin/stdout, one message per line.

```python
# Python sidecar reads commands from stdin
{"id": 1, "command": "configure", "settings": {"provider": "openai", ...}}
{"id": 2, "command": "start_rec"}
{"id": 3, "command": "stop_rec"}

# And writes responses/events to stdout
{"id": 1, "result": "ok"}
{"id": 2, "result": "ok"}
{"event": "transcription", "data": {"text": "Hello world", "duration": 2.3}}
```

The `Sidecar` class in Node wraps this in a clean API:

```javascript
class Sidecar extends EventEmitter {
  constructor(enginePath) {
    super();
    this.proc = null;
    this._pendingRequests = new Map();
    this._nextId = 1;
  }

  start() {
    // Spawn Python process with stdio pipes
    this.proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse JSON responses line by line
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => {
      const msg = JSON.parse(line);
      if (msg.event) {
        this.emit(msg.event, msg.data);  // Broadcast events
      } else if (msg.id) {
        this._pendingRequests.get(msg.id).resolve(msg);  // Resolve promises
      }
    });
  }

  async send(command, params = {}) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pendingRequests.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, command, ...params }) + '\n');
    });
  }
}
```

Request-response uses incrementing IDs (like JSON-RPC). Events (transcription results, download progress) are fire-and-forget messages without an ID. Clean separation.

### The Compatibility Shim

Here's the trick that saved me from rewriting the frontend: the V3 pywebview UI calls `window.pywebview.api.method()` for everything. Instead of changing those calls, I wrote a preload script that creates a fake `pywebview.api` object that routes to Electron IPC:

```javascript
// preload.js (simplified)
const api = {
  get_settings: () => ipcRenderer.invoke('get-settings'),
  save_settings: (patch) => {
    const translated = patchToElectron(patch);  // snake_case -> camelCase
    return ipcRenderer.invoke('save-settings', translated);
  },
  start_recording: () => ipcRenderer.invoke('start-recording'),
  stop_recording: () => ipcRenderer.invoke('stop-recording'),
  // ... 30+ methods
};

contextBridge.exposeInMainWorld('pywebview', { api });
```

The V3 frontend doesn't know it's running in Electron. It makes the same API calls it always did. The preload translates between V3's `snake_case` convention and Electron's `camelCase` store format. Zero V3 code changes required.

This meant I could migrate to Electron without touching the UI -- a huge win for stability and testing confidence.

### Resilience

The sidecar needs to be robust because it's managing audio hardware:

- **Auto-restart on crash:** If the Python process dies, it restarts up to 3 times with exponential backoff.
- **Processing timeout:** If a transcription takes more than 120 seconds, the frontend recovers gracefully.
- **Clean shutdown:** On app quit, the sidecar gets a shutdown signal and the process is killed if it doesn't exit within a timeout.
- **Crash-safe storage:** Settings and history use atomic writes (write to `.tmp`, rename to target) with `.bak` fallback.

## The Floating Pill

One design decision I'm happy with: the floating pill widget.

When you use voice-to-text, you need to know whether it's listening. But you don't want a big window blocking your screen. The pill is a tiny capsule (72x14 pixels when dormant) that sits at the edge of your screen. When you start recording, it expands to show live audio bars with cancel/stop buttons.

It's an always-on-top, frameless, transparent Electron window. Click it to toggle recording, right-click for a context menu, drag it anywhere on screen. When you're done, it shrinks back down.

## Testing

I was not going to ship a desktop app without thorough tests. The suite has 301 tests:

- **281 unit tests** covering IPC handlers, store operations, sidecar communication, preload translation, and window management
- **12 integration tests** for the full recording flow (start -> stop -> transcription -> history -> paste)
- **13 E2E tests** using a mock sidecar that simulates the Python engine

The mock setup was the hardest part. Electron's APIs don't exist outside Electron, so I wrote a comprehensive mock (`tests/mocks/electron.js`) that simulates `BrowserWindow`, `ipcMain`, `globalShortcut`, `clipboard`, `Notification`, `safeStorage`, and more. Tests run in pure Node.js with Jest -- no Electron runtime needed.

Coverage thresholds are enforced: 85% statements globally, 100% for the store and sidecar modules.

## Privacy

This was non-negotiable. WhisperClick has:

- Zero telemetry
- Zero analytics
- Zero background network calls
- No data collection of any kind

Audio goes to your chosen provider **only** when you press the hotkey. In local mode, audio never leaves your machine. API keys are encrypted at rest via Electron's safeStorage API (which uses your OS keychain). There's no "phone home" on startup, no usage tracking, nothing.

## What I'd Do Differently

**Start with Electron.** I spent months fighting pywebview's cross-platform gaps. If I'd started with Electron, I would have had macOS and Linux support much earlier.

**The sidecar pattern is underrated.** Electron + Python (or Rust, or Go) via stdin/stdout is a clean architecture for apps that need capabilities outside Node's ecosystem. I'd use it again.

**Single-file frontend has limits.** The main `index.html` is 4,350+ lines of inline JS. It works, but it's not where I'd start a new project. For WhisperClick, it was the right call because I was porting an existing UI, not writing one from scratch.

## Try It

WhisperClick is free and open source (CC BY-NC-SA 4.0).

- **Website:** https://whisperclick.com
- **Download:** https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest
- **Source:** https://github.com/Zbrooklyn/WhisperClick-Desktop-App
- **File an issue:** https://github.com/Zbrooklyn/WhisperClick-Desktop-App/issues

It runs on Windows (stable), macOS and Linux (early access). Setup takes about 60 seconds.

If you try it, I'd love to hear what you think. And if you're interested in the Electron + Python sidecar pattern, the source code is the best documentation -- `electron/sidecar.js` and `engine/engine.py` are where the two runtimes meet.

---

*Tags: #electron #python #whisper #openai #voice #accessibility #opensource #desktop*
