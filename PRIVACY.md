# Privacy Policy

WhisperClick is designed with privacy as a core principle. This document explains what data WhisperClick accesses and how it is handled.

## Local Mode (Fully Offline)

When using local mode with a downloaded Whisper model:

- **Audio never leaves your computer.** All processing happens on-device.
- No network requests are made during transcription.
- No telemetry, analytics, or usage data is collected.

## API Mode (Cloud Transcription)

When using API mode (OpenAI or Gemini):

- **Audio is sent to the selected provider** (OpenAI or Google) for transcription.
- Audio is sent only when you explicitly trigger a recording via the hotkey.
- WhisperClick does not store, cache, or retain audio after the transcription response is received.
- Transcribed text is stored locally in your history (on your machine only).

### Third-Party Provider Privacy

- **OpenAI**: Audio sent to the OpenAI Whisper API. See [OpenAI's privacy policy](https://openai.com/privacy).
- **Google Gemini**: Audio sent to the Google Gemini API. See [Google's privacy policy](https://policies.google.com/privacy).

WhisperClick has no control over how these providers handle your audio data. Review their policies before using API mode.

## API Keys

- API keys are stored securely using your operating system's native credential manager (Windows Credential Locker via the `keyring` library).
- Keys are never written to plain-text files, logs, or configuration files.
- Keys are never transmitted anywhere except to the API provider you selected.

## Local Data Storage

WhisperClick stores the following locally in `~/.config/whisperclick/`:

| Data | Purpose | Retention |
|------|---------|-----------|
| Settings | Your preferences (mode, model, hotkey, language) | Until you change them |
| Transcription history | Text of past transcriptions | Until you delete them |
| Audio recordings | Compressed recordings for playback | Auto-deleted after 24 hours |
| Whisper models | Downloaded model files for local mode | Until you delete them |

## Network Access

WhisperClick makes network requests **only** when:

1. Downloading a Whisper model (local mode setup, one-time)
2. Sending audio to OpenAI or Google for transcription (API mode only)
3. Verifying an API key on entry (API mode only)

No other network requests are made. There is no telemetry, no update checks, and no background network activity.

## Data Collection

WhisperClick collects **zero** telemetry, analytics, crash reports, or usage data. Nothing is sent to WhisperClick developers or any third party (other than the API providers you choose to use).
