# Roadmap — WhisperClick Electron

> Last updated: 2026-03-05
> Items marked **[BLOCKED — awaiting confirmation]** will not be started without explicit approval.

## Completed (beta.7–beta.9)

- [x] Pill error feedback — tooltip shows API key, sidecar, timeout errors
- [x] Pill cancel button — immediately resets state
- [x] Auto-updater CI fix — `latest.yml` generation, channel fix
- [x] Silent update install — no NSIS wizard on update
- [x] Auto-download updates toggle
- [x] Pill history shortcut — right-click pill → History
- [x] Release notes in update UI
- [x] Update UI responsiveness — instant spinner, "Checked just now"
- [x] Update-ready system notification

---

## Easy

### Clipboard History Ring
Hotkey (e.g., Ctrl+Alt+V) opens a small picker showing the last 5–10
transcriptions. Pick one to paste without opening the main app.

### Speaker Diarization Display
The `gpt-4o-transcribe-diarize` model returns speaker labels, but the
frontend doesn't render them. Show "Speaker 1:", "Speaker 2:" with
color coding in the transcript detail view and history preview.

### Language Auto-Detect Badge
The engine already returns `detected_language` in the transcription
result. Show a small badge (e.g., "EN", "ES") on each history item.
Backend is done — frontend display only.

### Snippet Templates
Saved text snippets that wrap transcriptions: email signatures, meeting
note headers with date/attendees, code comment formatting. Settings UI
to manage templates, dropdown to pick one before or after recording.

### Recording Sound Customization
Let users pick start/stop sounds from built-in options, or disable
them. Dropdown in settings: Default, Subtle Click, Voice ("Recording
started"), None.

---

## Medium

### Custom Post-Processing Prompts
Attach a prompt that transforms the transcript after transcription:
"Fix grammar", "Summarize", "Convert to bullet points", "Make this a
professional email." Runs through the same API provider. Needs a
prompt editor in settings and a post-transcription LLM call in the
engine.

### Drag-and-Drop Audio File Transcription
Drop .mp3/.wav/.m4a/.ogg onto the app window to transcribe without
recording. The engine already handles audio — needs a file input path
in the sidecar protocol, a drop zone in the frontend, and history
entries tagged as "file" vs "recording."

### macOS Intel (x64) Support
Currently only Apple Silicon (arm64) DMGs are built. Intel Macs
(pre-2020) can't run the app. Three options to investigate:

1. **Self-hosted runner** — Run a macOS x64 GitHub Actions runner
   (own hardware or a service like MacStadium). Full native build,
   no cross-compilation needed. Most reliable but costs money.
2. **Universal binary** — Build a fat binary on the arm64 runner.
   Electron supports `--universal`, but the Python sidecar is the
   blocker — PyInstaller can't cross-compile x64 from arm64. Would
   need to ship a separate x64 Python sidecar or use Rosetta 2 as
   the fallback.
3. **Rosetta 2 compatibility** — Ship the arm64 DMG and document
   that Intel Mac users need Rosetta 2. Apple bundles Rosetta with
   macOS Ventura+. Zero build cost but may have performance issues
   with the Python sidecar, and older macOS versions won't have it.

**Status:** GitHub retired `macos-13` (Intel) runners. Need to pick
an alternative path. Significant portion of Mac users still on Intel.

### Live Streaming Runtime
True real-time transcription with partial updates during recording.
New sidecar event type (`partial_transcript`), streaming-capable
Whisper in the engine, and frontend UI to show live text.

---

## Hard

### Code Signing
Windows SmartScreen + macOS Gatekeeper block unsigned installs.
Requires certificates ($99–$400/yr Apple, $200+/yr Windows EV),
CI secrets, and macOS notarization. Biggest barrier is cost.

### Stable Release Channel
Ship a polished `v2.2.0` stable. Channel switching UI exists but
there are no stable releases to switch to.

---

## Discussion Needed

### Quick Actions Toast
After transcription, show a brief toast with action buttons: Copy,
Paste, Edit, Discard. Gives the user a 3-second window to choose.
**Open question:** Does this conflict with auto-paste? Should it
replace auto-paste or supplement it? What happens if the user doesn't
click anything — default to auto-paste or do nothing?

### Keyboard-Only Mode
Full keyboard navigation: hotkey to open history, arrow keys to
browse entries, Enter to copy, Escape to dismiss. Power users who
dictate don't want to touch the mouse.
**Open question:** Scope — is this just history navigation, or full
app keyboard nav (settings, onboarding, etc.)? How does it interact
with the global hotkey system? Focus trap considerations for the
settings drawer.

---

## Future Vision — Context-Aware Transcription (requires discussion)

Smart detection of what the user is doing, so transcription output
adapts automatically. Three phases:

### Phase 1: Active Window Detection
We already capture the foreground window for auto-paste. Add process
name + window title pattern matching to detect context:
- Gmail/Outlook in title → email context
- Slack/Discord/Teams → chat context
- VS Code/Cursor → code context
- Google Docs/Word → document context

Feed this context into post-processing prompts automatically.

### Phase 2: Browser URL Detection
Lightweight browser extension that reports the current URL for finer
context within web apps. Distinguishes "composing in Gmail" from
"browsing Gmail inbox" from "reading in Google Docs."

### Phase 3: UI Automation Integration
Windows `IUIAutomation` API to inspect the focused control — what
field type, what surrounding labels. Knows "user is in the subject
line" vs "user is in the email body." Deepest integration, closest
to how screen readers work.

---

## Competitive Feature Analysis — [BLOCKED — awaiting confirmation]

> Features observed in WhisperFlow, Wispr Flow, Superwhisper, Otter.ai,
> MacWhisper, Rev, and Notta. None will be implemented without explicit
> approval. Included here for reference and planning.

### Voice Commands & Dictation Control

**What it is:** Spoken words like "new line", "period", "comma",
"question mark", "delete that", "select all" are interpreted as editing
actions, not transcribed literally. Turns voice input into a true text
editing tool.

**Who does it:** Wispr Flow (core feature — they call it "voice
commands"), Superwhisper ("dictation mode"), Windows built-in Voice
Typing (basic punctuation only), Apple Dictation (macOS/iOS — "new
paragraph", "cap").

**Why it matters:** Without this, users have to manually fix punctuation
and formatting after every transcription. With it, the output is
near-final on first pass. Wispr Flow users cite this as the #1 reason
they switched from competitors.

**Implementation complexity:** Medium. Requires a post-processing layer
that pattern-matches command phrases before outputting text. Could be
a local regex pass (no API needed) for basic commands, or LLM-powered
for advanced ones like "delete the last sentence."

---

### Voice Corrections

**What it is:** Spoken phrases like "replace X with Y", "capitalize
that", "make that a question", "undo" let users edit the transcript
without touching the keyboard.

**Who does it:** Wispr Flow (advanced — supports multi-word replace),
Apple Dictation (basic — "replace [word] with [word]"), Dragon
NaturallySpeaking (the original — full voice editing suite).

**Why it matters:** Completes the hands-free workflow. Users who dictate
because of RSI or accessibility needs can't easily grab the keyboard
to fix mistakes. Without voice corrections, they're stuck with a
90%-accurate transcript they still need to manually edit.

**Implementation complexity:** Hard. Requires maintaining a buffer of
recently-transcribed text, parsing correction intent, and sending
simulated keystrokes to replace text in the target app. The "undo"
case requires tracking what was pasted and where.

---

### Custom Vocabulary / Proper Nouns

**What it is:** Users add specific names, brand terms, and jargon that
the speech model tends to misspell. Examples: "WhisperClick" → not
"whisper click", "PostgreSQL" → not "post gress Q L", a person's
unusual name.

**Who does it:** Otter.ai (custom vocabulary in settings), Rev
(per-project glossary), Dragon (extensive vocabulary training),
Google Cloud Speech-to-Text (phrase hints API).

**Why it matters:** Every user has 5–20 words the model consistently
gets wrong. It's a small feature with outsized quality-of-life impact.
Especially important for technical users (programming terms),
business users (client names, product names), and multilingual users
(names from other languages).

**Implementation complexity:** Easy–Medium. For API mode: OpenAI and
Gemini both support prompt-level hints — append vocabulary to the
system prompt. For local mode: faster-whisper supports
`initial_prompt` with terminology hints. UI needs a simple list
editor in settings.

---

### Smart Punctuation from Speech Patterns

**What it is:** Automatic punctuation, capitalization, and paragraph
breaks based on pause length and speech cadence — not just the model's
guess. A 0.5s pause → comma. A 1.5s pause → period + new sentence.
A 3s pause → new paragraph.

**Who does it:** MacWhisper (pause-based paragraph breaks),
Superwhisper (auto-punctuation mode), Apple Dictation (basic),
Google Recorder (paragraph segmentation).

**Why it matters:** Default Whisper output often runs sentences
together or adds punctuation inconsistently. Pause-aware formatting
produces output that reads naturally without manual editing.

**Implementation complexity:** Medium. The engine already has access
to audio timestamps. Could be a post-processing pass that inserts
breaks based on silence gaps in the audio, or a prompt hint to the
model about punctuation preferences.

---

### Continuous Listening / Voice Activity Detection

**What it is:** Always-on mode that auto-starts recording when you
begin speaking and auto-stops on silence. No hotkey needed. Just
start talking.

**Who does it:** Wispr Flow (core selling point — "always listening,
never recording until you speak"), Superwhisper (optional mode),
Windows Voice Typing (activated, then listens continuously), Google
Recorder (continuous with pause segmentation).

**Why it matters:** Eliminates the cognitive overhead of pressing a
hotkey before speaking. Users report that having to "remember to
press the button" breaks their flow, especially during rapid
note-taking or brainstorming sessions.

**Implementation complexity:** Hard. Requires a lightweight voice
activity detection (VAD) model running continuously (e.g., Silero
VAD — small, fast, runs on CPU). Privacy implications: the mic is
always open. Must be opt-in with clear indicator. Battery/CPU impact
on laptops needs measurement.

---

### Meeting Mode

**What it is:** Long-form recording (30–90 min) with speaker
identification, timestamps every 30s, and auto-generated
summary + action items at the end. Optimized for meetings,
not quick dictation.

**Who does it:** Otter.ai (core product — live meeting transcription),
Notta (meeting recorder + summary), Tactiq (Google Meet/Zoom
integration), Fireflies.ai (meeting bot that joins calls).

**Why it matters:** Different use case from quick dictation but
uses the same underlying tech. Users who already have WhisperClick
installed would use meeting mode instead of paying for a separate
Otter subscription. High retention feature.

**Implementation complexity:** Hard. Requires: long-form audio
chunking in the engine (current flow optimized for <60s clips),
speaker diarization (partially supported via gpt-4o-transcribe-diarize),
timestamp injection, and a summary generation step (LLM call at end).
Frontend needs a distinct "meeting" UI with timeline view.

---

### Word-Level Timestamps in Playback

**What it is:** Click any word in the transcript to jump to that
exact moment in the audio recording. Words highlight as audio plays
(karaoke-style).

**Who does it:** Otter.ai (core feature), Rev (professional
transcription tool), Descript (audio/video editor — pioneered this
UX), MacWhisper (word-level highlighting).

**Why it matters:** Makes reviewing and correcting transcripts fast.
Instead of re-listening to the whole recording to find one mistake,
click the suspicious word and hear the 2 seconds around it. Especially
valuable for meeting mode and long recordings.

**Implementation complexity:** Medium. faster-whisper already returns
word-level timestamps. The engine would need to pass these through.
Frontend needs a clickable transcript view that syncs with the audio
player. Playback seek logic already exists.

---

### App Integrations (Direct Send)

**What it is:** Instead of only clipboard paste, send transcriptions
directly to Notion, Obsidian, Google Docs, Slack, or email. One click
to append to a specific Notion page or post in a Slack channel.

**Who does it:** Otter.ai (Slack, Zoom, Google Calendar integrations),
Notta (Notion, Google Docs), Superwhisper (Raycast integration on
macOS), Wispr Flow (no integrations — clipboard only, like us).

**Why it matters:** Reduces friction for users who always send
transcriptions to the same place. Power users would set up a
"meeting notes → Notion" pipeline once and never copy-paste again.

**Implementation complexity:** Medium–Hard per integration. Each
service needs its own API client, auth flow (OAuth2), and settings
UI. Could start with one high-value integration (Notion or Obsidian,
both have simple APIs) and expand based on demand.

---

### Confidence Highlighting

**What it is:** Words the model was uncertain about are highlighted
in a different color (e.g., yellow underline) so users can spot-check
only the risky parts instead of re-reading the entire transcript.

**Who does it:** Rev (professional transcription — highlights low-
confidence words), Google Cloud Speech-to-Text (returns confidence
scores per word), Amazon Transcribe (confidence scores in API).

**Why it matters:** Saves review time. A 500-word transcript might
have 10 low-confidence words — reviewing just those takes 15 seconds
vs 2 minutes reading everything. Builds user trust in the output.

**Implementation complexity:** Medium. faster-whisper returns per-word
log probabilities. API providers return confidence scores (OpenAI
doesn't expose them directly, but Gemini does). Frontend needs a
styled span wrapper for low-confidence words.
