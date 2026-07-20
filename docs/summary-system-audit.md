# WhisperClick Summary System — Ground-Truth Audit

**Date:** 2026-07-19 · **Scope:** every summary capability in WhisperClick · **Mode:** investigation + documentation only (no code changed)
**Test corpus:** live generations run against the isolated test server (`:8793`, real OpenAI key) on the imported transcript *"So You Want to Be an AI Consultant? Start With These 10 Questions"* (Ashley Gross, 18:14, 18,680 chars).

> This audit inspects the actual implementation (Python engine prompts, Node endpoints, frontend presets) and real generated outputs. It does not defend the current system. Weak outputs are shown as-is.

---

## 1. Executive assessment

WhisperClick's "summary system" is **one shallow LLM call wearing several costumes.** There is a single base prompt — *"You are a meeting assistant."* — applied to every content type, every length, and every "template." The visible variety (Brief/Bullets/Detailed × Auto/Meeting/Idea/Call, plus Action-menu presets) resolves on the backend to **minor framing changes on the same prompt**, run on **gpt-4o-mini** with **no chunking, no transcript cleanup, no content-type detection, and no evidence/grounding**.

The three highest-severity truths this audit establishes:

1. **Everything is a "meeting."** The base persona forces meeting-shaped thinking (decisions, action items, owners) onto content that has none. On this educational video the system invented a *Decisions* section, fabricated *action items with owners* ("Ashley to provide more resources on rates"), and treated the closing **"subscribe to my newsletter"** promo as a user to-do. This is a classification failure, not a wording nitpick.
2. **A silent 12,000-character cliff.** Decisions, Key Quotes, Follow-ups and every Action-menu preset truncate the transcript to 12k chars. This 18.6k-char video loses its **last ~35% (questions 8–10: rates, differentiation, staying relevant)** with zero indication to the user. The Chapters preset produced **7 chapters for a 10-question video** purely because it never saw the end.
3. **No factual grounding at all.** No summary claim is linked to transcript text, timestamp, speaker, or confidence. The one place that tries — Key Quotes, which are supposed to be copied *verbatim* for audio mapping — is broken: the model "corrected" the transcript's pervasive mis-hear **"RY" → "ROI"** (36 vs 3 occurrences in the raw transcript), so the quote *"Prove the ROI."* **cannot be found** in the word list and the timestamp link silently fails.

The summaries *look* polished. On this content they are **generically accurate but low-value, mis-structured, and partly fabricated.** The system flattens a clearly structured 10-question presentation into the same six bullets it would produce for anything.

Overall grade of the current system for non-meeting content: **4/10** — usable gist, wrong shape, unverifiable, silently lossy.

---

## 2. Current template inventory

There are **two parallel, inconsistent generation paths**. "Templates" in WhisperClick are not real templates — they are (a) parameter combinations on the `summarize` prompt, and (b) one-line instruction strings fed to a generic `run_action` prompt.

### Path A — the Review "Summary" (`summarize` endpoint)

One prompt builder, parameterized by **Length** (`style`) × **Type** (`note_type`). 3 × 4 = **12 combinations**, all the same underlying prompt.

| Param | Values | Where defined | Effect (verified) |
|---|---|---|---|
| `style` (Length) | `brief`, `bullets`, `detailed` | `index.html:6187` `SUMMARY_STYLES` | **Real length change** — brief ~250 chars, bullets ~850, detailed ~1250 |
| `note_type` (Type) | `auto`, `meeting`, `idea`, `call` | `index.html:6188` `SUMMARY_TYPES` | **Framing only** — prepends one sentence; does not restructure output |

- **IDs / location:** prompt built in `shared/engine/engine.py:684-719` (`_summary_system` + `_summarize_meeting`); type framing map `engine.py:674-681`; endpoint `platforms/web/server.js:433-448`.
- **User-facing:** the "Showing **Bullets** · **Auto** ✎" inline card at the top of the Review pane (`renderSummaryStyleBar`, `index.html:6248-6298`).
- **Selection:** **manual only.** `_summaryType` defaults to `auto` and is **never auto-detected**. Persisted to `localStorage` `wc_sum_style` / `wc_sum_type`.
- **Output sections:** a summary blob **+** an `Action Items:` list (split by `parse_meeting_summary`, `engine.py:641-668`).
- **Tier:** Pro (whole Review tab is `wc-pro-only`, `index.html:651`).
- **Customizable:** no.

### Path B — Action-menu presets (`run_action` endpoint)

`ACTION_PRESETS`, `index.html:7650-7661`. Each is a label + a one-line instruction string inserted verbatim into a generic transform prompt (`engine.py:1643-1651`). **10 presets:**

| # | Label | key/prompt | Group | Type | Notes |
|---|---|---|---|---|---|
| 0 | Summarize | `_summary` (routes to Path A) | Summarize & analyze | summary | Same as Review Summary |
| 1 | Bullet points | `Rewrite this as a tight bulleted list of the key points. No preamble.` | Summarize & analyze | summary | Richer/nested output than Path A |
| 2 | Action items | `Extract a checklist of concrete action items and to-dos as Markdown checkboxes...` | Summarize & analyze | tasks | |
| 3 | Key takeaways | `List the 3–5 most important takeaways as short bullets.` | Summarize & analyze | summary | |
| 4 | Chapters | `Split this into logical chapters. For each chapter give a bold short title...` | Summarize & analyze | structure | |
| 5 | Rewrite: formal | `Rewrite this in a polished, professional tone...` | Rewrite | rewrite | not a summary |
| 6 | Rewrite: casual | `Rewrite this in a warm, natural, conversational tone...` | Rewrite | rewrite | not a summary |
| 7 | Match my style | `_style` → `runStyleAction()` | Rewrite | rewrite | samples past notes |
| 8 | Email draft | `Turn this into a clear, ready-to-send email...` | Rewrite | rewrite | not a summary |
| 9 | Translate → English | `Translate this into natural, fluent English...` | Rewrite | rewrite | not a summary |

- **Output target:** `run_action` results render into the ad-hoc `#detail-summary` panel, **not** the structured Review sections. Returns free-form `{result}` text.
- **Selection:** manual (Actions menu), except a heuristic "Suggested" row (see §5/§6).
- **Tier:** Pro. **Customizable:** yes — user "custom actions" (`wc_custom_actions`, name ≤40 chars + prompt ≤500 chars or ≤8 steps), run via `run_action`.

### Auxiliary extractors (feed Review sections, not user-selectable "templates")

| Op | Endpoint | Prompt loc | Output | Truncation |
|---|---|---|---|---|
| Decisions + owner/due actions | `/api/review-details` | `engine.py:1470-1480` | `{decisions[], actions[]}` JSON-by-prompt | **`[:12000]`** |
| Key quotes | `/api/key-quotes` | `engine.py:1596-1603` | ≤4 verbatim quotes | **`[:12000]`** |
| Follow-ups ("Ask next") | `/api/followups` | `engine.py:1421-1427` | exactly 3 questions | **`[:12000]`** |
| Speaker summaries | `/api/speaker-summaries` | `engine.py` | per-speaker line | — |

**No distinct template is a real, independent template. Every one is a thin variation on two prompts.**

---

## 3. Current summary pipeline

Media → summary, stage by stage. **D = deterministic, AI = model-dependent.**

1. **Ingestion (D)** — URL via `yt-dlp` (`python -m yt_dlp`, `shared/media/url-import.js:72`) → mp3 → `ffmpeg` → 16 kHz mono WAV (`url-import.js:57`). Uploads/direct files hit the same WAV path.
2. **Transcription (AI)** — `engine.transcribeFile` → OpenAI/Gemini transcription (model per settings; the tested note used `gpt-4o-transcribe`). Word timestamps captured when available (`result.words`).
3. **Transcript cleanup (AI, transcription-time only, often absent)** — `smart_punctuation` / `custom_vocabulary` / `voice_corrections` exist **in the Pro transcription plugin** (`shared/engine/premium/plugins/pro_transcribe.py`, `_run_after_transcribe` `engine.py:926`) but run *when the transcript is first made*, not before summarizing. **No cleanup pass runs before analysis.** (§4.)
4. **Speaker identification (AI, separate, slow)** — `/api/diarize` (`gpt-4o-transcribe-diarize`) on demand; **not** fed into any summary prompt. Single-shot; times out on long audio (>5 min for this file).
5. **Timestamp handling (D)** — stored on the item; used only for transcript click-to-play and (attempted) quote mapping. **Never passed to a summary prompt** (`engine.py`, verified: only `text` is sent).
6. **Language detection (AI)** — at transcription; not used downstream.
7. **Topic segmentation (AI, optional)** — only the Chapters preset/auto-chapters (`run_action`, truncated). No segmentation feeds the summary.
8. **Template selection (D, manual)** — user picks Length/Type; `note_type` default `auto`, never auto-detected. Heuristic "Suggested" action is a client regex (§6).
9. **Prompt construction (D)** — `head("You are a meeting assistant." + typeFraming + styleHead) + sharedTail`. User message = **raw transcript** (`engine.py:704, 714`).
10. **Context-window handling (D, crude)** — `summarize`: **whole transcript, no limit** (single call). `review-details`/`key-quotes`/`followups`/`run_action`: **hard `transcript[:12000]` truncation** (`engine.py:1419,1469,1595,1641`). Beyond that, text is **dropped**.
11. **Chunking (absent)** — **none.** No map-reduce, no partial-summary merge, anywhere (`engine.py`, verified). Long input = truncate.
12. **Combining partial summaries (absent)** — N/A; there are no partials.
13. **Quote extraction (AI)** — `extract_key_quotes`, "copy verbatim," temp 0.3. Mapping to audio is **client-side text match** (`_quoteStartTime`, `index.html`), which breaks when the model edits the quote (§7).
14. **Decision extraction (AI)** — `extract_review_details`, JSON-by-prompt (no JSON mode), temp 0.1.
15. **Action-item extraction (AI)** — two competing sources: `summarize`'s `Action Items:` tail **and** `review-details.actions`; the Actions-menu "Action items" preset is a third. They disagree (§4/§6).
16. **Follow-up generation (AI)** — `suggest_followups`, temp 0.4, exactly 3 questions.
17. **Quality checks (absent)** — **none.** No validation that quotes exist in the transcript, that decisions were actually decided, or that actions have real owners. (`engine.py`, verified.)
18. **Final formatting (D)** — split on `Action Items:`; render bullets/paragraphs in the Review pane.
19. **Storage & editing (D)** — `persistEnrichment` (`index.html:7019-7028`) persists **only** `summary`, `action_items`, `speakers`, `chapters` (web) onto the SQLite item. **`decisions`, key `quotes`, and follow-ups are NEVER persisted** — they are re-generated by a fresh LLM call **every time the note is opened** (`loadReviewDetails`/`loadKeyQuotes`/`loadFollowups`, guarded only per-session). That means recurring API cost and **non-deterministic** Review content across opens. **Edit** (`saveSummaryEdit`, `index.html:6354-6364`) is a free-text overwrite of the **summary blob only** — action items/decisions/quotes have no edit affordance; **Regenerate** re-runs `summarize` and overwrites any manual edit. **Electron bug:** the desktop `update_history_text` whitelist (`main.js:1090-1102`) omits `chapters`, so auto-chapters do **not** survive reopen/restart on Electron — a cross-platform data-loss discrepancy vs. web.

**Deterministic:** ingestion, WAV conversion, param selection, truncation, splitting, rendering, storage. **AI-dependent:** transcription, every summary/extraction, diarization. **Notably deterministic-but-dumb:** the 12k truncation and the "meeting assistant" persona are hard-coded, not adaptive.

---

## 4. Supplied-example audit

Content type: **solo educational YouTube talk**, structured as **10 questions**. No group, no decisions, no assigned tasks. Below, each generated section is judged against the full transcript.

### Title
- **Generated:** *"OK, let's start the meeting. First item,…"* / on re-import *"Hello, everyone. My name's Ashley Gro…"*
- **Verdict: FAIL (placeholder).** The title is **the first 7 words of the transcript** (`_derivedTitle`, `index.html:6788-6793`), not generated. For this video it literally reads "let's start the meeting" — reinforcing the meeting bias and producing a meaningless title. **The real title was available and thrown away:** the URL rich-preview fetches the page title *"So You Want to Be an AI Consultant?…"* (`index.html:5655`) but URL import never writes it to the note (`submitUrlImport`/`server.js import_url` set no `title`). No AI title generation exists anywhere.

### Summary (default: bullets · auto)
- **Captured correctly:** the gist — skills (business analysis, data strategy), degree-optional, high-demand sectors (healthcare/finance/marketing), portfolio, networking/LinkedIn. Factually sound.
- **Omitted:** the **10-question structure** entirely; the framework "problem → solution → ROI → metrics"; the rates/pricing question; differentiation/unique-value-proposition; "don't chase trends, focus on impact"; the ethics-as-competitive-moat argument (ISC2 → contracts in healthcare/finance/government).
- **Oversimplified:** flattened a structured 10-answer talk into 6 generic bullets that could describe any "how to be an AI consultant" article.
- **Content-type fit: POOR.** Opens *"In this meeting, Ashley Gross…"* (detailed/auto) — it is not a meeting.

### Decisions
- **Generated:** "No question is a silly question." · "Healthcare, finance, and marketing are high demand sectors."
- **Verdict: FAIL — wrong category, none of these are decisions.** #1 is the speaker's **opinion/encouragement**; #2 is a **factual claim**. No group decided anything. A *Decisions* section **should not exist for this content type** and the system has no way to suppress it.

### Action Items
- **Generated (summarize, meeting/call types):** "Ashley to provide more resources on setting consulting rates," "Ashley to continue the newsletter weekly," "Participants to subscribe to the newsletter."
- **Generated (Action-items preset):** 14 items incl. "Answer the 10 burning questions," "Take the ISC-2 certification course and pass the exam."
- **Verdict: FAIL — fabrication + misclassification.** These are **the speaker's advice reframed as assigned tasks** (advice ≠ task), plus a **promotional CTA** ("subscribe") treated as a to-do, plus an absurd task ("Answer the 10 burning questions" = the speaker's own purpose). "Ashley to…" invents an **owner/commitment** the transcript never states — directly violating the extractor's own "do not invent owners" instruction.

### Key Quotes
- **Generated:** "Everybody can't be good at everything." · "No question is a silly question." · "Data is still the king." · "Prove the ROI."
- **Captured correctly:** the selections are apt and punchy.
- **Verdict: PARTIAL FAIL — verbatim contract broken.** The transcript says **"Prove the RY"** (the transcriber mis-heard "ROI" as "RY" **36 times**). The quote engine output **"Prove the ROI."** — i.e. it **silently edited** a quote that is contractually required to be verbatim so it can be mapped to audio. Result: the timestamp lookup for that quote **fails** (no "Prove the ROI" exists in the word list). Quotes are not traceable and not trustworthy as verbatim.

### Ask Next (follow-ups)
- **Generated:** "What key skills are essential…?" · "Do I need a degree…?" · "Which industries have the highest demand…?"
- **Verdict: PASS (adequate) but generic.** They mirror the video's own literal section headings rather than surfacing deeper/unanswered questions (e.g., "How exactly does she price a contract?" — which the video only partially answers). Appropriate for the content type; low insight.

### Metadata
- Duration (18:14) and processing time (41.8s) are correct and deterministic. No topic tags, no content-type label, no speaker metadata used.

---

## 5. Transcript-quality audit

The raw transcript is **materially corrupted**, and the summary path is blind to it.

- **`ROI` → `RY`:** the raw transcript contains "RY" **36 times** vs "ROI" 3 times. "Prove the RY," "prove the RY," "learn how to communicate… RY" — the single most important framework term in the talk is mis-transcribed throughout.
- Other likely errors present: **"gender AI"** (×1, for "generative AI"), **"shop bot"** (×1, likely "chatbot"), sentence-boundary/punctuation noise ("Gen.2.20"-style artifacts of "generative AI since 2020").
- **Grounded terms confirmed real (not hallucinations):** GDPR (×3), CCPA (×2), ISC/ISC2 (×3), Coursera (×3), mentor (×3), unique value proposition (×3), rates (×7). The summaries citing these are supported.

Answers to the required questions:

- **Does WhisperClick detect these errors?** **No.** No error/uncertainty detection anywhere in the summary path.
- **Does cleanup occur before summarization?** **No.** Cleanup features exist only at **transcription time** (Pro plugin) and did not fire here; nothing normalizes the stored transcript before it is summarized (`engine.py`: raw `text` passed verbatim).
- **Are known terms normalized?** **No** custom-vocabulary/normalization was applied to this note; even when it is, it runs at transcription, not as a pre-summary pass.
- **Does the summary model receive raw or cleaned transcript?** **Raw.** The mangled "RY" text is what the summarizer sees.
- **Can users review corrections?** **No** correction/diff UI for transcription errors exists.
- **How is uncertainty represented?** Word-confidence is captured and can be highlighted in the *transcript view only*; it is **never** surfaced in summaries or used to flag risky claims.

**Consequence:** the summaries *appear* clean because gpt-4o-mini silently "fixed" RY→ROI in prose — but that same silent correction (a) hides that the transcript is broken, (b) breaks the verbatim-quote/timestamp contract, and (c) means the model is *guessing* at the speaker's words with no audit trail.

---

## 6. Template-by-template test results

Raw outputs saved to `gen-summaries.json` (12 summarize combos) and `gen-actions.json` (4 analysis presets). Scores 1–10.

### Path A — `summarize` combinations (representative)

**`bullets · auto` (the product default)** — full transcript seen.
- Accuracy 8 · Coverage 4 · Organization 6 · Classification 5 · Actionability 4 · Quote 6 · Readability 8 · Content-fit 4 · Traceability 1 · Overall **4.5**
- 6 correct-but-generic bullets; loses the 10-Q structure and the frameworks; 3 action items are advice/CTA reframed as tasks; no traceability.

**`detailed · auto`** — richest single-blob.
- Accuracy 8 · Coverage 6 · Organization 6 · Classification 4 · Actionability 4 · Quote — · Readability 8 · Content-fit 3 · Traceability 1 · Overall **5**
- Two solid paragraphs, but opens *"In this meeting"* and still omits questions 8–10 depth; adds ISC-2/GDPR/CCPA (grounded) — decent, mislabeled as meeting.

**`brief · meeting`**
- Accuracy 7 · Coverage 2 · Organization 6 · Classification 2 · Actionability 3 · Readability 8 · Content-fit 2 · Traceability 1 · Overall **3**
- One sentence + invented "Ashley to provide resources on rates / newsletter" tasks. Worst classification.

**Effect of `note_type`:** across all 12, the type changes only the opening frame ("In this meeting" / "In this call" / "The core idea is") and nudges the action-item flavor toward invented owners for meeting/call. **It does not restructure.** `brief/bullets/detailed` genuinely change length (verified: ~250 / ~850 / ~1250 chars).

### Path B — analysis presets (truncated at 12k)

**Bullet points (preset 1)** — *best summary output tested.*
- Accuracy 8 · Coverage 6 · Organization 8 · Classification 7 · Actionability 6 · Readability 9 · Content-fit 7 · Traceability 1 · Overall **6.5**
- Produced a nested, hierarchical outline that actually mirrors the talk's structure — **markedly better than the Review Summary** — but **stops at "Finding First Clients," dropping questions 8–10** due to truncation.

**Chapters (preset 4)**
- Accuracy 7 · Coverage 5 · Organization 8 · Classification 7 · Content-fit 8 · Traceability 1 · Overall **6**
- 7 clean chronological chapters — for a **10-question** video. The missing 3 are truncation casualties, not editorial choices. Reads well; silently incomplete.

**Key takeaways (preset 3)**
- Accuracy 8 · Coverage 5 · Organization 8 · Readability 9 · Content-fit 8 · Traceability 1 · Overall **6.5**
- 5 tight takeaways; the most honest, least-fabricated output — but also truncated.

**Action items (preset 2)**
- Accuracy 5 · Classification 2 · Actionability 3 · Content-fit 2 · Traceability 1 · Overall **2.5**
- 14 fabricated to-dos from a zero-task video, incl. "Answer the 10 burning questions." Worst content-fit of all.

**Takeaway:** the **richest, best-structured** outputs (Bullet points, Chapters, Key takeaways) live in **Path B**, which is **truncated** and dumps into an ad-hoc panel; the **default Review Summary** (Path A) is **shallower** but sees the whole transcript. The product surfaces the weaker one by default.

---

## 7. Shared systemic problems (platform-level, not template-level)

1. **Single "meeting assistant" persona for all content** (`engine.py:693`). Root cause of decisions/actions/owners bias. Platform-level.
2. **No content-type detection.** `note_type` is manual and defaults to `auto`; the only heuristic (`suggestActionForNote`, `index.html:7674`) is a regex + length check that just picks *which menu row to suggest*, not the actual generation shape.
3. **Hard 12k truncation with no chunking and no warning** (`engine.py:1419/1469/1595/1641`). Silent data loss on any transcript >~2,000 words for decisions/quotes/followups/actions/all presets.
4. **Two divergent summary paths** (`summarize` vs `run_action`) with different truncation, different depth, different output targets, and **three competing action-item sources** that disagree.
5. **No transcript cleanup before analysis.** Raw, mis-transcribed text is summarized; the model silently guesses corrections.
6. **No factual grounding.** No summary/decision/action claim links to transcript span, timestamp, speaker, or confidence. The substrate exists but is unused: `words[]` (each `{word, start, confidence}`) is a stored first-class column (`history-store.js:18-22`), yet it feeds only click-to-play and the quote match — never any claim.
7. **Broken verbatim contract for quotes** → timestamp mapping is a **first-4-token, first-occurrence** normalized text scan (`_quoteStartTime`, `index.html:6472-6484`), **recomputed every render, never stored**, and fails whenever the model "fixes" a word (as with RY→ROI).
7b. **Ephemeral, re-billed Review content.** Decisions, key quotes, and follow-ups are **not persisted** and are re-generated by fresh LLM calls **on every note open** — recurring cost + non-deterministic output. Only summary/action_items/speakers/chapters(web) persist; **Electron drops chapters** on save (whitelist bug). **Edit** touches only the summary blob.
8. **No quality validation.** Nothing checks that decisions were decided, actions have real owners, or quotes exist. The "do not invent owners" instruction is unenforced (and violated).
9. **Weak section definitions.** "Decisions" and "Action items" are defined for meetings only; there is no taxonomy for advice, recommendations, claims, frameworks, or CTAs — so those collapse into the nearest meeting bucket.
10. **Generic follow-ups.** Mirror the surface topics; no notion of *unanswered* questions.
11. **Everything runs on gpt-4o-mini** (`transcription.py:641`); "smart" (gpt-4o) is available but never used for summaries.
12. **Placeholder title.** First-N-chars, not generated.

**Template-level (fixable per-template):** the Action-items preset over-extracts; `brief` is too terse to carry 10 answers. **Everything else above is platform-level** and will recur in any new template built on this base.

---

## 8. Missing capabilities

- Content-type detection (educational/interview/podcast/lecture/meeting/sales/demo).
- Structure detection (numbered lists, Q&A, chapters, frameworks) and structure-preserving output.
- Long-transcript handling (chunk → map → reduce) instead of truncation.
- Pre-analysis transcript cleanup + term normalization + an uncertainty signal.
- A section **taxonomy** that distinguishes decision / advice / recommendation / task / claim / opinion / framework / quote / CTA / resource / open-question.
- Evidence linking (claim → transcript span → timestamp → speaker → confidence) and storage of it.
- Grounding/validation checks (quote-exists, owner-stated, decision-actually-made) before display.
- Real depth controls (brief/standard/detailed/executive/study-notes/minutes/action-oriented/repurposing/research/client-call) as distinct templates, not framings.
- User controls: tone, audience, section visibility, output language, #quotes, #actions, timestamp inclusion, speaker attribution.
- AI title generation.
- One unified summary path (kill the summarize/run_action split).

---

## 9. Recommended future architecture (proposal only — do not implement yet)

A layered pipeline where **shared logic** guarantees truth and **templates** only decide presentation.

**Shared layers (run once, template-agnostic):**
1. **Cleanup layer (pre-analysis).** Normalize transcript: apply custom vocabulary, fix known term mis-hears (ROI, generative AI, product names), repair sentence boundaries. Keep a raw↔clean diff. Feed the *clean* text to analysis; keep raw for audio mapping.
2. **Content-type + structure detector.** One cheap classifier pass → `{type, structure, hasSpeakers, hasDecisions}`. Drives which template and which sections are even eligible (e.g. *Decisions* disabled for lectures/educational).
3. **Grounding layer.** Chunk long transcripts; every extracted claim carries `{sourceSpan, tStart, speaker, confidence}`. Store it on the item. Quotes are validated to exist in the clean transcript; timestamp mapping uses the stored span, not a re-match.
4. **Validation layer.** Drop/soften claims that fail grounding: no owner stated → not an "action item with owner"; not actually decided → not a "decision"; CTA detected → routed to a *Calls to action* bucket, never *Action items*.
5. **Model tier policy.** Cheap model for extraction, "smart" for synthesis/executive summaries (paid).

**Template layer (presentation only):** each template declares required/optional **section types drawn from one taxonomy**, a default depth, and a content-type fit. Templates never define their own grounding or extraction — they consume the shared layers.

**Shared vs template-specific:** grounding, cleanup, content-type/structure detection, the section taxonomy, and validation are **shared and mandatory**. Only *which sections appear, in what order, at what depth, in what voice* is **template-specific**.

---

## 10. Recommended template library (proposal only)

Each is genuinely distinct (different sections/audience/fit), not a renamed length knob.

| Template | Use | Content type | Target user | Required sections | Optional | Never without evidence | Default length | Tier |
|---|---|---|---|---|---|---|---|---|
| **Quick Gist** | 10-sec what-was-this | any | everyone | TL;DR (2–3 lines) | — | any claim | brief | Free |
| **Standard Summary** | default read-out | any | everyone | Summary bullets, Key points | Quotes | decisions, tasks | standard | Free |
| **Study Notes** | learn from lectures/educational | educational/lecture | learner | Thesis, Key concepts, Frameworks, Examples, Open questions | Glossary | "decisions", "action items" | detailed | Pro |
| **Meeting Minutes** | real meetings | meeting | team | Decisions, Action items (owner+due), Discussion, Follow-ups | Attendees | decision/owner unless stated | standard | Pro |
| **Executive Brief** | decision-makers | any long-form | exec | 1-line bottom-line, 3 key insights, Risks, Recommendation | Metrics | recommendations as facts | brief-standard, smart model | Pro |
| **Action Plan** | do-the-work | meeting/call/planning | operator | Tasks (owner, due, priority) | Dependencies | any task w/o a stated basis | standard | Pro |
| **Interview/Podcast Notes** | Q&A content | interview/podcast | listener | Guest, Q&A pairs, Notable quotes, Takeaways | Timestamps | — | detailed | Pro |
| **Sales-Call Recap** | client calls | sales | AE | Attendees, Needs, Objections, Commitments, Next steps | Pricing | commitments unless stated | standard | Pro |
| **Content Repurposing** | make posts/threads | educational/talk | creator | Hooks, Key points, Pull-quotes, CTA (labeled) | Thread draft | fabricated quotes | detailed | Pro |
| **Research Notes** | deep analysis | lecture/paper/talk | researcher | Thesis, Arguments, Evidence, Counterpoints, Citations w/ timestamps | Limitations | unsupported claims | detailed, smart model | Pro |

For the audited video, **Study Notes** (or Interview/Content-Repurposing) is the correct template — and none of them would emit a *Decisions* section.

---

## 11. Free-versus-premium recommendation

- **Free:** Quick Gist, Standard Summary (with grounding + cleanup — grounding is a trust feature, not a paywall), on the cheap model. This alone beats today's default.
- **Pro:** all specialized templates, the "smart" synthesis model, evidence/timestamp linking UI, custom/user-editable templates, depth+control knobs, and long-transcript chunking.
- **Principle:** never paywall *correctness* (cleanup, grounding, content-type suppression of wrong sections). Paywall *depth, specialization, and control.*

---

## 12. Priority-ranked repair plan

1. **P0 — Kill the "meeting assistant" persona / add content-type gating.** Stop emitting Decisions/owner-actions for non-meeting content. Highest trust impact, smallest change (prompt + a cheap classifier).
2. **P0 — Fix the 12k truncation.** At minimum, warn + raise the cap; properly, chunk→map→reduce. Currently silent data loss on most real long content.
3. **P0 — Transcript cleanup before analysis** + term normalization (ROI etc.). Fixes the root corruption and the silent-guessing problem.
4. **P1 — Fix the verbatim-quote/timestamp contract** (map on stored span, validate quote-exists).
5. **P1 — Unify the two summary paths;** one action-item source; resolve the three-way disagreement.
6. **P1 — AI title generation** (and, immediately, **use the already-fetched URL page title** for URL imports instead of discarding it).
6b. **P1 — Persist Decisions / Key Quotes / Follow-ups** (stop re-billing + stabilize output on every open) and **fix the Electron `chapters` persistence bug.**
7. **P2 — Grounding/evidence storage** (claim → span/time/speaker/confidence) + validation checks.
8. **P2 — Real template library** (§10) on the unified base.
9. **P3 — User controls** (depth, tone, sections, language, counts, attribution) and **user-editable templates**.

---

## 13. Files and prompts inspected

- `platforms/web/server.js` — endpoints `433-448` (summarize), `640-705` (followups/review-details/key-quotes), `707-724` (action), `966-1035` (url-preview/import); engine subprocess bridge `133-254`.
- `shared/engine/engine.py` — prompt builders `674-719` (summarize), `1421-1427` (followups), `1470-1480` (review-details), `1596-1603` (key-quotes), `1643-1651` (run_action); parse/split `641-668`; no chunking (verified across handlers); raw-transcript pass-through (verified).
- `shared/engine/backend/transcription.py` — `chat_complete` `617`; model selection `641` (`gpt-4o` if smart else `gpt-4o-mini`), `669` (Gemini); temps per call-site.
- `shared/engine/premium/plugins/pro_transcribe.py` — transcription-time cleanup only (not pre-summary).
- `shared/frontend/index.html` — `SUMMARY_STYLES/TYPES` `6185-6188`; `renderSummaryStyleBar` `6248-6298`; `ACTION_PRESETS` `7650-7661`; `suggestActionForNote` `7674-7692`; `summarizeDetail` `6980-7015`; `runAction/runStyleAction` `7869-7902 / 8191-8209`; custom actions `7663-7833`; gating `651-654, 1971-1991`.
- `shared/media/url-import.js` — ingestion `55-83`.
- **Live generations:** `gen-summaries.json` (12 combos), `gen-actions.json` (4 presets), plus `/api/review-details`, `/api/key-quotes`, `/api/followups` on the test note. Transcript: `ashley-gross-ai-consultant-transcript.txt` (18,680 chars).

---

## 14. Unknowns that could not be verified

- **Diarization output quality on this file** — the 18-min single-shot diarize timed out (>5 min) and never returned, so speaker labeling could not be evaluated end-to-end (it is a solo talk, so low stakes here).
- **Exact transcription model used for the import** — reported as the configured API model; not separately re-confirmed per-request.
- **Gemini path** — all live tests ran on the OpenAI provider; Gemini prompt behavior/temperature handling was read from code, not executed.
- **Electron/Tauri parity** — this audit used the web server (`platforms/web`); whether the Python engine prompts are identical in the desktop builds was not re-verified (same `shared/engine` is imported, so likely identical, but untested here).
- **"Match my style" (preset 7)** and **custom multi-step macros** were not run against this transcript.
- **Auto-chapters threshold** (`>1800` chars) fires in the frontend import path; whether it ran for this note automatically vs. only on manual trigger was not separately confirmed.
