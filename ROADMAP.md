# Roadmap — WhisperClick

> Last updated: 2026-04-11
>
> Mono-repo now contains both Electron (shipping) and Tauri (alpha) platforms.
> See HANDOFF.md "Path B" for the current blockers on shipping Mac/Linux builds.

---

## Completed

- [x] Pill error feedback — tooltip shows API key, sidecar, timeout errors
- [x] Pill cancel button — immediately resets state
- [x] Auto-updater CI fix — `latest.yml` generation, channel fix
- [x] Silent update install — no NSIS wizard on update
- [x] Auto-download updates toggle
- [x] Pill history shortcut — right-click pill → History
- [x] Release notes in update UI
- [x] Update UI responsiveness — instant spinner, "Checked just now"
- [x] Update-ready system notification
- [x] macOS Intel (x64) support — two DMGs per release
- [x] Stable release channel — v2.0.0 shipped, channel switching functional
- [x] Silero VAD model bundled in PyInstaller build (v2.0.2)
- [x] Default update channel derived from version string (v2.0.3)
- [x] Sidecar cleanup before update install (v2.0.4)
- [x] Settings UX reorganization by user priority (v2.0.4)
- [x] Instant version display via preload DOM injection (v2.0.5)
- [x] Premium directory structure + public sync exclusion (v2.0.5)

---

# Free Version Roadmap

Everything needed to ship a polished, complete free product.

## Phase F0 — State Machine Refactor (Priority)

Recurring state bugs (v2.1.0–v2.1.2) stem from implicit state management.
Full design: `docs/dev/state-machine-refactor.md`. Branch: `feature/state-machine`.

- [ ] **Phase 1**: Extract state machine module — defined states, transitions, guards
- [ ] **Phase 2**: Single input gate — replace 5 overlapping debounce/guard layers
- [ ] **Phase 3**: Pill as dumb terminal — zero local state, render payloads from main
- [ ] **Phase 4**: Frontend state simplification — remove isRecording/isProcessing flags
- [ ] **Phase 5**: Event-driven transitions — replace timer-based with event + fallback

## Phase F1 — Stability & CI

- [ ] Fix 3 Linux CI test failures (currently `continue-on-error: true`)
- [ ] Fix flaky hotkey test (timing-dependent `mainWindow destroyed` fallback)
- [ ] Verify all platforms build and install cleanly from public repo

## Phase F2 — Trust & Distribution

- [ ] **Code signing — Windows** SmartScreen blocks unsigned installs.
  Requires EV code signing certificate ($200+/yr). CI secret + `signtool`.
- [ ] **Code signing — macOS** Gatekeeper blocks unsigned DMGs.
  Requires Apple Developer certificate ($99/yr) + notarization step in CI.
- [ ] Landing page / website for free download (alternative to raw GitHub releases)

## Phase F3 — Polish (if needed before premium focus)

- [ ] Quick Actions Toast — post-transcription toast with Copy/Paste/Edit/Discard
  (open question: does this replace or supplement auto-paste?)
- [ ] Keyboard-Only Mode — full keyboard navigation for power users
  (open question: scope — history only, or full app?)

---

# Premium Version Roadmap

All features below ship in the paid build only. Code lives in `electron/premium/`
and `src/frontend/premium/`, excluded from public repo via `sync_public.sh`.

## Phase P0 — Monetization Infrastructure

Before any premium features can ship, the licensing and payment system must exist.

- [ ] **Decide: provider path** — A (Lemon Squeezy), B (LS/Stripe + Keygen), or C (self-hosted)
- [ ] **Decide: pricing model** — one-time, perpetual + updates, subscription, or hybrid
- [ ] **Decide: price point** — $29, $39, $49, or subscription at $X/mo
- [ ] **Decide: distribution** — whisperclick.com, storefront, or both
- [ ] **Decide: premium module loading** — dynamic `require()`, plugin registry, or conditional imports
- [ ] Build license key validation (Ed25519 offline or provider SDK)
- [ ] Build premium module loader in main process
- [ ] Set up private repo CI for premium builds (separate from public free builds)
- [ ] Premium activation UI in settings (enter license key, show status)

### Research (completed 2026-03-05)

<details>
<summary>License key providers</summary>

| | Gumroad | Lemon Squeezy | Keygen.sh | Paddle | Self-Hosted |
|---|---|---|---|---|---|
| Monthly cost | $0 | $0 | $0 (≤100 users) / $49+ | $0 | $5-15 hosting |
| Per-txn fee | 10% + $0.50 | 5% + $0.50 | None (flat monthly) | 5% + $0.50 | Stripe: 2.9% + $0.30 |
| Handles payments | Yes | Yes (MoR) | No | Yes (MoR) | No |
| License keys | Yes | Yes | Yes | No (dropped) | You build |
| Offline validation | No (cached) | No | Yes (Ed25519) | No | Yes (Ed25519) |
| Tax/VAT handling | Yes | Yes (MoR) | No | Yes (MoR) | No |
| Electron support | npm pkg | REST (easy) | Official example | None | DIY |

**Paddle eliminated** — dropped license key management.

**Three viable paths:**
- **Path A (Simplest):** Lemon Squeezy all-in-one. ~5% + $0.50/sale.
- **Path B (Best offline):** Stripe/LS for payments + Keygen.sh for licensing. Ed25519 offline.
- **Path C (Max control):** Stripe + self-hosted Keygen CE or custom Ed25519 server.

</details>

<details>
<summary>Competitor pricing</summary>

| App | Model | Price |
|---|---|---|
| Wispr Flow | Sub | Free (2K words/wk), Pro $12/mo annual |
| Superwhisper | Sub + Lifetime | Free (small models), Pro $8.49/mo, Lifetime $249 |
| MacWhisper | One-time | Free tier, Pro ~$70-80 |
| Otter.ai | Sub | Free (300 min/mo), Pro $8.33/mo annual |
| VoiceInk | One-time | $25-49 (by device count) |
| Dragon | One-time / Sub | $699 perpetual, $55/mo cloud |
| Descript | Sub | Free (1 hr), Hobbyist $12/mo, Creator $24/mo |
| Rev | Sub + per-min | $14.99/mo (20 hrs), $0.25/min AI |

**Sweet spot:** $8-15/month or $69-150/year. One-time: $25-80 indie, $249 lifetime.

</details>

<details>
<summary>Offline validation approach</summary>

**Ed25519 signed license tokens:**
- Server generates Ed25519 keypair at setup.
- On purchase, sign `{ userId, email, licenseKey, product, expiresAt, machineLimit }`.
- App embeds public key, verifies locally — no network call.
- Node.js `crypto.verify()` supports Ed25519 natively.
- Optional machine binding via `node-machine-id`.
- Hybrid: refresh online (30-90 day TTL), trust offline until expiry.

</details>

## Phase P1 — Launch Features

Ship with the first premium release. Easy wins that immediately differentiate paid from free.

### Custom Vocabulary / Proper Nouns
Users add names, brands, and jargon the model misspells. Appended as prompt
hints (API: system prompt, local: `initial_prompt`). Simple list editor in settings.
**Complexity:** Easy–Medium

### Language Auto-Detect Badge
Engine already returns `detected_language`. Show a badge ("EN", "ES") on each
history item. Backend done — frontend display only.
**Complexity:** Easy

### Speaker Diarization Display
`gpt-4o-transcribe-diarize` returns speaker labels. Show "Speaker 1:", "Speaker 2:"
with color coding in transcript detail and history preview.
**Complexity:** Easy

### Recording Sound Customization
Pick start/stop sounds from built-in options or disable them.
Dropdown: Default, Subtle Click, Voice ("Recording started"), None.
**Complexity:** Easy

### Snippet Templates
Saved text snippets that wrap transcriptions — email headers, meeting note
templates, code comment formatting. Settings UI to manage, dropdown to apply.
**Complexity:** Easy

## Phase P2 — Core Differentiators

Features that make the premium version clearly worth paying for.

### Custom Post-Processing Prompts
Attach a prompt that transforms output: "Fix grammar", "Summarize", "Convert to
bullet points", "Make this a professional email." Prompt editor in settings,
post-transcription LLM call in engine.
**Complexity:** Medium

### Voice Commands & Dictation Control
"New line", "period", "comma", "delete that" interpreted as actions, not transcribed.
Post-processing layer: local regex for basic commands, LLM for advanced.
**Complexity:** Medium

### Drag-and-Drop Audio File Transcription
Drop .mp3/.wav/.m4a/.ogg to transcribe without recording. Needs file input path
in sidecar protocol, drop zone in frontend, history entries tagged "file" vs "recording."
**Complexity:** Medium

### Smart Punctuation from Speech Patterns
Auto punctuation and paragraph breaks based on pause length. 0.5s → comma,
1.5s → period, 3s → new paragraph. Post-processing pass using audio timestamps.
**Complexity:** Medium

### Clipboard History Ring
Hotkey (e.g., Ctrl+Alt+V) opens a picker showing last 5–10 transcriptions.
Pick one to paste without opening the main app.
**Complexity:** Easy–Medium

## Phase P3 — Advanced Features

Higher-effort features that expand into new use cases.

### Live Streaming Runtime
Real-time transcription with partial updates during recording. New sidecar event
(`partial_transcript`), streaming Whisper in engine, frontend live text display.
**Complexity:** Medium–Hard

### Word-Level Timestamps in Playback
Click any word to jump to that moment in audio. Words highlight as audio plays
(karaoke-style). faster-whisper already returns word timestamps.
**Complexity:** Medium

### Confidence Highlighting
Low-confidence words highlighted (yellow underline) for spot-checking. Uses
per-word log probabilities from faster-whisper or API confidence scores.
**Complexity:** Medium

### Voice Corrections
"Replace X with Y", "capitalize that", "undo" — edit transcript by voice.
Requires text buffer, correction intent parsing, simulated keystrokes.
**Complexity:** Hard

### Continuous Listening / VAD
Always-on mode: auto-starts on speech, auto-stops on silence. Silero VAD
running continuously. Privacy opt-in with clear indicator. Battery impact TBD.
**Complexity:** Hard

## Phase P4 — Platform Features

Transform WhisperClick from a tool into a platform.

### Meeting Mode
Long-form recording (30–90 min) with speaker ID, timestamps, auto-generated
summary + action items. Requires audio chunking, diarization, summary LLM call,
and a distinct "meeting" UI with timeline view.
**Complexity:** Hard

### App Integrations (Direct Send)
Send transcriptions directly to Notion, Obsidian, Google Docs, Slack.
Per-integration: API client, OAuth2 auth flow, settings UI.
Start with one high-value target (Notion or Obsidian).
**Complexity:** Medium–Hard per integration

### Context-Aware Transcription
Smart detection of user context so output adapts automatically. Three sub-phases:

1. **Active Window Detection** — process name + window title pattern matching
   (Gmail → email context, VS Code → code context). Feed into post-processing prompts.
2. **Browser URL Detection** — lightweight extension reports current URL for
   finer context within web apps.
3. **UI Automation Integration** — Windows `IUIAutomation` to inspect focused
   control type and surrounding labels.
