# FAQ & Troubleshooting

> Everything you need to know about WhisperClick, from first install to fixing common issues.

---

## General

### What is WhisperClick?

WhisperClick is a desktop voice-to-text app. Press a hotkey from any application, speak naturally, and your transcribed text is pasted right where your cursor is. No window switching, no copying and pasting. It works in email, Slack, VS Code, Google Docs, terminals, and every other text field on your screen.

### Is it free?

Yes. WhisperClick is free for personal and non-commercial use under the [CC BY-NC-SA 4.0](../LICENSE) license. The app itself costs nothing. If you use cloud transcription (API mode), your API provider may charge a small amount per request, but typical usage runs well under $1/month.

### What platforms does it support?

| Platform | Status | Download |
|----------|--------|----------|
| **Windows** | Available now | Setup installer (.exe) or portable (.exe) |
| **macOS** | Coming soon | The codebase supports Apple Silicon and Intel, but builds aren't shipping yet |
| **Linux** | Coming soon | The codebase supports Linux, but the AppImage isn't shipping yet |

Windows downloads are on the [GitHub Releases page](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest). The app auto-updates after you install, so you only need to download once. To be notified when Mac and Linux builds ship, [open an issue](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/issues) or watch the repo.

### Does my voice data leave my computer?

It depends on which mode you use:

- **Local mode**: Audio never leaves your computer. Everything is processed on-device using a downloaded Whisper model. No network requests are made during transcription.
- **API mode**: Audio is sent to your chosen provider (OpenAI or Google) only when you press the hotkey. Nothing is sent otherwise. WhisperClick does not store or retain audio after the transcription response comes back.

There is no telemetry, no analytics, and no background network activity. See [PRIVACY.md](../PRIVACY.md) for full details.

### What is the difference between local mode and cloud mode?

| | Local Mode | Cloud Mode (API) |
|---|---|---|
| **Where processing happens** | On your computer | OpenAI or Google servers |
| **Internet required** | No (after initial model download) | Yes |
| **Speed** | Depends on your hardware | Typically 1-3 seconds |
| **Accuracy** | Good (varies by model size) | Excellent (state-of-the-art models) |
| **Cost** | Free | Pay-per-use via your API key (typically under $1/month) |
| **Privacy** | Audio never leaves your machine | Audio sent to provider for processing |
| **Languages** | 50+ (Whisper models) | 50+ (OpenAI), 40+ (Gemini) |

Local mode uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper) models that run entirely on your CPU. Cloud mode sends audio to OpenAI or Google Gemini for transcription using their latest models.

### Can I use it without an internet connection?

Yes, in local mode. You need to download a Whisper model once (this requires internet), but after that, all transcription happens offline. Open Settings, switch the mode slider to "Local," and select a downloaded model. Models range from "tiny" (fast, lower accuracy) to "large-v3" (slower, highest accuracy).

### What languages does it support?

WhisperClick supports 50+ languages for transcription. You can either let it auto-detect the spoken language or pick one manually. Supported languages include English, Spanish, French, German, Italian, Portuguese, Japanese, Korean, Chinese, Hindi, Arabic, and many more.

Translation is also supported: speak in one language and get text in another. Set a source and target language in Settings under "Language & Output."

---

## API & Setup

### How do I get an API key?

1. **OpenAI**: Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys), sign in (or create an account), and generate a new secret key. Copy the key and paste it into WhisperClick's settings.
2. **Google Gemini**: Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in with your Google account, and create an API key. Copy it into WhisperClick.

Both providers walk you through the process. It takes about 30 seconds.

### Which provider should I choose?

| | OpenAI | Google Gemini |
|---|---|---|
| **Best models** | GPT-4o Transcribe, Whisper | Gemini 2.5 Flash, 2.5 Pro |
| **Accuracy** | Excellent, industry standard | Excellent, rapidly improving |
| **Speed** | Fast (1-3s typical) | Fast (1-3s typical) |
| **Free tier** | Pay-as-you-go (no free tier, but very cheap) | Generous free tier available |
| **Pricing** | ~$0.006/min (Whisper), varies by model | Free tier, then pay-as-you-go |
| **Best for** | Proven reliability, widest language support | Budget-conscious users, Google ecosystem |

**Short answer**: If you want a free tier to try things out, start with Gemini. If you want the most battle-tested transcription, go with OpenAI. Both work well.

### How much does each provider cost?

Typical voice-to-text usage (a few dozen short recordings per day) costs well under $1/month with either provider. OpenAI charges per minute of audio. Gemini offers a free tier that covers light usage. Check each provider's pricing page for current rates:

- [OpenAI pricing](https://openai.com/pricing)
- [Google Gemini pricing](https://ai.google.dev/pricing)

### Is my API key stored securely?

Yes. API keys are encrypted at rest using Electron's `safeStorage`, which delegates to your operating system's native credential store (Windows Credential Locker, macOS Keychain, or the Linux secret service). Keys are never stored in plain text. If WhisperClick detects a legacy plaintext key from an older version, it automatically encrypts it on the next save.

Your API key is only ever sent to the provider you selected (OpenAI or Google). It is never transmitted anywhere else.

---

## Usage

### How do I change the hotkey?

Open Settings and scroll to the "System" section. You have two options:

1. **Capture mode**: Click the "Record" button next to the hotkey display, then press your desired key combination. WhisperClick will capture it.
2. **Manual entry**: Click the hotkey text directly and type the combo (e.g., `Ctrl+Alt+W`).

The hotkey must include a modifier key (Ctrl, Alt, Shift, or Win) or be an F-key (F7-F12). WhisperClick shows a color-coded indicator: green means safe, amber means it might conflict with other apps, and red means it is blocked because it would override essential system shortcuts (like Ctrl+C).

The default hotkey is **Ctrl+Alt+R**.

### What is the pill widget?

The pill is a small floating capsule that sits at the edge of your screen. When you are not recording, it is a tiny 72x14 pixel dormant capsule. When recording starts, it expands to show live audio bars, a stop button, and a cancel button.

You can:
- **Click it** to start or stop recording.
- **Drag it** anywhere on screen.
- **Right-click it** for quick access to history, settings, and other controls.
- **Move it to another monitor** via Settings or the tray menu.
- **Hide it** from Settings (Appearance section) or the right-click menu.

It always stays in sync with the main window and system tray.

### How does auto-paste work?

When auto-paste is enabled (the default), WhisperClick remembers which application had focus before you started recording. After transcription finishes, it copies the text to your clipboard and simulates Ctrl+V in that application. The text appears right where your cursor was.

You can toggle auto-paste in Settings under "Output." If you turn it off, transcriptions are still saved to your history and can be copied manually.

### Can I use it in any app?

Yes. WhisperClick works with any application that accepts keyboard input and clipboard paste. This includes web browsers, email clients, code editors, terminals, chat apps, word processors, and more. The global hotkey and auto-paste operate at the OS level, so they are not limited to specific apps.

### Does it work with voice commands?

WhisperClick is a transcription tool, not a voice command system. It converts your speech to text and pastes it. It does not execute commands, control your computer, or interact with other apps beyond pasting text. If you say "open my browser," it will type the words "open my browser."

---

## Troubleshooting

### "API key not working"

**Common causes:**

1. **Typo or extra spaces**: Copy the key directly from your provider's dashboard. Watch for leading/trailing spaces or line breaks.
2. **Wrong provider selected**: Make sure the provider dropdown in Settings matches the key you are entering. An OpenAI key will not work in the Gemini field, and vice versa.
3. **Key not activated**: Some providers require billing information before the key becomes active. Check your provider's dashboard for any alerts or pending steps.
4. **Key revoked or expired**: If you regenerated your key on the provider's site, the old one stops working. Paste the new key into WhisperClick.
5. **Account quota exceeded**: Check your provider's usage dashboard for rate limits or billing issues.

WhisperClick validates key format when you enter it. If the format looks correct but transcription still fails, the issue is usually on the provider's side (billing, quota, or region restrictions).

### "No audio detected"

**Check these in order:**

1. **Microphone permissions**: Make sure WhisperClick has microphone access.
   - **Windows**: Settings > Privacy & Security > Microphone. Ensure "Let desktop apps access your microphone" is on.
   - **macOS**: System Settings > Privacy & Security > Microphone. WhisperClick must be listed and enabled.
   - **Linux**: Check PulseAudio/PipeWire settings. The app needs access to an audio input device.

2. **Correct device selected**: Open WhisperClick Settings and check the Microphone dropdown. Make sure the right input device is selected, not a virtual device or a disconnected headset.

3. **System default device**: If WhisperClick's dropdown says "Default," make sure your OS default recording device is correct.
   - **Windows**: Right-click the speaker icon in the taskbar > Sound settings > Input. Verify the correct mic is set as default.

4. **Mic not muted**: Check that the microphone is not physically muted (hardware switch on headsets) and that the system volume is not at zero.

5. **Other apps using the mic**: Some apps lock exclusive access to the microphone. Close video calls, other recording software, or voice assistants and try again.

### Windows SmartScreen blocks the installation

Windows SmartScreen may show a warning like "Windows protected your PC" when you run the installer. This happens because the app is not yet code-signed with an Extended Validation (EV) certificate.

**To proceed:**

1. Click "More info" on the SmartScreen dialog.
2. Click "Run anyway."

This is a one-time step. The app is safe. Code signing is on the roadmap (see [ROADMAP.md](../ROADMAP.md)).

If you prefer not to bypass SmartScreen, you can use the portable version instead of the installer, or build from source (see the [README](../README.md)).

### macOS Gatekeeper blocks the app

macOS may show "WhisperClick can't be opened because it is from an unidentified developer." This happens because the app is not yet notarized with Apple.

**To proceed:**

1. Open **System Settings > Privacy & Security**.
2. Scroll down. You should see a message about WhisperClick being blocked.
3. Click **"Open Anyway"** and confirm.

Alternatively, right-click the app in Finder and select "Open" from the context menu. This bypasses Gatekeeper for that specific app.

Apple notarization is on the roadmap (see [ROADMAP.md](../ROADMAP.md)).

### App not pasting text after transcription

If transcription succeeds (you see text in the history) but it does not paste into your target app:

1. **Focus timing**: WhisperClick captures which window had focus before recording. If you clicked somewhere else during recording, the paste target may be wrong. Keep your cursor in the target app before pressing the hotkey.

2. **Auto-paste disabled**: Check Settings > Output and make sure auto-paste is turned on.

3. **macOS accessibility permissions**: On macOS, auto-paste requires accessibility access.
   - Go to **System Settings > Privacy & Security > Accessibility**.
   - Add WhisperClick to the list and enable it.
   - You may need to restart the app after granting permission.

4. **Target app blocks simulated input**: Some apps with elevated privileges (admin consoles, certain security tools) may ignore simulated keystrokes. Try pasting manually with Ctrl+V (or Cmd+V on macOS) after the transcription appears in your history.

5. **Clipboard manager interference**: Third-party clipboard managers can sometimes intercept the paste. Try temporarily disabling yours to test.

### High CPU usage in local mode

Local transcription uses your CPU to run the Whisper model. This is expected during processing and should return to normal once transcription finishes.

**To reduce CPU usage:**

1. **Use a smaller model**: In Settings, switch to a smaller model (e.g., "tiny" or "base" instead of "large-v3"). Smaller models use less CPU at the cost of some accuracy.
2. **Switch to API mode**: Cloud transcription offloads all processing to the provider's servers. Your CPU stays idle.
3. **Keep recordings short**: Longer audio takes more CPU time to process. For local mode, shorter recordings transcribe faster.

If CPU stays high even when you are not recording or transcribing, restart the app. The Python sidecar process should be idle between recordings.

### Auto-updater not working

WhisperClick checks for updates automatically and downloads them in the background. If updates are not being applied:

1. **Check manually**: Open Settings and scroll to the "Updates" section. Click "Check for Updates" to trigger a manual check.
2. **Firewall or proxy**: The updater downloads from GitHub Releases. Make sure your network allows connections to `github.com` and `objects.githubusercontent.com`.
3. **Portable version**: The portable (.exe) version does not support auto-updates. You need to download new versions manually from the [Releases page](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/releases/latest). Use the installer version for auto-updates.
4. **Update channel**: If you are on the beta channel, you will receive beta updates. If you are on the stable channel, you will only see stable releases. Check your update channel in Settings.
5. **Restart required**: After an update downloads, you need to click "Install & Restart" (or restart the app) for it to take effect. Updates do not install while the app is running.

### App crashes or will not start

1. **Reset settings**: If the app crashes on launch, your settings file may be corrupted. Delete the settings file and restart:
   - **Windows**: Delete `%APPDATA%/Electron/whisperclick/settings.json` (or `whisperclick-beta` for the beta channel).
   - **macOS**: Delete `~/Library/Application Support/whisperclick/settings.json`.
   - **Linux**: Delete `~/.config/whisperclick/settings.json`.
   The app will recreate default settings on next launch.

2. **Sidecar not starting**: WhisperClick relies on a Python sidecar process for recording and transcription. If it fails to start, the app will show an error. Try restarting the app. The sidecar auto-restarts up to 3 times with exponential backoff.

3. **Antivirus interference**: Some antivirus software blocks the Python sidecar process. Add WhisperClick's installation directory to your antivirus exclusion list.

4. **Port or process conflicts**: If a previous instance did not shut down cleanly, a stale process may block the new one. Check your task manager for lingering `WhisperClick` or `python` processes and end them.

---

## Still need help?

- [Open an issue on GitHub](https://github.com/Zbrooklyn/WhisperClick-Desktop-App/issues) and we will look into it.
- Include your OS, WhisperClick version (shown at the bottom of the app), and steps to reproduce the problem.
