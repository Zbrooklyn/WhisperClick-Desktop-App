# Summary System Replacement — Review Addendum & Decision Register

**Status:** **APPROVED 2026-07-19.** Companion to [`summary-system-replacement-spec.md`](./summary-system-replacement-spec.md) · no production behavior changed during Phase 0.
This document answers the seven review concerns in specification detail (Part A) and resolves the ten open architectural questions with recommendation, strongest alternative, consequences, and reversibility (Part B).

---

## A0. APPROVED RESOLUTIONS (2026-07-19) — authoritative

Edward approved the architecture on 2026-07-19. The ten questions in **Part B** are now resolved as recorded in the spec's [§0.1 decision register](./summary-system-replacement-spec.md#01-approved-decision-register-locked), and the mandatory contract amendments in [§0.2](./summary-system-replacement-spec.md#02-mandatory-contract-amendments-locked) are binding. Where Part B's earlier *recommendation* differs from the approved decision, **the approved decision in spec §0 wins**; Part B is retained as the reasoning record, not as the live contract. Specifically, the approved outcomes are:

1. Economical extraction tier only after a corpus bake-off; models chosen by **capability tier**, not model name.
2. Rules-first normalization; meaning-changing corrections + provenance are base correctness.
3. No bundled offline AI in v1; configured local models supported; otherwise transcript-only mode with an explicit setup state.
4. Adaptive, structure-aligned segmentation; fallback ~1,800-token sentence-aligned windows.
5. Dedup: exact/span-overlap → lexical → adjudication; no embeddings in v1.
6. Bias to suppression/abstention for decisions, commitments, owners, due dates.
7. Dedicated versioned analysis-run store (not a `cao` field on the note).
8. Speaker templates degrade to unknown speaker; diarization never blocks.
9. Live: provisional incremental + one authoritative final consolidation.
10. Keep last 5 ordinary versions; user-edited/pinned exempt.

Plus the contract amendments: **AnalysisRun ⟂ RenderedArtifact**, typed ids, raw-word-range primary evidence, `transcriptMatched|audioMapped|audioVerified`, backend-constructed quotes, post-validation presence flags, complete-source structure detection, "processing coverage" (not guaranteed recall), relationship-evidence spans + decision lifecycle, and the versioned analysis-run store schema. See spec §0 for the binding text.

---

# Part A — Review-concern responses

## A1. Model-call architecture

### A1.1 The recommended pipeline is **adaptive**, not fixed at "7–11 calls"

The earlier "~7–11" figure was the *fully-separated* stage count on the 18-minute fixture. The recommended default folds several stages to cut calls and latency:

- **Normalize** → deterministic rules (0 LLM calls) by default. (LLM punctuation is optional/premium — A3.)
- **Validation** → folded into extraction (each extract call classifies with the taxonomy + evidence). Deterministic checks add 0 calls. A separate adjudication call fires only for genuinely ambiguous flagged items (usually 0, capped at 1).
- **Title** → folded into the reduce call (0 extra) unless a page title exists (then 0).

That leaves the **load-bearing calls: Profile (1) + Extract (S, one per segment) + Reduce (1)**, and short inputs collapse Profile into the single Extract call.

**Routing by size:**
- **≤ ~6,000 tokens (~20 min):** single-pass — **1 call** that returns profile + grounded items for the whole transcript (fits context comfortably; recall is reliable at this length). Optional +1 reduce for synthesis on the upper end.
- **> ~6,000 tokens:** chunked map-reduce — **Profile(1) + Extract(S) + Reduce(1)**.

### A1.2 Per-call breakdown

| Call | Purpose | Input | Output | Once / per-chunk | Seq / parallel | Why not combined | Failure & retry | Latency |
|---|---|---|---|---|---|---|---|---|
| **Profile** | multidimensional content profile + structure units + eligible/suppressed sections | representative sample (head + sampled middle + tail; whole text if small) | `contentProfile` + `structure` JSON | **once** | before extract (seq) | must precede segmentation/eligibility so extraction knows which sections are live; cheap and small | on parse/HTTP fail: 1 retry, then fall back to a rules-only heuristic profile (never blocks) | ~2–4s |
| **Extract** | grounded items per taxonomy field, with segment-local char offsets + quoteExact flags + tentative class | one segment of normalized text, prefixed with its global offset + the eligible-section list | `Item[]` per field for that segment | **per chunk** (1 per segment; 1 total when single-pass) | **parallel** across segments (bounded pool) | isolating segments is what guarantees coverage + per-segment retry + reliable offsets; a single mega-call loses middle recall and coverage tracking | per-segment: 2 retries w/ backoff; on final failure the segment is marked `failed` in the coverage record (A4) — **never silently dropped** | ~3–8s per segment (parallel ⇒ ≈ slowest wave) |
| **Reduce** | dedup adjudication of near-duplicates, thesis + framework synthesis, title (if no page title) | the *merged item list only* (not the transcript again) | thesis, frameworks, resolved dups, title | **once** | after all extracts (seq barrier) | needs the full cross-segment item set; runs on a small payload (items, not transcript) so it stays cheap | 2 retries; on failure, skip synthesis (items still render) — degrade, don't fail | ~3–6s |
| **Adjudicate** (conditional) | resolve only items the deterministic validator flagged ambiguous | the flagged item + its evidence span | keep / reclassify / drop | **≤1**, usually 0 | after validate | most misclassifications are caught deterministically (A2); this is the rare tie-breaker | 1 retry; on failure the item is **suppressed** (abstain) | ~2s |

Deterministic (0-call) stages: normalize (rules), segment, merge/dedup mechanics, grounding/quote-exact/owner-evidence checks, coverage accounting, rendering, persistence.

### A1.3 Cost & latency by length (recommended pipeline, gpt-4o-mini)

Assumptions: words≈dur×180/min; tokens≈words×1.33; extract reads transcript ×1.1 (overlap); profile+reduce add a few k tokens; output 1–3k tokens; parallel pool = 8; mini ≈ $0.15/1M in, $0.60/1M out (illustrative).

| Length | ~Tokens | Segments | LLM calls | Input tok processed | **Cost/analyze** | Wall-clock (parallel) |
|---|---|---|---|---|---|---|
| 5 min | ~1.2k | 1 (single-pass) | **1–2** | ~1.5k | **~$0.001** | ~4–7s |
| 20 min | ~4.8k | 1–3 | **2–5** | ~6k | **~$0.002** | ~8–15s |
| 60 min | ~14.7k | ~8 | **~10** | ~19k | **~$0.005** | ~12–22s |
| 180 min | ~44k | ~24 | **~26** | ~57k | **~$0.012** | ~20–40s (3 parallel waves) |

Even a 3-hour transcript is ~1¢ and completes in well under a minute. **And opens are free** (0 calls), which is where today's system silently re-bills. Net spend drops versus today despite more calls at analyze-time.

### A1.4 Lower-call alternative — single mega-call

One call: whole transcript → full CAO. (gpt-4o-mini's 128k context fits even 180 min.)

| Dimension | Single mega-call | Recommended (adaptive map-reduce) |
|---|---|---|
| Calls | **1** always | 1 (short) → ~26 (3 hr) |
| Latency | lowest for long inputs (no waves) | slightly higher on very long |
| Cost | lowest | still ~1¢ worst case |
| **Accuracy** | **degrades on long input** ("lost-in-the-middle" recall loss; the audit's exact failure mode returns) | reliable recall per segment |
| **Coverage guarantee** | **unverifiable** — can't prove every range was considered | tracked per segment (A4) |
| Retry granularity | all-or-nothing | per-segment |
| Grounding offsets | unreliable over 44k tokens | validated per segment |
| Complexity | lowest | higher (segmentation, merge, coverage) |

**Verdict:** single-pass is the right call for **short** inputs (already adopted, ≤6k tokens) where recall/coverage are safe; it is the wrong default for long inputs because it silently recreates the audit's coverage and recall failures. We do **not** optimize for token price alone — the recommended design accepts more calls specifically to keep coverage verifiable and latency bounded by parallelism.

---

## A2. Validation versus schema constraints

**Distinction:** the JSON schema *defines* fields; the **write-path validator** *enforces* invariants deterministically regardless of what the model returned. "Prevented" = enforced deterministically at write time. "Model-dependent" = relies on the extract model's initial tag (but is then re-checked).

### A2.1 Deterministically prevented (model cannot cause the bad state to persist)

- **Task with an unstated owner/due** — `owner`/`due` persist **only if** the cited `ownerEvidence`/`dueEvidence` span *literally contains* an owner token (NER/regex) or a date. The model may *propose* an owner; the validator re-reads the cited raw span and **drops the attribute if the span doesn't contain it.** Inferred owners/dates cannot survive.
- **Reconstructed / misquoted quote** — a `quoteExact` item's `rawText` must be a contiguous word run in `raw/N` (string match). No match → the quote is dropped, not shown with a dead timestamp.
- **Ungrounded item** — every item must cite a resolvable span with ≥ lexical-overlap floor between claim and span. Below floor → dropped.
- **Section that isn't eligible** — suppressed deterministically from `contentProfile.eligibleSections`.

### A2.2 Model-dependent, then caught by deterministic post-filters (defense in depth, 0 extra calls)

- **Advice mis-tagged as a task** → a `commitment` whose evidence span has **no explicit actor** (no first/second-person commissive: "I'll", "we will", named person + verb) is **auto-downgraded** to `audienceAdvice`/`recommendation`. A commitment structurally requires an actor; the validator checks the span for one.
- **Recommendation mis-tagged as a decision** → a `decision` whose span lacks **decision language** (decided / agreed / we'll go with / final) **and** `profile.presence.explicitDecisions=false` → downgraded to `recommendation`/`keyClaim`.
- **CTA mis-tagged as commitment** → promo markers (subscribe, like, link in comments/bio, follow, sign up + channel/newsletter reference) in the span route the item to `callsToAction` and **block** it from `commitments`.
- **Hypothetical mistaken for agreed action** → modal/conditional markers in the span (if we, we could, maybe, hypothetically, for example) set `hypothetical=true` → item is barred from `decisions`/`commitments`; may appear as `example`/`openQuestion`.
- **Reversed / retracted decision** → merge-stage rule: two `decision` items on the same topic with opposing polarity → keep the **later** (by `tStart`), mark the earlier `superseded=true`, surface both with a "changed later" note. (This is the one case that leans on discourse cues; residual risk noted below.)

### A2.3 Abstention rules (prefer omission over wrong assertion)

- Per-section confidence floors, **strict for strong sections**: an item enters `decisions`/`commitments` only if extraction confidence ≥ 0.7 **and** grounding passes **and** the classification post-filter passes. Otherwise it abstains (drops, or falls to a weaker section).
- Weak sections (`keyClaims`, `concepts`) use a lower floor (~0.5) — being wrong there is cheap.
- If a section would have **zero** surviving items after validation → **suppress the section** (never show an empty or filler section).
- Ambiguous residue (rare) → the single conditional Adjudicate call (A1.2); on its failure, abstain.

### A2.4 Residual risks (honest)

- **Retracted-decision detection** is the weakest link (needs discourse understanding). Mitigation is the polarity/timestamp merge rule + surfacing both; it will not catch subtle reversals. Flag as a corpus adversarial case (A7).
- **Sarcasm / rhetorical statements** can pass the actor/decision-language checks. Mitigation: extract prompt guidance + a corpus adversarial case; residual risk accepted for v1, not silently.

---

## A3. Transcript-normalization scope

Five categories, **different provenance weight**. Token-level records are kept **only** where meaning changes or alignment requires them.

| # | Category | Example | Meaning-changing? | Provenance stored |
|---|---|---|---|---|
| 1 | **Semantic term correction** | `RY`→`ROI`, `gender AI`→`generative AI` | **Yes** | **Full per-correction record:** rawSpan, normSpan, rawText, normText, tStart/tEnd, rawWordConfidence, reason, method(rule/llm), confidence. Inspectable + reversible in UI; **never applied to a quote's `rawText`.** |
| 2 | **Formatting / punctuation** | capitalization, commas, spacing | No | **No per-token records.** Store one norm-version flag (`punctuation: method@v1`) **plus a char-offset alignment map** (raw↔norm deltas) — the minimum needed for reliable span mapping, not a record per comma. |
| 3 | **Sentence-boundary reconstruction** | splitting a run-on into sentences | Rarely | Store the **list of inserted boundary offsets** (so segmentation is reproducible) + the alignment map. No semantic records. |
| 4 | **Uncertain interpretation** | low-confidence word the normalizer guessed | Possibly | **Full record as #1 + `uncertain=true` + alternatives considered.** Surfaced for user review; excluded from quotes; never silently trusted by strong sections. |
| 5 | **User-approved correction** | user confirms `RY`→`ROI` | Yes | Full record + `approvedBy=user` + timestamp; highest trust; **fed back into the custom-vocabulary map** for future notes. |

Rules: the **alignment map is always maintained** (categories 1–5) so any normalized span resolves to raw words → audio. **Detailed evidence is preserved for meaning-changing corrections (1, 4, 5); harmless formatting (2, 3) records only alignment, not semantics** — exactly per the review constraint.

---

## A4. Full-source-coverage definition (operational)

"100% coverage" is a **checked property**, not an aspiration:

> Every raw character range is assigned to ≥1 segment; every segment reaches a terminal state (`extracted` or `failed` after retries); and `union(extracted ranges) ∪ union(failed ranges) == whole transcript`, with `missingRanges == []`.

Tracked in a persisted **coverage record** on every CAO:

```jsonc
"coverage": {
  "totalChars": 18680, "totalTokens": 4620,
  "segments": [
    { "id": "seg-1", "rawRange": [0, 2400], "status": "extracted", "attempts": 1, "mergedInto": true },
    { "id": "seg-2", "rawRange": [2300, 4700], "status": "extracted", "attempts": 2, "mergedInto": true }
    // ...
  ],
  "failedRanges":  [],           // ranges whose segment failed after retries
  "missingRanges": [],           // ranges assigned to no segment — MUST be [] for complete
  "coveragePct": 1.0,
  "complete": true               // false if failedRanges or missingRanges non-empty
}
```

- `mergedInto` records that a segment's items participated in the merge stage (so a segment that "extracted" but contributed nothing is distinguishable from one that was dropped).
- **A generation with `complete=false` may never present as complete.** The Review pane shows a banner: *"Analyzed 92% — 2 sections couldn't be processed. [Retry]"* and a badge on the note. Reduce/synthesis still runs on the covered portion but is labeled partial.
- Acceptance tests AC-1 / AC-13 assert `coveragePct==1.0 && complete==true` on the corpus (except the deliberately-failed `missing-ranges` adversarial fixture, which asserts `complete==false` and a visible partial state).

---

## A5. Free-tier evidence visibility

Grounding is base correctness, so **basic verification is free**:

**Free tier sees:**
- **Quotes:** timestamp + tap-to-play; validated to exist verbatim in the raw transcript.
- **Decisions, commitments, action items, and major factual claims:** each exposes a **source reference** — at minimum a timestamp that jumps to that point in the transcript/audio, and a tap-to-expand of the underlying transcript sentence(s).
- **Suppression is visible:** the user can see that (e.g.) *Decisions* was correctly omitted for an educational video — a trust signal, free.
- Word-confidence flags on the transcript (already free).

**Premium adds (tooling, not truth):**
- Rich evidence browser: side-by-side transcript highlight, confidence heatmap, multi-span evidence per claim, filtering, and evidence export.
- Cross-note evidence search; per-claim "show all supporting passages."

**Boundary:** "where did this come from" (a timestamp / the source sentence) is **never** paywalled; the *interface for deep evidence exploration* is premium.

---

## A6. Offline & no-key behavior

Analysis requires a model. We never dress a deterministic gist as AI analysis.

| Condition | Product state | UI message | Persistence | Recovery path |
|---|---|---|---|---|
| **No cloud key, no local model** | Transcript-only (no analysis) | "Add an API key or set up a local model to analyze this note." Clear CTA; **no summary shown.** | Transcript + words persist; **no CAO.** | Add key/model → explicit **Analyze**. |
| **Offline, local model configured** | Analyzed locally (degraded) | "Analyzed with your local model" badge + quality note. | CAO with `model=local`, `quality=local` flag, full grounding. | Optional **Re-analyze with cloud** when back online (offered, not automatic). |
| **Offline, no local model** | Transcript-only | "You're offline and no local model is set up." | Transcript only. | Reconnect **or** configure a local model → Analyze. |
| **Local model available (user chose local mode)** | Analyzed locally | local badge | CAO tagged `local`. | Re-analyze with cloud optional. |
| **Online → connectivity fails mid-analysis** | Partial (resumable) | "Analysis paused — connection lost. [Resume]" + partial banner. | **Partial CAO** with completed segments + `coverage.complete=false`; completed segments **not** re-billed. | **Resume** processes only `failed`/`missing` ranges. Never presented as complete. |

**Deterministic fallback (if offered at all):** a purely extractive "Basic (no AI)" gist is **labeled as such**, produces **no decisions/commitments/quotes-with-claims** (those require grounded model extraction), and is never represented as equivalent to normal analysis. Recommended default: **do not** auto-produce it — gate on a model instead (see B-Q3).

---

## A7. Evaluation expansion

The 13-fixture golden corpus (spec §9) stays; an **adversarial tier** is added. The harness is **data-driven** — a fixture is `transcript.txt` + `expectations.json`; adding a case adds a folder, no harness code change. The `expectations.json` schema gains fields, and each case gets a dedicated acceptance check:

| Adversarial case | New expectation field(s) | Acceptance check |
|---|---|---|
| Hypothetical vs final decision | `expectedHypothetical[]` | AC-14: hypotheticals never in `decisions`/`commitments` |
| Retracted / reversed decision | `expectedSuperseded[]` | AC-15: earlier decision marked `superseded`, later kept, both surfaced |
| Rejected action item | `expectedRejected[]` | AC-16: rejected item not shown as a commitment |
| Conflicting speakers | `speakerTruth[]` | AC-17: attribution matches or abstains (no wrong owner) |
| Speaker-attribution error (seeded) | `speakerTruth[]` | AC-17b: mis-attribution downgraded to "speaker unknown," not asserted |
| Sarcasm / rhetorical | `sarcasmSpans[]` | AC-18: sarcastic line not a literal claim/decision |
| Repeated quotations | `duplicateQuotes[]` | AC-19: dedup to one item with N evidence spans |
| Missing transcript ranges (seeded fail) | `expectedMissing[]` | AC-20: `complete=false`, partial banner, no silent completeness |
| Multilingual / code-switched | `languages[]`, `codeSwitchSpans[]` | AC-21: handled or flagged; no fabricated translation-as-fact |
| Extremely long (> limits) | `sizeClass:"huge"` | AC-22: `coveragePct==1.0`, bounded latency |
| Very short / empty | `sizeClass:"tiny|empty"` | AC-23: graceful minimal output; **no fabricated sections**; empty → clean empty state |

These sit alongside the 13 base fixtures under `docs/summary-audit/corpus/` and run in the same CI gate; any regression on any case fails the build.

---

# Part B — Decision register (the ten open questions)

**Framing — the real lock-in is not in this list.** The load-bearing, expensive-to-change commitments are **the CAO schema contract (spec §1)** and **the evidence model (spec §5)** — everything renders and persists against them, so once notes exist they are costly to reshape. Get those right. The ten questions below are, by contrast, **mostly reversible tuning** around that stable core; the few with real lock-in are flagged.

Legend: **Reversible** = a config/param/threshold or additive change. **Lock-in** = expensive to change after notes persist or a promise is made.

---

**Q1 — Extraction model: gpt-4o-mini vs gpt-4o for extract/validate.**
- **Recommendation:** gpt-4o-mini for extraction, with the deterministic post-filters (A2) carrying correctness; reserve gpt-4o for *premium* synthesis (reduce) only. Confirm with a corpus bake-off before locking defaults.
- **Strongest alternative:** gpt-4o for extract+validate for higher base classification accuracy.
- **Consequences:** mini → cheap/fast, correctness leans on validators, more pre-filter misclassification to catch; 4o → ~10–25× cost, better raw classification, slower, threatens the "free = full quality" promise.
- **Reversibility:** **Reversible** (model is a parameter). Low lock-in — decide empirically, change anytime.

**Q2 — Normalization boundary: rules vs LLM.**
- **Recommendation:** rules-first (deterministic term map + alignment) as the base; LLM punctuation as an optional/premium enhancement.
- **Strongest alternative:** LLM-primary normalization for better readability out of the box.
- **Consequences:** rules → safe, zero meaning-drift, misses novel terms; LLM-primary → nicer prose, real risk of altering meaning, adds a call.
- **Reversibility:** **Reversible** — *provided* the correction-map schema (A3) already supports both `method: rule|llm`, which it does. Adding the LLM pass later is additive.

**Q3 — Offline / no-key path.**
- **Recommendation:** gate analysis on a model (no fake summary); support a configured local model; if any extractive fallback exists, label it "Basic (no AI)" and disable decisions/commitments.
- **Strongest alternative:** bundle a small local model so analysis always works with no key.
- **Consequences:** gate → honest, simpler, but free/no-key users get transcript-only until they add a model; bundle → always-on analysis but larger app, quality/parity burden, and a **hard-to-retract promise**.
- **Reversibility:** technically **Reversible** (can add local later), but the *free-tier promise* is **semi-lock-in** — if you promise offline AI analysis you can't quietly walk it back. **Decide the promise now**, implement later.

**Q4 — Segmentation defaults (window/overlap; single-pass threshold).**
- **Recommendation:** structure-aligned segments when structure exists; else ~1,800-token windows, ~150-token overlap, sentence-aligned; single-pass under ~6k tokens.
- **Strongest alternative:** fixed small windows always (predictable, more calls).
- **Consequences:** adaptive → fewer calls short, reliable long; fixed → simpler but wasteful on short and riskier on long.
- **Reversibility:** **Reversible** (pure tuning).

**Q5 — Dedup thresholds / method.**
- **Recommendation:** lexical (Jaccard ≥ 0.6 or span-overlap > 0.6), conservative (prefer keeping distinct); tune on the corpus.
- **Strongest alternative:** embedding-similarity dedup.
- **Consequences:** lexical → cheap, misses paraphrased duplicates; embedding → better dedup, adds an embeddings call/dependency.
- **Reversibility:** **Reversible** (threshold + method swap).

**Q6 — Validation aggressiveness (precision vs recall of suppression).**
- **Recommendation:** bias to **suppression/abstention** for strong sections (decisions/commitments) — prefer false-suppression over false-assertion; permissive for weak sections; thresholds per-section config.
- **Strongest alternative:** balanced defaults to avoid ever hiding a real decision.
- **Consequences:** strict → trustworthy, may occasionally hide a real decision (recoverable: user lowers strictness / "show possible decisions"); balanced → risks reintroducing the audit's exact failures.
- **Reversibility:** **Reversible** (thresholds) — but the *default stance* is a product-trust call worth making deliberately.

**Q7 — CAO storage: inline JSON blob vs normalized evidence table.**
- **Recommendation:** inline JSON CAO (evidence spans inline within items) for v1; add a separate evidence-index table only if/when the premium evidence browser needs querying at scale.
- **Strongest alternative:** relational evidence table from day one.
- **Consequences:** inline → simple, ideal for single-note render, large blobs on multi-hour notes; table → queryable, more schema/migration surface now.
- **Reversibility:** **Partial lock-in** — the storage *layout* is costly to migrate later, but manageable **if the CAO *field contract* stays stable** (design items so evidence can be externalized without changing the item shape). This is the second-most-important thing to get right after the schema itself.

**Q8 — Speaker dependency for speaker-oriented templates.**
- **Recommendation:** templates degrade gracefully to "speaker unknown"; diarization is an enhancement that fills `speakers`, **not** a prerequisite for Meeting Minutes / Sales Recap.
- **Strongest alternative:** require diarization for those templates.
- **Consequences:** graceful → always renders, less precise attribution; required → blocks templates on diarization, which the audit found times out on long audio.
- **Reversibility:** **Reversible.**

**Q9 — Streaming / live-meeting incremental CAO.**
- **Recommendation:** extract incrementally per audio chunk into a *provisional* CAO for the live view, then run **one** consolidation (merge + validate) at end-of-meeting for the authoritative CAO.
- **Strongest alternative:** fully incremental CAO updated live every chunk.
- **Consequences:** final-consolidation → simpler, correct final result, provisional live view; full-incremental → richer live UX, more complexity and churn risk.
- **Reversibility:** **Reversible** to enhance later, but **medium lock-in** in the meeting-mode data flow — design the CAO to accept incremental appends now so the upgrade path stays open.

**Q10 — Versioning UX / retention.**
- **Recommendation:** keep the last **5** versions; inline "regenerated — your edits preserved" note; version history behind a control; never auto-discard a user-edited version.
- **Strongest alternative:** keep only current + previous (or unlimited).
- **Consequences:** N=5 → bounded storage, enough history; only-last → loses history; unlimited → storage growth.
- **Reversibility:** **Reversible** (retention policy).

### Lock-in summary

- **Hard lock-in (decide carefully, expensive later):** the **CAO schema contract** and the **evidence model** (spec §1/§5 — not in the Q-list but the real foundation); **Q3's free-tier promise** (product, not code); **Q7's storage layout** (mitigated by a stable field contract).
- **Medium:** **Q9** meeting-mode data flow.
- **Reversible tuning:** Q1, Q2, Q4, Q5, Q6, Q8, Q10.

---

## Approval boundary (restated)

No production summary behavior changes. Committable now (and committed): the audit, this spec + addendum, schemas, fixtures/expected-output files, and evaluation *design*/scripts that do not touch production paths. Implementation phases (spec §14) begin only on your approval of this specification and your decisions on the register above — with special attention to the hard-lock-in items (schema/evidence contract, Q3 promise, Q7 storage).
