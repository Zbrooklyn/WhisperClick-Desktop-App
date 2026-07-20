# Reddit Posts

> General notes: Reddit dislikes overt self-promotion. Each post is written to provide value first, mention the tool naturally, and follow typical subreddit conventions. Always check each subreddit's rules before posting -- some require flair, some have self-promotion days, some require a certain account age.

---

## r/productivity

**Title:** I replaced typing with talking and it saved me ~1 hour a day

**Body:**

I realized I was spending a huge chunk of my day typing things I could just say. Emails, Slack messages, meeting notes, journal entries. I talk 3-4x faster than I type, but there was no good way to capture that on desktop without switching apps or dealing with clunky workflows.

So I built a tool called WhisperClick. It runs in your system tray and you press a hotkey from any app -- email, text editor, terminal, whatever. Talk naturally, press the hotkey again, and the text appears at your cursor. No window switching, no copy-paste.

A few things that made a real difference in my workflow:

- **Auto-paste at cursor.** This is the key thing. It doesn't put text in a separate window. It pastes right where I was typing. Sounds minor, but it eliminates the friction that made me not bother with dictation before.
- **Global hotkey from anywhere.** I use it in VS Code, Gmail, Notion, Slack, even the terminal. Same hotkey everywhere.
- **History with search.** Every transcription is saved with the original audio. I use this as a voice journal -- just talk my thoughts throughout the day and search them later.

It uses OpenAI or Gemini for transcription (costs under $1/month typically), or you can run it fully offline with local Whisper models.

Free and open source: https://github.com/Zbrooklyn/WhisperClick-Desktop-App

Curious if anyone else has built voice-to-text into their daily workflow. What worked for you?

---

## r/software

**Title:** WhisperClick -- open source voice-to-text that works in any app (Windows/macOS/Linux)

**Body:**

I've been building a desktop voice-to-text app called WhisperClick and wanted to share it now that it's stable.

**What it does:** You press a global hotkey from any application, speak, and the transcribed text pastes at your cursor. It sits in your system tray and stays out of the way until you need it.

**How it compares to alternatives:**

| Feature | WhisperClick | Windows Voice Typing (Win+H) | Dragon | Google Voice Typing |
|---------|-------------|-------------------------------|--------|---------------------|
| Works in any app | Yes (global hotkey) | Some apps only | Yes | Browser only |
| Offline mode | Yes (local Whisper) | Yes | Yes | No |
| Cross-platform | Win/macOS/Linux | Windows only | Windows only | Browser |
| Open source | Yes (CC BY-NC-SA) | No | No | No |
| Cost | Free (BYOK for cloud) | Free | $200+ | Free |
| Languages | 50+ | Limited | Varies | Many |
| Transcription quality | High (GPT-4o / Whisper) | Decent | High | Good |
| Auto-paste at cursor | Yes | Yes | Yes | N/A |
| Privacy (no telemetry) | Yes | No | No | No |

**Transcription providers:** OpenAI (GPT-4o Transcribe, Whisper), Google Gemini, or fully local via faster-whisper. You bring your own API key for cloud providers -- typically under $1/month for normal use.

**Tech stack:** Electron + Python sidecar. Frontend is a single HTML file with Tailwind, no framework. 301 tests.

**Links:**
- Download: https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest
- Website: https://whisperclick.com
- Source: https://github.com/Zbrooklyn/WhisperClick-Desktop-App

Happy to answer questions about the architecture or how it compares to anything I missed.

---

## r/speechrecognition

**Title:** Built an open-source desktop app around Whisper/GPT-4o-transcribe for live voice-to-text

**Body:**

I wanted a way to use Whisper (and the newer GPT-4o transcription models) as a system-wide dictation tool on desktop. Everything I found was either cloud-only, limited to specific apps, or required too much setup.

So I built WhisperClick. It wraps multiple transcription backends behind a single global hotkey:

**Supported providers:**
- **OpenAI:** GPT-4o Transcribe, GPT-4o Mini Transcribe, Whisper-1
- **Google Gemini:** 2.5 Flash, 2.5 Pro, and newer models
- **Local:** faster-whisper models (runs entirely offline -- download once, no API needed)

**How it works:**
1. Press a global hotkey (Ctrl+Alt+R by default, customizable) from any app
2. Talk
3. Press the hotkey again
4. Transcribed text pastes at your cursor

The Python sidecar handles audio capture and transcription. Communication with the Electron frontend is JSON over stdin/stdout. Local models are managed through a built-in model browser -- download, switch, delete from the settings UI.

**Language support:** 50+ languages with auto-detection. You can also translate on the fly -- speak in one language and get the text in another.

Every transcription is saved with the original audio for playback. You can search, export, or replay anything.

Free and open source (CC BY-NC-SA 4.0): https://github.com/Zbrooklyn/WhisperClick-Desktop-App

I'm especially interested in feedback from people who've used other Whisper frontends. What works, what's missing?

---

## r/windows

**Title:** I built a system-wide voice-to-text app because Win+H wasn't cutting it

**Body:**

Windows Voice Typing (Win+H) is fine for basic stuff, but it has limitations that bugged me:

- Doesn't work in every app (some text fields just don't pick it up)
- Limited language support
- Can't choose your transcription model
- No history of past transcriptions
- No offline mode with a model you trust

So I built WhisperClick. It's a system tray app that gives you a global hotkey for voice-to-text that works in literally any app with a text cursor.

**What makes it different from Win+H:**
- Works in any text field, any app (VS Code, terminal, Electron apps, everything)
- Uses OpenAI GPT-4o Transcribe, Google Gemini, or local Whisper models -- your choice
- 50+ languages with auto-detection
- Searchable history of every transcription, with audio playback
- Fully offline mode (local models, no internet needed)
- Customizable hotkey with conflict detection
- A floating pill widget shows when you're recording -- stays out of the way otherwise

It sits in your system tray and you only interact with it when you need it. Auto-updates, dark/light theme, portable version available.

Free and open source. Runs on Windows 10/11 (also macOS and Linux in early access).

- Download: https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest
- Website: https://whisperclick.com

For anyone wondering about privacy: no telemetry, no analytics, no data collection. Audio goes to your chosen provider only when you press the hotkey. In local mode, nothing ever leaves your machine.

---

## r/macapps

**Title:** WhisperClick -- global hotkey voice-to-text for macOS (open source)

**Body:**

I built a voice-to-text desktop app that I've been using on Windows for a while, and it now runs on macOS (early access).

**What it does:** Press a global hotkey from any app, talk, and the text pastes at your cursor. Uses OpenAI, Google Gemini, or local Whisper models for transcription.

**macOS details:**
- DMG available for both Apple Silicon (M1-M4) and Intel Macs
- Core recording and transcription work well
- Some features like auto-paste behavior may vary from the Windows version -- still testing
- Auto-updates once installed

macOS has the built-in dictation feature, but WhisperClick adds a few things: choice of transcription model, 50+ languages, searchable history with audio playback, translate-on-the-fly, and a fully offline mode with local models.

It's an Electron app with a Python sidecar for audio/transcription. Free and open source (CC BY-NC-SA 4.0).

- Download: https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest
- Source: https://github.com/Zbrooklyn/WhisperClick-Desktop-App

If you try it on macOS, I'd genuinely appreciate hearing what works and what doesn't. Bug reports welcome: https://github.com/Zbrooklyn/WhisperClick-Desktop-App/issues

---

## r/opensource

**Title:** WhisperClick -- open source voice-to-text desktop app (Electron + Python, CC BY-NC-SA 4.0)

**Body:**

I've been working on WhisperClick, an open source desktop app that turns voice into text anywhere on your screen. Wanted to share it with this community since the open-source nature is a core part of the project.

**License:** CC BY-NC-SA 4.0 -- free for personal and non-commercial use, source-available, share-alike.

**Tech stack:**
- Electron (Node.js main process + Chromium renderer)
- Python sidecar for audio capture and transcription (JSON over stdin/stdout)
- Frontend: single HTML file + Tailwind CSS (no React, no build step)
- 301 tests (Jest unit + integration + E2E)
- electron-builder for cross-platform packaging

**What it does:** Global hotkey from any app triggers recording. You talk, it transcribes (via OpenAI, Google Gemini, or local faster-whisper models), and pastes the text at your cursor.

**Privacy commitment:** Zero telemetry, zero analytics, zero data collection. No background network calls. In local mode, audio never leaves your machine.

**Platforms:** Windows (stable), macOS and Linux (early access).

**How to contribute:**
- Source: https://github.com/Zbrooklyn/WhisperClick-Desktop-App
- Issues: https://github.com/Zbrooklyn/WhisperClick-Desktop-App/issues
- Build from source: `git clone`, `npm install`, `pip install -r engine/requirements.txt`, `npm start`

**Architecture overview:**

```
electron/          Node.js main process (window mgmt, IPC, hotkey, tray)
src/frontend/      Single HTML file (Tailwind CSS, inline JS)
src/pill/          Floating recording indicator widget
engine/            Python sidecar (audio capture, transcription, model mgmt)
tests/             281 unit + 12 integration + 13 E2E tests
```

I'd love feedback on the architecture, the license choice, or anything else. Happy to discuss trade-offs.

---

## r/accessibility

**Title:** Voice-to-text desktop app for people who can't (or prefer not to) type

**Body:**

I built WhisperClick primarily as a productivity tool, but I've realized it has real accessibility applications and I wanted to share it here for feedback.

**What it does:** You press a keyboard shortcut (customizable) from any application on your desktop, speak naturally, and the text appears where your cursor is. No switching apps, no copy-paste -- it just types for you.

**Why it might help:**

- **Motor impairments:** If typing is painful, slow, or impossible, this turns any text field into a voice input. Works in email, documents, chat apps, code editors, web forms -- anywhere you can place a cursor.
- **Repetitive strain:** If you type all day and need to give your hands a break, you can switch to voice for some tasks without changing your workflow.
- **Temporary injuries:** Broken hand, carpal tunnel flare-up, post-surgery -- voice input as a bridge while you recover.
- **Cognitive accessibility:** Speaking your thoughts can be easier than composing text by typing for some people.

**Important details:**

- **Hotkey is customizable.** If the default (Ctrl+Alt+R) doesn't work for your setup, you can remap it to almost any key combination, including function keys.
- **Floating pill indicator.** A small widget on screen shows when it's recording, with cancel/stop buttons you can click. You're never guessing whether it's listening.
- **50+ languages** with auto-detection.
- **Offline mode.** Local Whisper models mean no internet dependency and no voice data leaving your machine.
- **Free and open source.**

**Limitations I want to be honest about:**

- It currently requires pressing a hotkey to start. There's no "always listening" mode or wake word. For users who can't press keys at all, this wouldn't work on its own (though pairing with a switch device that sends keystrokes could work).
- macOS and Linux support is early access -- some features like auto-paste may not work perfectly yet.

Download: https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest
Website: https://whisperclick.com

I'd really appreciate feedback from people in this community. What would make this more useful for accessibility? What am I missing?
