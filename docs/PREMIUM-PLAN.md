# WhisperClick Premium — Market-Ready Plan

> Consolidated plan for the paid version. Resurfaces + unifies the scattered pieces:
> ROADMAP.md (Premium P0–P4 feature backlog), PROJECT_WRITEUP.md (pricing estimate),
> and the Phase-P0 monetization research. Supersedes those as the single source of
> truth for Premium. Last updated: 2026-07-06.
>
> **Legend:** ✅ DECIDED (Edward) · 🔷 PROPOSED (my recommendation, awaiting confirm) · ❓ OPEN (needs Edward)

---

## 1. Positioning — free vs. paid

WhisperClick Free is **open source and stays fully capable.** Premium is **net-new power features layered on top** — we never remove or cripple something that is free today. (Taking away existing free capability from an OSS tool invites backlash and is off the table.)

- **Free (OSS):** push-to-talk dictation, OpenAI/Gemini API **or** local Whisper models, history, pill widget, tray, hotkeys, auto-paste, translate. Everything shipping today.
- **Premium (Pro):** the productivity multipliers below — vocabulary, output transformation, file transcription, power-user flow. Aimed at people who dictate *a lot*.

**Two axes to keep separate:** (A) *how transcription is powered* — the user's **own** API key / local model (zero cost to us) vs. **managed API included** (we pay per minute); and (B) *which power features* are unlocked. A user picks a tier that combines both.

**Margin note:** BYO-key and local tiers add **zero cost-of-goods** — the features run on the user's own key. The **API-included** tier and any feature where *we* call a service (meeting summaries) carry real per-minute cost, covered by a higher price + a usage allowance + metering (§4).

---

## 2. Pricing & tiers

- ✅ **Model:** subscription.
- ✅ **Entry price:** from **$4.99/mo.**
- 🔷 **Tier structure:**

| Tier | Price | Powered by | Who | What they get |
|---|---|---|---|---|
| **Free** | $0 (OSS) | User's own key / local | Casual / technical | Everything shipping today |
| **Pro (BYO key)** | **$4.99/mo** or 🔷 **$49/yr** | User's own key | Power users with a key | All Pro features (§3, P1–P3), zero COGS |
| 🔷 **Complete (API included)** | 🔷 ~**$12/mo** (incl. ~X hrs/mo) | **Our managed API** | Mainstream — no setup | Pro features **+ transcription built in** — no API key, it just works |
| 🔷 **Studio** (future) | 🔷 ~$15–20/mo | Managed | Meetings / teams | Complete + meeting mode, integrations, our-side-cost features (§3, P4) |

**"Complete" is likely the headline tier** — most non-technical users will never get an OpenAI key, so "download → subscribe → talk" is the mass-market path. Pro (BYO key) is the cheaper option for people who already have a key. Local Whisper models stay free for the privacy/offline crowd.

- 🔷 **Annual option** at launch (~2 months free) — annual subs cut churn and improve cash flow; standard for indie SaaS.
- 🔷 **Free trial:** 7-day Pro trial, no card, so the value is felt before the paywall.
- ❓ **Founder/lifetime early-bird?** Some indie tools offer a limited lifetime deal at launch for cash + early advocates. Optional — your call.

Competitive context (from research): Wispr Flow $12/mo, Superwhisper $8.49/mo, Otter $8.33/mo. **$4.99 is deliberately aggressive** — accessible, undercuts the field, fits an OSS-base tool.

---

## 3. Feature plan (tiered from ROADMAP P1–P4)

### Pro — Launch tier (easy wins, the paid MVP)
Ship enough to justify $4.99 on day one. Prioritized by value-per-effort:

1. **Custom post-processing prompts** 🔷 *flagship* — "fix grammar," "make this a professional email," "bullet points," "summarize." Runs on the user's key. This is the single most compelling reason to pay. *(ROADMAP P2, Medium)*
2. **Custom vocabulary / proper nouns** — teach it names, brands, jargon it misspells. *(P1, Easy–Med)*
3. **Snippet templates** — saved wrappers (email headers, meeting-note formats). *(P1, Easy)*
4. **Language auto-detect badge** — backend already returns it; frontend-only. *(P1, Easy — near-free win)*
5. **Speaker diarization display** — "Speaker 1/2" labels via `gpt-4o-transcribe-diarize`. *(P1, Easy)*
6. **Recording-sound customization** — pick/disable start-stop sounds. *(P1, Easy)*

### Pro — Core differentiators (fast-follow)
7. **Drag-and-drop file transcription** — drop an mp3/wav/m4a to transcribe without recording. *(P2, Med)*
8. **Clipboard history ring** — hotkey picker of last 5–10 transcriptions. *(P2, Easy–Med)*
9. **Voice commands** — "new line," "period," "delete that" as actions, not text. *(P2, Med)*
10. **Smart punctuation** from pause length. *(P2, Med)*

### Pro — Advanced (depth)
11. Live streaming transcription (partial text while speaking). *(P3, Med–Hard)*
12. Word-level timestamps + click-to-play. *(P3, Med)*
13. Confidence highlighting. *(P3, Med)*
14. Voice corrections ("replace X with Y"). *(P3, Hard)*
15. Continuous listening / VAD always-on. *(P3, Hard)*

### Studio — Platform tier (future; has our-side cost)
16. **Meeting mode** — long-form + speaker ID + auto-summary/action items *(our LLM call = COGS → Studio)*. *(P4, Hard)*
17. **App integrations** — direct send to Notion/Obsidian/Docs/Slack. *(P4, Med–Hard each)*
18. **Context-aware transcription** — active-window / URL detection adapts output. *(P4, Hard)*

---

## 4. Monetization infrastructure (Phase P0 — the plumbing)

Subscriptions need recurring validation, so this is more than a one-time key check.

- 🔷 **Provider: Lemon Squeezy** — Merchant-of-Record (handles global tax/VAT), native subscription support, ~5% + $0.50/txn, simple REST for Electron. Fastest path to charging. *(alt: Stripe + Keygen for offline-first, more infra — not worth it for launch.)*
- **License validation:** hybrid — online refresh on launch (subscription active?), **offline grace period** (30–90 day TTL) so a brief network blip doesn't lock a paying user out.
- **Premium module loader** — main-process loader that conditionally enables `premium/` modules only when licensed. *(Provider-independent — buildable now.)*
- **Free-tier gating** — today there is **none** (free and paid code aren't separated at runtime). Needs a clean, honest gate: Pro features visibly present but locked with a clear "Upgrade" affordance — never dead buttons, never fake.
- **Activation UI** — enter license / sign-in, show subscription status, manage/cancel link.
- **Separate premium build pipeline** — private CI builds the Pro binary; public CI keeps shipping the stripped free build. (Split scaffolding already exists: `premium/` dirs + `sync_public.sh` exclusion.)

### Managed-API backend (required for the "Complete" tier)

The API-included tier needs infrastructure the BYO-key tiers don't:

- **Transcription proxy** — a small backend (🔷 Cloudflare Worker — fits your existing stack) that holds **our** OpenAI/Gemini key server-side and proxies transcription for subscribed users. **The app never contains our key** (it would be extracted instantly). The client sends audio + its license token; the proxy verifies the sub, transcribes, returns text.
- **Usage metering + caps** — count minutes per user, enforce the tier's monthly allowance, degrade or offer overage past the cap. This is what protects the margin.
- **COGS math (approx):** OpenAI transcription ≈ $0.36/hr (Gemini cheaper). At ~$12/mo including, say, 15 hrs, worst-case COGS ≈ $5.40 → healthy margin; most users use far less. ❓ The included-hours number is a key lever (§7).
- **Abuse/rate limiting** — per-user rate caps so one account can't run our bill up.

This backend is the one genuinely new build surface Premium adds beyond the desktop app. It's small, but it's real, and it gates the Complete tier (not Pro-BYO).

---

## 5. Build roadmap (what ships when)

- **Phase A — Plumbing (P0):** module loader + license validation + gating + activation UI + premium build pipeline. *Provider-independent parts start immediately; Lemon Squeezy wiring lands last.*
- **Phase B — Paid MVP:** the 6 launch-tier features (§3). Enough to charge $4.99.
- **Phase C — Beta + price-in:** invite free users to a Pro trial; validate willingness to pay; fix friction.
- **Phase D — Launch Pro** on whisperclick.com.
- **Phase E — Fast-follow + Studio tier:** core differentiators, then the meeting/integration platform tier.

---

## 6. What "market-ready" means for Premium

Distinct from the free app's bar. Pro is market-ready when:
1. **Billing works end-to-end** — subscribe → pay → license issued → features unlock → renews → cancel/refund all work, with real money, on the real provider.
2. **The value is obvious** — a heavy dictator sees why Pro is worth $4.99 in the first session (the post-processing/vocabulary features carry this).
3. **Gating is honest** — locked features are clearly marked and upgradeable; no dead controls, no fake unlocks, no removed free capability.
4. **Resilient licensing** — a paying user is never wrongly locked out (offline grace); a lapsed user degrades gracefully to free, keeping their data.
5. **Features are solid** — each shipped Pro feature meets the same reliability/finish bar as the free app.
6. **(Complete tier) Managed API is safe + honest** — our key never ships in the client, usage metering is accurate, the monthly allowance and overage behavior are clear to the user, and a network/backend blip fails gracefully (offer local/BYO fallback rather than a hard stop).

---

## 7. Open decisions for Edward

**Pricing / tiers:**
- ❓ **Complete (API-included) price** — confirm ~$12/mo, and the **included hours/month** (the key margin lever — e.g. 10 / 15 / 20 hrs).
- ❓ **Does Complete launch with Pro, or after?** (It needs the backend proxy built, so it's more work — but it's the mainstream tier, so it may be worth launching first/together.)
- ❓ **Annual prices** — Pro $49/yr? Complete $120/yr?
- ❓ **Pro-only vs. Pro + Complete at launch** — Studio stays future either way.

**Mechanics:**
- ❓ **Confirm Lemon Squeezy** (payments/subs) + 🔷 **Cloudflare Worker** for the managed-API backend.
- ❓ **Which provider powers Complete** behind the scenes — OpenAI, Gemini (cheaper), or route by cost.
- ❓ **Free trial** (7-day, no card) — yes/no.
- ❓ **Lifetime early-bird** at launch — yes/no.

---

## Execution tracker

> Live build checklist — the progress bars above track these items. Decisions gate the build: lock D0 first.
>
> **Web-build status (updated 2026-07-15, branch `feature/premium-suite`):** the Pro *features* are
> implemented in the web app (`platforms/web` + `shared/frontend`). Done and verified: custom
> post-processing prompts, custom vocabulary, snippet templates, language auto-detect badge, recording-sound
> customization, drag-and-drop file transcription, clipboard history ring, voice commands, smart punctuation,
> live streaming, word-level timestamps + click-to-play, confidence highlighting, voice corrections,
> continuous listening (VAD), writing-context presets, and app integrations (Markdown/.txt/Obsidian/webhook —
> no-auth). Gated on an **OpenAI key** (built, verify with key): meeting summary + action items, speaker
> diarization (gpt-4o-transcribe-diarize), and context-adapted AI cleanup. Native-only (not web): true
> active-window context awareness. **Still unbuilt: the monetization plumbing** — P0 (module loader, license
> validation, gating, activation UI, billing) and P2 (managed-API proxy). The features run free/ungated today.
>
> **Settings surfacing — DONE + verified (2026-07-15):** the Pro features are now reachable through **one
> unified Settings** opened from the gear — a single grouped, multi-page menu holding **free + premium in one
> place** (no accordions). iOS-style grouped lists under section headers; on/off settings are toggles, choice
> settings are "menu rows" (value + chevron → picker sheet); the 5 premium blocks (Speech / Capture /
> Formatting / AI cleanup / Integrations) are surfaced directly in the menu alongside the free sections; the
> legacy free sections got the same carded polish; and controls with their own rich picker (visualizer style)
> keep it. The live-wired controls are *adopted* (moved, not rebuilt) so nothing breaks. Quick settings is
> clustered into Appearance / Dictation output / Sound / System / Shortcut.
>
> **UI-integration principle (Edward, 2026-07-15) — how paid features get "stuffed in":** do **not**
> preemptively redesign clean, working UI to make room for Pro. **Settings is the consolidated home** for
> premium config/toggles (built). Working surfaces like the **main history header stay AS-IS** — a surface
> gets redesigned only **when accumulated premium entry points actually crowd it**, informed by what's really
> there, not speculatively. Each premium feature's entry point is placed deliberately as it's wired in. When
> the history header *does* eventually crowd, the proposed move is a "＋ New" action sheet + full-width search
> (parked, not built — revisit on real crowding). This keeps the free UX clean and defers layout churn until
> it's earned.

### D0 — Decisions to lock (Edward)
- [ ] Complete tier price + included hours (~$12/mo, ~15 hrs)
- [ ] Complete launches with Pro, or after
- [ ] Annual prices (Pro ~$49/yr, Complete ~$120/yr)
- [ ] Pro-only vs. Pro + Complete at launch
- [ ] Confirm Lemon Squeezy (payments) + Cloudflare Worker (backend)
- [ ] Which provider powers Complete (OpenAI / Gemini / route by cost)
- [ ] Free trial (7-day, no card) — yes/no
- [ ] Lifetime early-bird — yes/no

### P0 — Monetization plumbing
- [ ] Premium module loader (provider-independent)
- [ ] License validation (online refresh + offline grace)
- [ ] Free-tier gating (honest locks, no dead buttons)
- [ ] Activation UI (sign-in / license / status / cancel)
- [ ] Separate premium build pipeline (private CI)
- [ ] Lemon Squeezy payment + subscription wiring

### P0b — Premium UI surfacing & integration
- [x] Unified Settings from the gear (free + premium, one place) — grouped multi-page menu
- [x] iOS-style grouped lists: toggles for on/off, menu-row + picker sheet for choices
- [x] Premium blocks surfaced directly in the menu; legacy sections given matching polish
- [x] Preserve controls with their own rich picker (visualizer style) + fix z-index over Settings
- [ ] Honest gate on premium rows (locked + "Upgrade" affordance) — lands with P0 gating
- [ ] Deliberate entry-point placement as each new premium feature is wired in (ongoing rule)
- [ ] (PARKED) History-header redesign — "＋ New" action sheet + full-width search; only when it actually crowds

### P1 — Launch MVP features
- [ ] Custom post-processing prompts (flagship)
- [ ] Custom vocabulary / proper nouns
- [ ] Snippet templates
- [ ] Language auto-detect badge (backend done)
- [ ] Speaker diarization display
- [ ] Recording-sound customization

### P2 — Managed-API backend (Complete tier)
- [ ] Transcription proxy (Cloudflare Worker, key server-side)
- [ ] Usage metering + monthly allowance caps
- [ ] Abuse / rate limiting
- [ ] Provider wiring (OpenAI / Gemini)

### P3 — Core differentiators (fast-follow)
- [ ] Drag-and-drop file transcription
- [ ] Clipboard history ring
- [ ] Voice commands
- [ ] Smart punctuation

### P4 — Advanced + Studio (future)
- [ ] Live streaming transcription
- [ ] Word-level timestamps + click-to-play
- [ ] Confidence highlighting
- [ ] Voice corrections
- [ ] Continuous listening / VAD
- [ ] Meeting mode (Studio)
- [ ] App integrations (Studio)
- [ ] Context-aware transcription (Studio)

### L0 — Launch
- [ ] Beta trial to free users (price-in)
- [ ] Launch Pro on whisperclick.com
- [ ] Launch Complete (headline tier)
