# Product Hunt Listing

## Tagline (60 chars max)

> Talk instead of type. One hotkey, instant transcription.

(55 characters)

## Description (260 chars max)

> WhisperClick is a desktop app that turns your voice into text anywhere on your screen. Press a hotkey, talk, and the transcription pastes at your cursor. Works with OpenAI, Gemini, or fully offline. Open source, cross-platform, privacy-first.

(243 characters)

## Maker's Comment

Hey everyone -- I built WhisperClick because I got tired of the gap between how fast I think and how fast I type.

You talk 3-4x faster than you type. That difference adds up -- emails, Slack messages, docs, code comments. Every text field on your desktop becomes a bottleneck.

WhisperClick is dead simple: press a hotkey from any app, say what you're thinking, and the text appears at your cursor. No window switching, no clipboard dance, no "paste from dictation app." You talk, it types, you keep working.

A few things I'm proud of:

- **It works everywhere.** Global hotkey captures from any app -- VS Code, Google Docs, Slack, a terminal, whatever has focus. The transcription pastes right where your cursor was.
- **Multiple transcription backends.** OpenAI (GPT-4o Transcribe, Whisper), Google Gemini, or local models via faster-whisper. Your choice, your API key, your data.
- **Privacy by default.** No telemetry, no analytics, no background network calls. In local mode, your voice never leaves your machine.
- **Stays out of your way.** A tiny floating pill shows recording state. Right-click it for controls. Otherwise it's invisible.

The architecture is an Electron app with a Python sidecar that handles the actual audio capture and transcription. The frontend is a single HTML file with Tailwind -- no React, no build step. 301 tests keep things honest.

It's free, open source (CC BY-NC-SA 4.0), and runs on Windows, macOS, and Linux.

Would love your feedback. This is a tool I use every day, and I want to make it better.

## Key Features

- **One hotkey, instant paste** -- Press Ctrl+Alt+R from any app. Talk. Text appears at your cursor. That's the whole workflow.
- **Multiple AI providers** -- OpenAI GPT-4o Transcribe, Google Gemini, or run completely offline with local Whisper models.
- **50+ languages** -- Auto-detect or pick a specific language. Translate on the fly -- speak in one language, get text in another.
- **Searchable history** -- Every transcription saved with the original audio. Search, replay, export anything.
- **Privacy-first** -- No telemetry, no analytics, no data collection. Local mode means your voice never leaves your computer.

## Topics

- Productivity
- Developer Tools
- Accessibility
- Artificial Intelligence
- Open Source

## Links

- **Website:** https://whisperclick.com
- **GitHub:** https://github.com/Zbrooklyn/WhisperClick-Desktop-App
- **Download:** https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest
