# WhisperClick — Summary System Replacement Specification

**Status:** **APPROVED 2026-07-19 with mandatory amendments (see §0). Phase 0 foundation authorized behind the `WC_ANALYSIS_V2` flag.** The current visible Review experience is not to be replaced during Phase 0.
**Supersedes:** the emergency repair direction in [`summary-system-audit.md §9-§12`](./summary-system-audit.md). Where the audit and this spec differ, this spec wins.
**Governing principle:** *Correctness is a base product requirement, not a premium feature.* Full-source processing, no silent truncation, content-aware section suppression, quote validation, stable persistence, and factual grounding ship in the free tier. Premium controls **depth, specialization, models, evidence interfaces, and custom templates** — never whether the system reads the whole source.

---

## 0. APPROVED — AUTHORITATIVE AMENDMENTS (2026-07-19)

**Status of this section: APPROVED and BINDING.** Edward approved the architecture on 2026-07-19 with the mandatory amendments below. This section is authoritative: where anything later in this spec (or in the addendum) conflicts with it, **this section wins**, and the older text is to be read as superseded. Phase 0 foundation implementation is authorized to proceed behind a feature flag (`WC_ANALYSIS_V2`, default off) without a further review gate. The current visible Review experience must **not** be replaced during Phase 0.

### 0.1 Approved decision register (locked)

1. **Model tiers, not model names.** An economical extraction-model tier is adopted only *after* a corpus bake-off confirms strong-section accuracy thresholds. Models are selected through **capability tiers** (e.g. `reasoning`, `extraction`, `cleanup`), never hard-coded model IDs.
2. **Rules-first normalization.** Meaning-changing corrections **and their provenance** are base correctness (free tier). Enhanced punctuation / prose cleanup is optional/premium.
3. **No bundled offline AI in v1.** Support *configured* local models. With no cloud key and no capable local model → **transcript-only mode** with an explicit "Analyze — setup required" state. Deterministic extraction is never presented as equivalent AI analysis.
4. **Adaptive, structure-aligned segmentation** with a configurable fallback window (~1,800 tokens, sentence-aligned overlap).
5. **Dedup order:** exact evidence / span-overlap first → lexical similarity second → reduce-stage adjudication only for the unresolved remainder. **No embeddings dependency in v1.**
6. **Bias to suppression / abstention** for decisions, commitments, owners, and due dates.
7. **Dedicated analysis-run store.** Versioned inline CAO JSON lives in a dedicated analysis-run store, **not** as one replaceable `cao` field on the primary note record.
8. **Speaker templates degrade to unknown speaker.** Diarization is **never** a blocking prerequisite for analysis.
9. **Live meetings:** provisional incremental analysis + one authoritative final consolidation.
10. **Retention:** keep the last **5** ordinary generated versions; user-edited or explicitly pinned versions are exempt from automatic retention deletion.

### 0.2 Mandatory contract amendments (locked)

- **Separate `AnalysisRun` from `RenderedArtifact`.** The CAO is template-independent. `AnalysisRun` = transcript-derived canonical analysis (evidence, content profile, structure, validation, processing coverage, analysis provenance). `RenderedArtifact` = template id/version, depth, language, presentation settings, rendered sections, user modifications, and a reference to an `AnalysisRun`. **A template change must not regenerate transcript extraction** unless the underlying analysis is stale/incompatible.
- **Separate identifier types:** `analysisRunId`, `renderArtifactId`, `itemId`, `evidenceId`, `segmentId`. An item id is never used as an evidence id.
- **Raw word ranges are the PRIMARY evidence anchor.** Evidence identity references stable raw word ids/indices. Character offsets, normalized offsets, and timestamps are **derived** fields. Cross-platform offset rules are defined explicitly so Python/web/Electron/Tauri cannot disagree over Unicode/line-ending behavior.
- **Raw transcript is source-of-record, NOT verified truth.** Distinct states: `transcriptMatched`, `audioMapped`, `audioVerified`. Mapping a phrase to ASR words/timestamps does not prove the ASR wording is correct.
- **Quotes are constructed from raw evidence ranges.** Extraction selects raw word ranges; the backend constructs `rawText` directly from those ranges. The model never generates verbatim text for later fuzzy-matching. A normalized `displayText` may be shown, but meaning-changing corrections must be visible and linked to the raw wording.
- **No hard suppression from a sampled profile.** A representative sample guides extraction but cannot authoritatively declare the whole transcript has no decisions/commitments/CTAs/risks. Final presence flags + suppression are derived **after** complete segment extraction + validation. Content-type eligibility may narrow *presentation*, but evidence found anywhere is never discarded because a sample missed it.
- **Structure is detected across the COMPLETE source.** Short inputs: detect from the full transcript. Long inputs: detect local structural units during segment processing, then merge globally. A profile sample alone cannot detect every chapter/agenda/question.
- **"Processing coverage," not guaranteed recall.** The guarantee is renamed to *processing coverage*: every raw range assigned, every segment terminal, every successful segment merged, every failed range visible, no silent missing range. We do **not** claim guaranteed semantic understanding — that is evaluated via the corpus.
- **Stronger relationship evidence.** Task items carry `actorSpan`, `taskSpan`, `dueSpan`, `commitmentCueSpan`, `relationshipConfidence`. A name/date merely co-occurring in a span is insufficient for ownership/deadline. Decision items carry a lifecycle: `proposed | agreed | revised | rescinded | superseded | unclear`. A later opposing statement is **not** auto-selected as authoritative unless explicit revision/retraction evidence exists — otherwise the conflict is preserved and marked `unclear`.
- **Versioned analysis-run store fields:** `analysis_run_id`, `note_id`, `raw_version`, `normalized_version`, `schema_version`, `analysis_status`, `processing_coverage`, `cao_json`, `model_policy`, `created_at`. Rendered artifacts reference `analysis_run_id` and persist separately. The store supports partial/resumable runs, multiple versions, user-edited artifacts, and future evidence externalization without changing the public item contract.

### 0.3 Phase 0 boundary

Phase 0 builds foundation only, behind `WC_ANALYSIS_V2`: final schemas/versioned contracts; analysis-run + rendered-artifact persistence; raw/normalized/correction-map storage; stable raw-word evidence anchoring; golden + adversarial corpus harness; processing-coverage tracking; web/Electron schema parity tests; zero-generation-on-open tests; non-destructive migration scaffolding; and the profile/segment/extract/merge/validator modules behind the flag. **It does not replace the visible Review experience.** Before the new path may be enabled, the acceptance gate in §0.4 must pass with executable proof.

### 0.4 Enable-gate (must be proven before turning the flag on)

Corpus acceptance gate passes · existing notes unchanged · opening a note triggers zero new analysis calls · partial runs are visibly partial + resumable · web and Electron persist identical contracts · the Ashley Gross fixture yields 10 structural units, no fabricated decisions/commitments, correctly separated advice/CTA, and exact evidence-linked quotes.

---

## 0. Design invariants (apply to every section below)

1. **The raw transcript is immutable.** Nothing overwrites it. Normalization is a separate layer with a back-reference map.
2. **No stage may silently truncate the source.** Every segment is considered. If a budget is hit, the system chunks; it never drops.
3. **A section renders only if it passes two independent gates:** content-type *eligibility* AND *evidence* (≥1 grounded item). Either failing → the section is suppressed, not emptied with filler.
4. **Templates render; they never extract.** All extraction happens once into the Canonical Analysis Object (CAO). Templates are pure projections of the CAO.
5. **Opening a note performs zero billable generation.** Generation happens on explicit user action or a detected staleness condition the user confirms.
6. **Every item is grounded** to a raw span, a normalized span, timestamps, speaker (when known), confidence, extraction method, and a validation result.
7. **Never invent** an owner, a due date, a decision, or a task. Absence is a valid, first-class result.

---

## 1. Proposed canonical analysis schema (CAO)

One structured object generated from the **entire** source before any template renders. Version-stamped. Stored. Templates consume it read-only.

```jsonc
// CanonicalAnalysisObject — one per (noteId, transcriptVersion, analysisVersion)
{
  "schemaVersion": "cao/1.0.0",
  "noteId": "1784499018527-7925f3df0090",

  "source": {
    "kind": "url|file|mic|meeting",
    "sourceUrl": "https://youtu.be/uZyq1p9kRDU",
    "pageTitle": "So You Want to Be an AI Consultant? ...",  // captured at ingest; never discarded
    "durationSec": 1094,
    "language": "en",
    "capturedAt": "2026-07-19T18:10:00Z"
  },

  "transcript": {
    "rawVersion": "raw/1",          // pointer to immutable raw transcript (see §3)
    "normalizedVersion": "norm/1",  // pointer to normalized transcript (see §3)
    "correctionMapRef": "corr/1"    // pointer to correction map (see §3)
  },

  "contentProfile": { /* see §4 — multidimensional, with per-dimension confidence */ },

  "structure": {
    "type": "numbered_questions|chapters|qa|freeform|agenda|narrative",
    "units": [
      { "id": "q1", "index": 1, "role": "question|chapter|topic|turn",
        "label": "Do I need a degree?", "rawSpan": [1203, 1890], "tStart": 122.4, "tEnd": 210.9,
        "confidence": 0.88 }
    ]
  },

  "thesis": { "text": "...", "evidence": ["ev_12"] },

  // --- Canonical section taxonomy (one vocabulary, shared by all templates) ---
  "keyClaims":       [ /* Item[] */ ],
  "concepts":        [ /* Item[] */ ],
  "frameworks":      [ /* Item[] — e.g. "problem → solution → ROI → metrics" */ ],
  "examples":        [ /* Item[] */ ],
  "metrics":         [ /* Item[] */ ],
  "recommendations": [ /* Item[] — general "you should" guidance */ ],
  "audienceAdvice":  [ /* Item[] — advice to viewers; NEVER a task */ ],
  "decisions":       [ /* Item[] — only if actually decided */ ],
  "commitments":     [ /* TaskItem[] — real assigned tasks only */ ],
  "risks":           [ /* Item[] */ ],
  "objections":      [ /* Item[] */ ],
  "openQuestions":   [ /* Item[] */ ],
  "resources":       [ /* Item[] — named tools/links/certs, e.g. ISC2, Coursera */ ],
  "callsToAction":   [ /* Item[] — promotional CTAs; NEVER a task, e.g. "subscribe" */ ],
  "quotes":          [ /* QuoteItem[] — verbatim, validated */ ],
  "followupQuestions":[ /* Item[] */ ],

  "speakers": [
    { "id": "S1", "label": "Ashley Gross", "role": "presenter",
      "talkShare": 1.0, "source": "diarize|single|labeled" }
  ],

  "generation": { /* see §7 — provenance + versioning */ },
  "validation": { "status": "passed|partial|failed",
                  "checks": [ { "name": "no_ungrounded_decisions", "result": "pass" } ] }
}
```

### Item and evidence shapes (used by every taxonomy field)

```jsonc
// Item — a single grounded extracted claim
{
  "id": "ev_12",
  "text": "A degree is not required; certifications and hands-on experience can substitute.",
  "kind": "keyClaim|concept|framework|recommendation|audienceAdvice|decision|risk|...",
  "evidence": [
    {
      "rawSpan": [4120, 4310],          // char offsets into RAW transcript
      "normSpan": [4090, 4275],         // char offsets into NORMALIZED transcript
      "tStart": 305.2, "tEnd": 319.8,   // audio seconds
      "speaker": "S1",
      "confidence": 0.83,               // extraction confidence (model or heuristic)
      "wordConfidence": 0.71,           // min/mean word-confidence over the span (from words[])
      "extractionMethod": "llm:extract-v1@segment-3",
      "quoteExact": false               // true only when text is copied verbatim
    }
  ],
  "validation": { "grounded": true, "classificationChecked": true, "notes": "" }
}

// TaskItem — extends Item; owner/due are OPTIONAL and only ever from explicit transcript evidence
{
  "...Item": "...",
  "owner": null,        // string ONLY if the transcript literally names an owner; else null
  "due": null,          // string ONLY if literally stated; else null
  "ownerEvidence": null // evidence ref proving the owner was stated; required if owner != null
}

// QuoteItem — extends Item; carries BOTH raw and normalized text
{
  "...Item": "...",
  "rawText": "Prove the RY.",           // exactly as in the raw transcript (immutable truth)
  "displayText": "Prove the ROI.",       // normalized for reading (optional)
  "quoteExact": true,
  "audioMatched": true                   // stored, not recomputed (see §5)
}
```

**Why this shape:** it makes the audit's failures structurally impossible — a decision cannot exist without evidence; a task's owner cannot exist without `ownerEvidence`; a quote carries its raw wording so the RY→ROI problem is representable rather than hidden; advice, recommendations, and CTAs are distinct fields so they can never collapse into "action items."

---

## 2. Full pipeline architecture

Twelve stages. **D = deterministic, AI = model, H = heuristic.** No stage truncates.

| # | Stage | Type | Output | Notes |
|---|---|---|---|---|
| 1 | **Ingest** | D | source metadata incl. `pageTitle` | Keep the URL page title (today it is fetched then discarded). |
| 2 | **Raw transcript + word timing** | AI | `raw/N` (immutable) + `words[]` | Unchanged transcription; store as today, mark immutable. |
| 3 | **Normalize** | H+AI | `norm/N` + `corr/N` | Rule-based term map first (deterministic), then a light LLM punctuation/boundary pass; every change recorded in the correction map (§3). Never edits `raw/N`. |
| 4 | **Detect content profile + structure** | AI | `contentProfile`, `structure` | One cheap call over a representative sample (or full text if within budget); returns the multidimensional profile (§4) and structural units. |
| 5 | **Segment the full transcript** | D/H | `segments[]` | By structural units when present, else by token-budgeted windows with overlap. Covers 100% of the transcript. |
| 6 | **Extract per segment** | AI | partial `Item[]` per segment, with char offsets | Grounded extraction; every item carries its segment-local span, mapped back to global raw/norm offsets. |
| 7 | **Merge + dedup** | D/H | unified `Item[]` per taxonomy field | Dedup by normalized-text similarity + span overlap; keep the highest-confidence evidence; union evidence spans. |
| 8 | **Validate** | D+AI | `validation` + per-item flags | Two-gate check (§5): grounded? correctly classified? Drops/reclassifies violators (advice→audienceAdvice, CTA→callsToAction, opinion→keyClaim). |
| 9 | **Build CAO** | D | `CanonicalAnalysisObject` | Assemble; compute thesis; attach provenance + version. |
| 10 | **Render template** | D | rendered Review sections | Pure projection of CAO; applies two-gate visibility. |
| 11 | **Persist** | D | stored CAO + provenance + version | One write; identical fields web + Electron (§7, §12). |
| 12 | **User regenerate / edit** | D | new version | Explicit only; preserves user edits (§7). |

**AI stages:** 2 (transcribe), 3 (normalize LLM pass), 4 (profile), 6 (extract), 8 (validation reclassification). **Deterministic/heuristic:** ingest, segmentation, merge/dedup, CAO assembly, rendering, persistence, versioning.

---

## 3. Raw-versus-normalized transcript design

Three representations, three stored objects. **The analysis layer may read "RY" as "ROI"; the raw transcript and audio evidence never change.**

```jsonc
// raw/N — IMMUTABLE. Written once by transcription; never mutated.
{ "version": "raw/1", "text": "...Prove the RY. Get really...",
  "words": [ { "w": "RY", "start": 402.1, "end": 402.5, "confidence": 0.44 } ],
  "createdAt": "...", "model": "gpt-4o-transcribe" }

// norm/N — derived, regenerable, safe to overwrite on re-normalize.
{ "version": "norm/1", "rawVersion": "raw/1",
  "text": "...Prove the ROI. Get really...", "createdAt": "...", "method": "rules+llm-punct@v1" }

// corr/N — the correction map: every normalization → its raw origin + why.
{ "version": "corr/1", "rawVersion": "raw/1", "normVersion": "norm/1",
  "corrections": [
    { "rawSpan": [4020, 4022], "normSpan": [4020, 4023],
      "rawText": "RY", "normText": "ROI",
      "tStart": 402.1, "tEnd": 402.5, "rawWordConfidence": 0.44,
      "reason": "term-normalization: known-term 'ROI' (rule)", "method": "rule|llm", "confidence": 0.9 }
  ] }
```

Rules:
- **Normalization sources, in order:** (a) user custom vocabulary + a curated known-terms map (ROI, generative AI, chatbot, GDPR, CCPA…), applied deterministically; (b) an LLM punctuation/sentence-boundary pass constrained to *not* change word content beyond the term map. Both log to `corr/N`.
- **Offsets:** extraction records offsets into **both** raw and norm; the correction map lets any normalized span resolve to raw words → audio.
- **UI:** normalized text is shown by default; a normalized token can reveal "raw: RY (44% confidence) — normalized to ROI." Quotes display normalized but store `rawText`.
- **Regeneration:** re-normalizing produces `norm/2`+`corr/2`; `raw/1` is untouched; any CAO built on `norm/1` is marked stale, not silently rebuilt.

---

## 4. Content-profile schema

Multidimensional — **never a single label.** Every dimension carries confidence. Drives section eligibility.

```jsonc
{
  "primaryType": { "value": "educational", "confidence": 0.92 },
  "secondaryTraits": [ { "value": "solo_presentation", "confidence": 0.9 },
                       { "value": "listicle_10_questions", "confidence": 0.85 },
                       { "value": "promotional_closing", "confidence": 0.8 } ],
  "structureType": { "value": "numbered_questions", "confidence": 0.88, "count": 10 },
  "speakers": { "count": 1, "roles": ["presenter"], "confidence": 0.95 },

  "presence": {
    "explicitDecisions":   { "value": false, "confidence": 0.9 },
    "actualCommitments":   { "value": false, "confidence": 0.88 },
    "audienceAdvice":      { "value": true,  "confidence": 0.95 },
    "promotionalCTA":      { "value": true,  "confidence": 0.9 },
    "numberedSections":    { "value": true,  "confidence": 0.88, "count": 10 },
    "metrics":             { "value": true,  "confidence": 0.6 },
    "namedResources":      { "value": true,  "confidence": 0.85 }
  },

  "eligibleSections":  ["thesis","keyClaims","frameworks","recommendations",
                        "audienceAdvice","examples","resources","callsToAction",
                        "quotes","openQuestions","followupQuestions","concepts"],
  "suppressedSections":["decisions","commitments","risks","objections"]  // + reason per item
}
```

- **`eligibleSections` / `suppressedSections`** are computed from `primaryType` + `presence`. For the Ashley Gross fixture this yields **no Decisions, no Commitments** — structurally, before any extraction runs.
- A source can be *educational* **and** *10-question* **and** *promotional_closing* simultaneously; the profile preserves all three, and rendering honors the combination (§8).
- The detector returns **only** the profile; it makes no summary text. It is one cheap call (gpt-4o-mini) and the result is cached in the CAO.

---

## 5. Evidence and validation model

**Two gates, both required, per section and per item.**

**Gate A — Eligibility (content-type):** the section is in `contentProfile.eligibleSections`. If not, suppress with reason `"ineligible: primaryType=educational"`.

**Gate B — Evidence (grounding):** the section contains ≥1 item that passes item-level validation:

Item-level checks (deterministic + one cheap adjudication call where needed):
1. **Grounded** — `evidence[].rawSpan`/`normSpan` resolve to real transcript text; the item's claim is entailed by that span. Ungrounded → drop.
2. **Correctly classified** — a decision is an actual settled decision (not opinion/advice/claim); a commitment has a stated actor + task (advice → `audienceAdvice`; CTA → `callsToAction`; opinion → `keyClaim`; recommendation stays `recommendations`). Misclassified → reclassify or drop.
3. **No invented attributes** — `owner`/`due` present only with `ownerEvidence`/`dueEvidence`. Otherwise forced to `null`.
4. **Quote exactness** — a `quoteExact` item's `rawText` must appear as a contiguous word run in `raw/N`. If the model returned normalized text, we (a) store `displayText` = model text, (b) recover `rawText` by fuzzy-matching back to `raw/N` words, (c) set `audioMatched` from that match and **store** `tStart/tEnd` (never recomputed at render). If no raw run matches → the quote is dropped, not shown with a dead timestamp.

**Validation is explainable:** `validation.checks[]` records each gate result so the UI (and tests) can show *why* a section is present or absent.

**Grounding storage:** every evidence ref (raw/norm spans, timestamps, speaker, confidences, method) is persisted in the CAO. This is the substrate the audit found missing.

---

## 6. Chunking and merge strategy

**Goal: 100% source coverage, zero truncation, bounded cost.** Replaces today's `[:12000]` cliff.

**Segmentation (stage 5):**
- If `structure.units` exist (numbered questions, chapters, speaker turns) → segment on unit boundaries.
- Else → sliding windows of ~1,500–2,500 tokens with ~150-token overlap, aligned to sentence boundaries from `norm/N`.
- Each segment stores `[globalRawStart, globalRawEnd]` and `[globalNormStart, globalNormEnd]` so extracted offsets map back globally.

**Map (stage 6):** one extraction call per segment (cheap model), prompted to return grounded items *with segment-local char offsets and quoteExact flags*. The segment text is prefixed with its global offset so the model can echo global spans; offsets are re-validated deterministically against `norm/N` (never trusted blindly).

**Reduce (stage 7):**
- Bucket items by taxonomy field.
- **Dedup:** two items merge if normalized-text cosine/Jaccard ≥ threshold **or** their spans overlap > 60%. Merge = keep best-confidence text, **union** evidence arrays (so a claim repeated across segments accrues multiple timestamps).
- **Rank:** by confidence × evidence count; templates later take top-N by depth.
- **Cross-segment consistency:** thesis and frameworks are synthesized in one final reduce call over the *merged claim list only* (not the full transcript again), keeping the final call small.

**Budget policy (free vs premium):**
- **Free:** full coverage guaranteed; may cap **output** depth (fewer items/section, standard model) — but every segment is still read. Length may shrink; coverage never does.
- **Premium:** deeper per-section item counts, smart-model reduce/synthesis, larger evidence surfacing.

No path drops a segment. If a hard provider limit is approached, segment count increases; it never silently discards.

---

## 7. Persistence and versioning design

**Every generated output persists with full provenance; opening a note generates nothing.**

```jsonc
// generation block on the CAO (and on any rendered template output)
{
  "noteId": "...",
  "transcriptVersion": "norm/1",       // and raw/1
  "analysisSchemaVersion": "cao/1.0.0",
  "templateId": "standard-summary",
  "templateVersion": "1.0.0",
  "promptVersion": "extract-v1,profile-v1,reduce-v1",
  "model": "gpt-4o-mini", "provider": "openai",
  "settings": { "depth": "standard", "language": "en" },
  "createdAt": "...",
  "evidenceRefs": [ "ev_12", "ev_18" ],
  "userModifications": [ { "field": "summary", "editedAt": "...", "byUser": true } ],
  "staleness": { "status": "fresh|stale", "reason": null }  // stale if transcriptVersion advanced
}
```

Rules:
- **Storage:** the CAO is stored once per (note, transcriptVersion, analysisSchemaVersion). Rendered template outputs reference it. Persist as a first-class blob column (`cao_json`) plus indexed `analysis_version` / `transcript_version` columns.
- **Zero generation on open:** opening a note reads the stored CAO + rendered output. If none exists (legacy note) → show legacy summary read-only + an explicit "Analyze" button. If `staleness=stale` → show the old output with a "Transcript changed — re-analyze?" prompt. **Never auto-call the model on open.** (This kills today's re-billed decisions/quotes/followups.)
- **New version triggers (explicit only):** transcript edit, template change, depth change, or a user "Regenerate."
- **User edits are sacred:** a field with `userModifications.byUser=true` is **never** overwritten by regeneration. Regenerate writes a new version and, on any user-edited field, keeps the user's text and marks the regenerated alternative available but not applied.
- **Both platforms persist identical fields** (§12).

---

## 8. Unified template rendering design

**One extraction (CAO), many projections. Templates never re-extract.**

A template is a declarative manifest:

```jsonc
{
  "id": "study-notes", "version": "1.0.0", "tier": "pro",
  "fitContentTypes": ["educational","lecture"],
  "requiredSections": ["thesis","keyClaims","frameworks"],
  "optionalSections": ["examples","concepts","resources","openQuestions","quotes"],
  "forbiddenSections": ["decisions","commitments"],   // hard suppress regardless of evidence
  "defaultDepth": "detailed",
  "sectionOrder": ["thesis","frameworks","keyClaims","concepts","examples","resources","openQuestions","quotes"],
  "voice": "neutral-instructional"
}
```

Rendering algorithm (deterministic):
1. For each section in `sectionOrder`: show iff **in template's required/optional** AND **in CAO.eligibleSections** AND **has ≥1 validated item** AND **not in forbiddenSections**.
2. Take top-N items by depth setting.
3. Render from CAO items (text + optional evidence chips: timestamp, speaker, confidence).
4. Title: from `source.pageTitle` when present; else a grounded generated title (one cheap call over thesis+structure), never first-N-words.

This makes template differences purely presentational; the facts, grounding, and suppression are identical and correct across all of them. The two current paths (`summarize` + `run_action`) collapse into: *build CAO once → render template*. Custom user templates are just user-authored manifests over the same CAO.

**Free vs premium at the render layer:** Standard Summary + Quick Gist are free projections; specialized manifests (Study Notes, Meeting Minutes, Executive Brief, …) and custom manifests are premium. All read the same free, fully-grounded CAO.

---

## 9. Golden evaluation corpus

Stored under `docs/summary-audit/corpus/`. Each fixture = a transcript + an expectations file. Built **before** production code changes; used by §10 tests.

| Fixture | Content type | Purpose / key expectation |
|---|---|---|
| `meeting-decisions` | meeting | explicit decisions + owners + due dates → all three sections present, owners grounded |
| `meeting-no-decisions` | meeting | discussion only → **Decisions suppressed**, Discussion present |
| `educational-solo` (**Ashley Gross**) | educational | 10 questions → 10 units; **no Decisions, no Commitments**; CTA in `callsToAction`; advice in `audienceAdvice` |
| `interview-podcast` | interview | Q&A preserved as pairs; quotes attributed to correct speaker |
| `sales-call` | sales | needs/objections/commitments/next-steps; commitments only if stated |
| `brainstorm` | brainstorm | ideas + open questions; no fabricated decisions |
| `lecture` | lecture | thesis/concepts/frameworks; no action items |
| `voice-note-unstructured` | personal | freeform; graceful minimal sections |
| `advice-no-tasks` | mixed | advice present, **zero commitments** → Action Items suppressed |
| `promotional-cta` | mixed | CTA present → in `callsToAction`, **never** in commitments |
| `long-over-limit` | any | > 20k chars → 100% segments covered, no truncation |
| `known-errors` | any | seeded ROI/RY etc. → correction map produced; raw preserved |
| `ambiguous-owners` | meeting | repeated/ambiguous speakers → no invented owners |

Each `*.expectations.json`:

```jsonc
{
  "expectedProfile": { "primaryType": "educational", "structureType": "numbered_questions", "count": 10,
                       "presence": { "explicitDecisions": false, "actualCommitments": false,
                                     "audienceAdvice": true, "promotionalCTA": true } },
  "requiredSections": ["thesis","keyClaims","frameworks","audienceAdvice","resources"],
  "optionalSections": ["examples","concepts","openQuestions","quotes"],
  "forbiddenSections": ["decisions","commitments"],
  "groundTruth": {
    "decisions": [],                      // must stay empty
    "commitments": [],                    // must stay empty
    "quotes": [ { "rawText": "Prove the RY", "displayText": "Prove the ROI" } ],
    "resources": ["ISC2","Coursera","LinkedIn"],
    "cta": ["subscribe to the AI leadership newsletter"]
  },
  "expectedCoverage": 1.0,                // fraction of transcript segments considered
  "knownCorrections": [ { "raw": "RY", "norm": "ROI" }, { "raw": "gender AI", "norm": "generative AI" } ],
  "evidenceExpectations": { "everyQuoteAudioMatched": true, "everyDecisionGrounded": true }
}
```

The Ashley Gross transcript (already committed at `docs/summary-audit/fixtures/`) is the educational-video regression fixture.

---

## 10. Automated and manual acceptance tests

**Automated (run the pipeline over the corpus, assert against expectations):**

| ID | Assertion (maps to your §9 criteria) |
|---|---|
| AC-1 | `coverage == 1.0` for every fixture (no segment skipped). |
| AC-2 | No `norm/N` change ever mutates `raw/N` (byte-equality on raw before/after). |
| AC-3 | For `meeting-no-decisions`, `educational-solo`, `advice-no-tasks`: `decisions == []` and section suppressed. |
| AC-4 | No `commitments[].owner`/`due` without a matching `ownerEvidence`/`dueEvidence`. |
| AC-5 | For `advice-no-tasks` and `promotional-cta`: advice → `audienceAdvice`, CTA → `callsToAction`; `commitments == []`. |
| AC-6 | Every displayed `quoteExact` item resolves to a contiguous run in `raw/N`; `tStart/tEnd` stored, not recomputed. |
| AC-7 | Every `QuoteItem` retains `rawText`; `displayText` link intact (RY case: rawText "RY", displayText "ROI"). |
| AC-8 | Opening a persisted note issues **0** generation calls (assert via a mock provider call-counter). |
| AC-9 | Web and Electron persist byte-identical CAO field sets (schema parity test). |
| AC-10 | `educational-solo` structure has 10 units (or documented count) labeled as questions. |
| AC-11 | Title uses `source.pageTitle` when present; else a grounded generated title; never first-N-words. |
| AC-12 | A user-edited field survives a regenerate (assert edited text unchanged; new version created). |
| AC-13 | For `long-over-limit`: pipeline completes with coverage 1.0 and no `[:N]` truncation in any prompt payload (assert payload length ≥ transcript length across segments). |

**Manual (reviewer checklist per fixture):** section-fit judgment, quote aptness, thesis correctness, framework preservation (e.g., "problem → solution → ROI → metrics" survives), promotional-vs-substance separation, readability. Manual scores use the audit's 10-axis rubric.

A build fails if any AC-* fails on any fixture. The corpus is the regression gate for every future prompt/template change.

---

## 11. Migration plan for existing notes

**Lazy, non-destructive, zero surprise cost.**

1. **Schema add (backward-compatible):** add `raw_json` (from existing text+words), `norm_json`, `cao_json`, `analysis_version`, `transcript_version` columns/blobs. Existing `summary`/`action_items`/`speakers`/`chapters` stay as `analysisVersion=0` (legacy).
2. **On open of a legacy note:** render the stored legacy summary **read-only**, labeled "Legacy summary." Show an explicit **"Analyze with the new system"** button. **No auto-generation.**
3. **On explicit analyze:** build `raw/1` from stored text+words (immutable snapshot), run the new pipeline, write CAO v1. Legacy fields retained (not deleted) until the user confirms.
4. **Backfill (optional, opt-in, batched):** a settings action "Re-analyze all notes" runs the pipeline in the background with a visible cost/count estimate and a cancel — never automatic.
5. **No destructive migration:** raw text/words are never rewritten; legacy outputs are never silently replaced.

---

## 12. Web/Electron parity plan

The audit found real divergence (Electron drops `chapters`; two frontend paths). Parity requirements:

1. **Single generation source of truth:** the Python engine in `shared/engine/` remains the only generator; both `platforms/web/server.js` and `platforms/electron/main.js` call it. New pipeline lives there once.
2. **Unified persistence whitelist:** define the CAO field set in one shared constant consumed by both `server.js` (`/api/history/update`) and `main.js` (`update_history_text`). Add a parity unit test (AC-9). Fix the current `chapters` omission by construction (it becomes part of the CAO blob, not an ad-hoc field).
3. **Single frontend path:** `index.html` gets one `renderCao(templateId)` path; `summarizeDetail` / `runAction` / `loadReviewDetails` / `loadKeyQuotes` / `loadFollowups` are replaced by "read CAO → render." Diarize stays a separate on-demand enrichment that writes into the CAO's `speakers`.
4. **Store parity:** the SQLite `history-store.js` schema (and its Electron/Tauri port) share the same columns; migration (§11) runs identically.

---

## 13. Cost and latency expectations

Baseline today: **1** gpt-4o-mini call for summarize (+ per-open re-bills for decisions/quotes/followups). New system trades more calls at generation time for **zero** calls on open.

Per analyze (18-min / ~3,600-word fixture, ~4–6 segments), gpt-4o-mini:
- Normalize (LLM punct pass): 1 call (or 0 if rules-only suffices).
- Content profile + structure: 1 call.
- Extract: 1 call/segment ≈ 4–6.
- Merge/synthesis (thesis, frameworks): 1 call.
- Validation adjudication (only ambiguous items): 0–2 calls.
- Title (if no page title): 0–1 call.
- **Total: ~7–11 gpt-4o-mini calls.** Input tokens ≈ transcript read ~1.3× (overlap). At gpt-4o-mini rates this is **fractions of a cent** per note.

Latency: segment extraction parallelizes → wall-clock ≈ slowest segment + profile + reduce ≈ **~15–35s** for this length (vs today's ~single-call few seconds, but today re-bills on every open). Premium "smart" reduce/synthesis adds gpt-4o cost only on the final small reduce call.

**Net:** generation is a bit slower and cheaper-per-open (opens are free); total spend drops because re-billing on open is eliminated. Long transcripts scale linearly in segments, not truncated.

---

## 14. Ordered implementation phases

Foundation before templates (your §10 ordering).

- **P0 — Foundation (no user-visible template changes):**
  1. Raw/normalized/correction-map model + immutability (§3).
  2. CAO schema + storage columns + versioning + zero-generation-on-open (§1, §7).
  3. Content-profile + structure detector (§4).
  4. Full-source segmentation + chunk→map→reduce (§6) — **kills truncation.**
  5. Evidence + two-gate validation (§5).
  6. Golden corpus + AC harness (§9, §10).
- **P1 — Unify + correctness surfacing:** one CAO render path; suppression live (no Decisions on Ashley Gross); quote raw/display + stored audio match; grounded title (use page title); web/Electron parity + migration.
- **P2 — Template library on the foundation:** map Standard Summary + Quick Gist (free), then Study Notes, Meeting Minutes, Executive Brief, Action Plan, Interview Notes, Sales Recap, Content Repurposing, Research Notes (premium).
- **P3 — Controls + custom templates:** depth/tone/audience/language/counts/attribution; user-editable template manifests; evidence UI (timestamp/speaker/confidence chips); "smart" model synthesis.

Ship P0 behind a flag; gate on the corpus passing before P1 touches the visible Review pane.

---

## 15. Exact files expected to change

- **`shared/engine/engine.py`** — replace the five handlers (`summarize`, `extract_review_details`, `extract_key_quotes`, `suggest_followups`, `run_action`) with the pipeline: `normalize`, `detect_profile`, `segment`, `extract_segment`, `merge_dedup`, `validate`, `build_cao`, `render_template`. Keep transcription + meeting loop. New prompt versions under a versioned prompt module.
- **`shared/engine/backend/transcription.py`** — model-tier policy (cheap extract / smart synthesis), a normalization helper; expose word spans/offsets consistently.
- **New `shared/engine/analysis/`** — `schema.py` (CAO + Item shapes), `prompts/` (profile-v1, extract-v1, reduce-v1, normalize-v1, title-v1), `validators.py`, `segment.py`, `merge.py`.
- **`platforms/web/server.js`** — new `/api/analyze` (build+persist CAO) and `/api/render` (project template); rewire `/api/summarize` etc. to read CAO or deprecate; unified persistence whitelist; `pageTitle` capture in `import_url`.
- **`platforms/web/history-store.js`** — add `raw_json`/`norm_json`/`cao_json`/`analysis_version`/`transcript_version`; migration; parity constant.
- **`platforms/electron/main.js`** — matching IPC (`analyze`, `render`, `update_history_text` with the shared whitelist incl. CAO); fix `chapters`/field parity by adopting the CAO blob.
- **`platforms/tauri/…`** (if present) — same store/IPC parity.
- **`shared/frontend/index.html`** — one `renderCao(templateId)` path; remove per-open regeneration; template picker; edit/version/staleness UI; evidence chips; section suppression from `eligibleSections`; title from `pageTitle`.
- **`docs/summary-audit/corpus/`** — fixtures + expectations + AC harness.

---

## 16. Open architectural questions

1. **Extraction model:** is gpt-4o-mini accurate enough for grounded classification, or does correct decision/commitment/CTA separation require gpt-4o for the extract/validate stages (cost vs correctness)? Needs a corpus bake-off.
2. **Normalization boundary:** how much is deterministic rules vs LLM? A pure-LLM normalize risks changing meaning; a pure-rules normalize misses novel terms. Proposed hybrid — where exactly is the line, and how is the known-terms map maintained?
3. **Local/offline path:** WhisperClick supports local capture with no API key. Does the CAO pipeline need a local-LLM fallback (degraded, still full-coverage) or is grounded analysis simply "add a key"? Impacts free-tier promise.
4. **Segmentation of unstructured content:** window size/overlap defaults, and how to avoid splitting a claim across a boundary (overlap + merge should cover it — needs validation on `voice-note-unstructured`).
5. **Dedup thresholds:** exact similarity/overlap cutoffs to merge repeated claims without collapsing distinct ones — tune on the corpus.
6. **Validation aggressiveness:** precision vs recall of suppression. A too-strict validator hides real decisions; too-loose reintroduces the audit's failures. What's the acceptable false-suppression rate?
7. **CAO size / storage:** for multi-hour transcripts the CAO (with per-item evidence spans) can be large. Store inline JSON vs separate evidence table? Pagination for the evidence UI?
8. **Speaker dependency:** several sections (commitments, sales recap) want speaker attribution, but diarization is slow/absent on long audio (audit finding). Do those templates degrade gracefully to "speaker unknown," and is diarization a prerequisite for Meeting Minutes / Sales Recap?
9. **Streaming/meeting mode:** how does the live meeting path (incremental transcript) build a CAO incrementally vs. one final analysis at end-of-meeting?
10. **Versioning UX:** how many prior versions to keep, and how to present "regenerated but your edit was preserved" without confusing the user.

---

*End of specification. Awaiting review before any production implementation.*
