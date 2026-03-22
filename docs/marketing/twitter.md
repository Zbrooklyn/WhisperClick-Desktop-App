# Twitter/X Launch Thread

## Tweet 1 (Hook)

I just shipped WhisperClick -- a desktop app that lets you talk instead of type in any app on your screen.

One hotkey. You talk. Text appears at your cursor.

It's free, open source, and runs on Windows, macOS, and Linux.

Here's what it does and why I built it:

## Tweet 2 (The Problem)

You talk 3-4x faster than you type.

That speed gap costs you hours every week in emails, Slack messages, docs, and code comments.

I wanted one hotkey that would let me capture my thoughts at the speed I think them. No window switching, no copy-paste, no dictation app to deal with.

## Tweet 3 (How It Works)

How it works:

1. Press Ctrl+Alt+R from any app
2. Talk naturally
3. Press the hotkey again
4. Text appears at your cursor, already pasted

Works in VS Code, Gmail, Slack, Notion, a terminal -- anywhere you can place a cursor.

A tiny floating pill shows when it's listening. Otherwise, it's invisible.

## Tweet 4 (Providers / Offline)

You pick your transcription engine:

- OpenAI (GPT-4o Transcribe, Whisper)
- Google Gemini
- Local Whisper models (fully offline)

Cloud mode costs under $1/month. Local mode means your voice never leaves your computer.

50+ languages. Auto-detect or translate on the fly -- speak in one language, get text in another.

## Tweet 5 (Privacy + Architecture)

Privacy was non-negotiable:

- Zero telemetry
- Zero analytics
- Zero data collection
- No always-on microphone

It only listens when you press the hotkey. API keys encrypted at rest.

Built with Electron + a Python sidecar. Frontend is one HTML file. 301 tests. No framework overhead.

## Tweet 6 (Call to Action)

WhisperClick is free and open source (CC BY-NC-SA 4.0).

Download: https://whisperclick.com
GitHub: https://github.com/Zbrooklyn/WhisperClick-Desktop-App

Windows is fully stable. macOS and Linux are in early access.

Setup takes 60 seconds. Try it and let me know what you think.

## Tweet 7 (Engagement)

If you've tried voice-to-text on desktop before and it didn't stick -- I'd love to hear why.

What was the friction? What would make you actually use it daily?

Building in public and this feedback genuinely shapes what I work on next.

---

## Standalone Tweets (Optional, for Later)

### Feature Highlight: History

Every transcription in WhisperClick is saved with the original audio.

Search your past transcriptions, replay the audio, export as text.

I accidentally turned it into a voice journal -- just talk my thoughts throughout the day and search them later.

### Feature Highlight: Offline Mode

WhisperClick works completely offline.

Download a Whisper model once, then transcribe without internet. Your voice never leaves your machine.

No API key needed. No subscription. No data going anywhere.

### Feature Highlight: The Pill

The hardest UI problem in voice-to-text: how do you show recording state without getting in the way?

WhisperClick uses a floating pill -- 72 pixels wide when dormant. Expands with live audio bars when recording. Drag it anywhere. Right-click for controls.

It took way too many iterations to get right.

### For Developers

If you're building a desktop app that needs Python capabilities (ML, audio, data science), check out WhisperClick's architecture.

Electron handles the UI. A Python sidecar handles the heavy lifting. They talk over stdin/stdout JSON.

Clean separation. No native addons. No embedded Python.

Source: https://github.com/Zbrooklyn/WhisperClick-Desktop-App
