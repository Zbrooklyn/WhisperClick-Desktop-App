# WhisperClick — Master Plan

> From a proven web build to a complete native desktop app at true feature parity — pill widget and all.

Status: Active — Web proven, Electron parity next
Version: v1.0
Goal: Every feature proven on the web build works natively in the Electron desktop app — including the floating pill widget and background lifecycle — each verified in the real launched app, not just "the handler exists."
Constraint: Web and Electron SHARE one frontend (`shared/frontend/`). Parity is a bridge-completeness + native-wiring problem, never a UI rewrite. Implement platform-agnostic logic ONCE in a shared module; never reimplement what can be shared.

## Overview — how this plan works

WhisperClick has one UI (`shared/frontend/`) loaded by two backends. Every feature calls the backend through a single function, `callNativeApi('command', …)`, which dispatches to `window.pywebview.api[command]`. That `api` object is defined by a **bridge**: on web it is `platforms/web/web-shim.js` (routes to `server.js` over HTTP); on desktop it is `platforms/electron/preload.js` (routes to `main.js` over IPC).

So "make every web feature work in Electron" has a precise, mechanical definition: **every method the web bridge exposes must also exist in the Electron bridge, backed by real native behavior.** The UI is already shared, so screens and design come across for free — the work is backend wiring.

The ground-truth diff today: the UI fires **57 commands**; the web bridge implements all of them; the Electron bridge implements 37 and is **missing 20**. Those 20 (listed at the bottom) are the desktop parity gap. Nothing is guessed — this list is read straight from the two bridge files, and "parity reached" = that list hits zero.

Two structural facts shape the sequence:
1. The AI/LLM logic (summarize, diarize, chat, actions, URL import, integrations) lives **inline in `server.js`**, not in a shared module. Extracting it once (Phase 1) lets both backends share it instead of reimplementing ~8 features twice.
2. Recording differs by nature: the web records **in-browser** (MediaRecorder/getUserMedia/getDisplayMedia); Electron records via its **native sidecar**. So pause/resume, redo, system-audio, and file-upload aren't "add a handler" — they need the native equivalent.

## Phase 0 — Web / PWA proving ground  (DONE)

Objective: Build and verify every feature on the web/PWA build as the proving ground before touching desktop.
Gate: Every feature demonstrably works through the real UI. — MET.

- [x] All core + premium features built on web/PWA (proof: task board #48–#88 complete)
- [x] AI features live-verified on Edward's real key — summarize, action/rewrite-email, chat, speaker diarization (proof: live run 2026-07-17, real output rendered in the Review panel)
- [x] Free/paid tier gate — Ed25519 license + stub keys + server-side enforcement (proof: free→`tier_locked`, complete→pass, both verified)
- [x] LiveSync PWA QR — scan opens the same backend on the phone (proof: rendered QR byte-matches a fresh encode of the phone URL)
- [x] Phone microphone over HTTPS via Tailscale serve (proof: `getUserMedia` works on device)
- [x] API key masked in Settings — dots + last-4, real key stays in JS memory (proof: field reads `••••••••••••6zEA`, commit `199a6be`)

## Phase 1 — Shared logic extraction  (keystone — do first)

Objective (REVISED after ground-truth 2026-07-17): the big assumption here was wrong in our favor. The LLM enrichment (summarize/chat/run_action) is ALREADY shared — it runs inside the Python engine (`shared/engine/engine.py`) that BOTH backends spawn — so no JS extraction was needed; Batch A just exposed it through the Electron bridge. Only diarize + integrations are direct-JS, and they're small enough to inline. So this phase largely collapsed.
Gate: web build untouched this pass.

- [x] LLM enrichment (summarize/chat/run_action) — already shared via the Python engine; no extraction needed (finding 2026-07-17) @claude
- [x] diarize + send_integration — direct HTTP, small enough to inline in Electron `main.js` (parity with `server.js`), not worth a shared module @claude
- [ ] URL import/preview + retranscribe — these DO use yt-dlp + `engine.transcribeFile`; share or inline when wiring Batch B @claude

## Phase 2 — Electron bridge parity  (the 20 missing methods)

Objective: Every UI command resolves in Electron. Add the 20 methods absent from `preload.js`, each routed to native code or the Phase-1 shared modules.
Gate: All 20 present AND each feature exercised successfully in the LAUNCHED Electron app (not "the handler exists").

- [x] Batch A — AI/enrichment wired in the Electron bridge (preload.js + main.js): summarize · chat_note · run_action (route to the same Python engine the web build uses — already keyed by configureSidecar) · diarize · send_integration (direct HTTP, mirrored from server.js) (proof: commit `98ab948`) @claude
- [x] Batch A verify — LIVE in the launched Electron app (isolated user-data-dir, key seeded from .env): summarize → real summary + action items, chat_note → correct grounded answer, run_action → real professional email (proof: verify run 2026-07-17) @claude
- [x] `.env` key-seeder added — desktop app now usable with the same key as web; merges (never wipes) settings (proof: KEY STATE openai_present true in Electron) @claude
- [ ] retranscribe — deferred to Batch B (needs the engine-reconfigure + transcribe path) @claude
- [x] BLOCKER FOUND + FIXED — the shared UI resolved the tier via `/api/license` (HTTP, web-only), so on desktop WC_TIER fell back to "free" and `wcRequirePro()` silently locked EVERY paid entry. Now routed through the bridge (`get_license` in both shims + main handler) and the desktop license module carries the SAME Ed25519 public key + stub allowlist, so one license works on both platforms (proof: commit `3f35e79`; WC_TIER free→complete in the launched app; web regression-checked) @claude
- [x] Batch B — upload_file: native file → engine `transcribe_file`, path via webUtils (proof: real file-input upload → history:1 with full real transcript, Pro badge rendered) @claude
- [x] Batch B — retranscribe: update entry in place via engine, `_transcriptionClaim` guard prevents duplicate (proof: commit `82dbda1`, entries stay 1) @claude
- [x] Batch B — import_url + url_preview via SHARED `shared/media/url-import.js` (web repointed at it too, regression-checked) (proof: commit `754b613`; url_preview→real YT title, import_url→history 0→1) @claude
- [x] Batch B — start/stop_system_capture: getDisplayMedia loopback (main grants {screen, audio:'loopback'}, no picker) → bytes → engine (proof: commit `a27a5c2`; probe audioTracks:1, full pipe → history entry). Real-audio transcript quality = human check @claude
- [x] **Batch B COMPLETE** — all media-in methods have Electron parity @claude
- [x] Batch C — Recording control: pause_recording · resume_recording · is_recording_paused · redo_start · redo_stop · set_audio_prefs · get_audio_prefs. Native pause = flag-gated buffering in `audio_recorder.py` (stream stays open, frames dropped while paused) + engine `pause_rec`/`resume_rec`/`is_paused`; redo reuses the record→transcribe path with the claim guard (returns text, no history); audio prefs persist in `store.js` settings. (proof: recorder pause/resume frame-gating unit-verified against the real class — frames dropped while paused, restored on resume; launched-Electron round-trip — audio prefs default→set→persist E2E, all 7 methods present on bridge, redo idle-guard honest. Live-mic pause E2E gated on an audio device — headless launch reports device -1) @claude
- [x] Batch D — History parity: get_history_page (paginated + search) · update_history_text (edit + enrichment persistence). `store.js` gains `page({limit,offset,query})` + `count(query)` (newest-first, case-insensitive search over text/title/summary); main.js wires both IPC handlers with the same enrichment whitelist as server.js; also fixed a real parity gap — the frontend's `persistEnrichment` used a raw `fetch('/api/history/update')` (web-only, silently dead on Electron), now routed through `update_history_text` on both bridges (web-shim forwards the enrichment extra). (proof: store unit test PASS — 25 entries paginate 10/10/5 newest-first, "apple pie" search 5/5 case-insensitive, edit+summary+action_items+title persist across a fresh Store reload; launched-Electron round-trip — both methods present, page shape {items,total,offset,limit} correct, update honest not-found + empty-patch no-op) @claude
- [x] Batch E — send_integration has Electron parity (main-process `send_integration` IPC → direct fetch; tokens never touch the renderer). Landed with Batch A. @claude
- [x] Zero-gap check — `web-shim.js` vs `preload.js` command diff returns EMPTY (proof: parity script — 68 web-shim methods, all present in preload's 69; "MISSING from preload: (none — parity reached)") @claude

## Phase 3 — SQLite store port  (#79 — underpins Phase 2D)

Objective: Electron (and later Tauri) use the same history-store schema as web — the `extra` JSON column, pagination, and enrichment fields.
Gate: Behavioral parity with the web store + 3k-scale verified in Electron.

- [ ] Port the `history-store.js` contract onto Electron `store.js` @claude
- [ ] Enrichment persistence parity — summary / action_items / speakers / title survive round-trip @claude
- [ ] Scale check ≥ 3,000 entries in Electron (proof: query timing) @claude

## Phase 4 — Native shell: the pill + lifecycle  (the part we skipped)

Objective: Closing the main window must NOT kill the app — the pill becomes the live surface, the tray keeps the process alive, and the global hotkey + paste-injection work with no window open.
Gate: Close window → pill active → record via pill → text pastes into another app — verified end to end in the real app.

- [x] Pill handoff states — idle → recording → processing → result render via `sendPillRender` (main is the single source of truth; the pill has no state of its own). Shows when the window is hidden/minimized/closed, hides on show/restore. @claude
- [x] On main-window close, PROMOTE the pill — the specific bug. `showPill` defaults OFF, so closing (closeBehavior 'tray') used to hide the window to a bare tray icon with NO live surface. Added a `pillPromoted` flag: close sets it true and `pillShouldShow()` now returns `showPill || pillPromoted`, so the pill appears on close even with the setting off; show/restore clears it (pill demotes). Settings-save reconcile also honors `pillShouldShow()` so a save can't tear down the live pill. (proof: launched-Electron test — before close ONLY the main window exists (no ambient pill → setting is off); after close the 220×140 pill.html window is VISIBLE and the main window is HIDDEN; after restore main is visible and the pill is destroyed. VERDICT PASS + screenshot phase4-pill-promoted.png sent to Edward) @claude
- [x] Tray menu (Open · Record · Quit) + tray-click action parity with the settings toggle — `createTray` with rich menu + quit; tray click honors `trayClickAction` ('show'/'record'); onShow restores + focuses the window (demotes pill). Pre-existing, confirmed. @claude
- [x] Global hotkey records with the window hidden — `registerHotkey` → `globalShortcut.register` → `toggleRecording` is window-independent; state broadcasts to the pill via `sendPillRender`. Pre-existing, confirmed. @claude
- [x] Paste-injection into the previously-focused app — `capture_fg` grabs the foreground window before recording (pill is non-focusable), `sidecar.send('paste')` restores focus + Ctrl+V on transcription when `autoPaste` is on. Pre-existing, confirmed wired (live paste needs an interactive session — see below). @claude
- [x] Launch at login — `app.setLoginItemSettings({openAtLogin: settings.autoStart})` wired to the autoStart setting. (start-hidden-to-tray on Windows is a minor follow-up: needs a `--hidden` launch arg, openAsHidden is macOS-only.) @claude
- [ ] Full closed-window → pill → record → paste E2E — GATED on an interactive session with a real mic + a real paste target (the headless launch has no audio device: `device -1`). Promotion half is verified above; the record→transcribe→paste half needs Edward's machine, not the harness. @claude

## Phase 5 — Native-only extras & first-run

Objective: The desktop things the web can't have — updater, OS permissions, and local offline transcription.
Gate: A fresh install grants permissions on first run and the updater round-trips.

- [x] Updater IPC end-to-end — check · download · install · channel all wired and responding. Fixed two real defects: (1) the updater IPC handlers were registered at the END of `initUpdater`, AFTER autoUpdater config that throws in an unpackaged build (no `app-update.yml`), so every handler was missing → guarded the config/event setup in try/catch and the channel-apply so handlers always register; (2) `initUpdater` ran in a deferred 500ms timer, so the frontend's startup `get_update_channel` query raced ahead and logged "No handler registered" → moved IPC registration synchronous into whenReady (network check stays deferred). (proof: launched-Electron — all 5 methods present, channel get→set(beta)→set(stable) round-trips and persists to store, check_for_updates returns gracefully (null, no crash) in dev; main-process log confirms the startup no-handler error is GONE). Download/install E2E needs a signed+published release (Phase 6/7, Edward-owned). @claude
- [x] First-run permission flow — autostart wired (`setLoginItemSettings({openAtLogin})`); on Windows mic access is OS-level at capture time and paste uses SendInput (no accessibility-grant API — that's a macOS/TCC concern, N/A on the Windows target). Cross-platform TCC prompts deferred to if/when a macOS build ships. @claude
- [ ] Local offline model via the sidecar as the desktop free tier — engine supports local Whisper (list_models/download_model/set_model); wiring a bundled default-model first-run is a feature, gated on model-asset packaging. @claude
- [ ] Verify on a clean machine/profile (proof: cold first-run walkthrough) — gated on a signed/packaged installer (Phase 7). @claude

## Phase 6 — Monetization & distribution  (Edward-owned decisions)

Objective: Turn the finished app into something sellable — pricing, license purchase, signed installers.
Gate: Edward's business decisions made + signed installers per OS.

- [ ] Decide monetization provider — Lemon Squeezy · LS/Stripe+Keygen · self-hosted (blocked: Edward decision) @edward
- [ ] Decide pricing model + price point — one-time / perpetual+updates / subscription (blocked: Edward decision) @edward
- [ ] Windows EV code signing — SmartScreen blocks unsigned installs, ~$200+/yr (blocked: Edward) @edward
- [ ] macOS signing + notarization — Gatekeeper, ~$99/yr (blocked: Edward) @edward
- [ ] Wire real checkout → Ed25519 license issuance, once the provider is chosen @claude

## Phase 7 — Ship

Objective: Cross-platform, install-clean, human-usable.
Gate: A real user completes the core dictation flow + one premium flow on a SIGNED install on each target OS.

- [ ] Build + install-clean on Windows and macOS (x64 + arm64) @claude
- [ ] Human-usable bar per OS — cold walkthrough, no dead controls (proof: walkthrough capture) @claude
- [ ] Release notes + version bump @claude

## Decisions

- Desktop engine — Electron vs Tauri (default: Electron — the complete lifecycle/pill/tray/updater scaffold already lives there; Tauri is a later port that reuses the same command surface)
- Close-window behavior — hide-to-tray vs actually quit (pending: Edward — recommend hide-to-tray, with a one-time "still running in the tray" hint)
- Pill visibility policy — always visible / only when the window is closed / only during-and-after recording / user toggle (pending: Edward — recommend "when window closed" + "during recording")
- Desktop free tier — is local offline transcription the free tier and cloud/API the paid tier? (pending: Edward)
- Monetization provider + price point (pending: Edward — research table retained in `ROADMAP.md`)

## Risks

- Native system-audio capture (WASAPI loopback) is the hardest parity item (high) — containment: fall back to "record the default output device" if loopback is flaky; ship the rest of Batch B without blocking on it
- Code-signing cost and lead time gate distribution (high) — containment: start EV cert procurement early; ship an unsigned beta behind a documented "SmartScreen → More info → Run anyway" note
- Parity drift — if the web build keeps changing, Electron falls behind (medium) — containment: the Phase-1 shared modules + the `web-shim.js` vs `preload.js` command diff as a repeatable zero-gap check
- Sidecar packaging bloats the installer / trips AV false-positives (medium) — containment: keep the sidecar lean and sign it

## Verification standard

Every parity item is "done" only when exercised in the LAUNCHED Electron app through the real UI — never "the IPC handler exists." Any change touching rendered output ships a screenshot (rule 21). The command-surface diff (`web-shim.js` vs `preload.js`) must reach zero missing methods before Phase 2 is complete.

## The parity gap — 20 methods missing from the Electron bridge (reference checklist)

Read directly from `web-shim.js` (has them) vs `preload.js` (missing them):

- AI / enrichment: summarize · diarize · chat_note · run_action · retranscribe
- Media in: upload_file · import_url · url_preview · start_system_capture · stop_system_capture
- Recording control: pause_recording · resume_recording · is_recording_paused · redo_start · redo_stop · set_audio_prefs · get_audio_prefs
- History: get_history_page · update_history_text
- Integrations: send_integration

## Supersedes

This plan supersedes the pre-web `ROADMAP.md` (2026-04-12) as the forward plan; that file is retained for its monetization research and history. Many features it lists as "Premium — to build" are DONE on web (Phase 0) and now need Electron parity (Phases 1–2), which is why the forward plan reads as parity, not net-new feature work.
