# WhisperClick — Web (phone-accessible)

A fully functional browser build of WhisperClick that reuses the real Python
transcription engine (`shared/engine/engine.py`). Record from any device's
microphone (including a phone over Tailscale HTTPS), transcribe with **Local**
(faster-whisper) or **Cloud** (OpenAI / Gemini API) — switchable at runtime —
and keep a searchable history. No Electron required.

## How it works

```
Browser (mic)  --audio blob-->  server.js  --wav (ffmpeg)-->  engine.py transcribe_file
                                                                   |
Browser (UI)   <--transcript / history--  (transcription event) <-+
```

- **`server.js`** — Node HTTP server. Serves the real `shared/frontend/index.html`
  with `web-shim.js` injected, spawns `engine.py` over its JSON stdin/stdout
  protocol, and exposes a small REST API (`/api/transcribe`, `/api/history`,
  `/api/settings`, `/api/models`, `/api/verify-key`, …). Converts browser audio
  (webm/opus, mp4, ogg) to 16 kHz mono WAV with ffmpeg before handing it to the
  engine — the same `transcribe_file` path Electron uses, so Local and Cloud
  modes and all engine features apply.
- **`web-shim.js`** — Browser bridge. Defines `window.pywebview.api` (the exact
  surface the frontend calls via `callNativeApi`), captures mic audio with
  `getUserMedia`/`MediaRecorder`, and routes transcription to the server. The
  frontend runs unmodified.

## Run

```bash
node platforms/web/server.js          # listens 0.0.0.0:8791
# WC_PORT=9000 node platforms/web/server.js   # custom port
```

- Desktop: <http://localhost:8791/>
- Phone (HTTPS, required for mic on mobile): via `tailscale serve`, e.g.
  `https://talkos.tail9f5d16.ts.net:8799/` → proxies to `127.0.0.1:8791`.

Mobile browsers only grant microphone access on a **secure context**, so phones
must use the HTTPS Tailscale URL, not the raw `http://<ip>:8791`.

## Requirements

- The engine venv at `shared/engine/.venv` (faster-whisper + API deps).
- `ffmpeg` on PATH, or set `WC_FFMPEG=/path/to/ffmpeg`.
- At least one local model downloaded (Settings → Models) for Local mode, or an
  API key for Cloud mode.
