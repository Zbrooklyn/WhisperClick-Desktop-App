# shared/analysis — Summary System v2 foundation (Phase 0)

Foundation for the replacement summary system described in
[`docs/summary-system-replacement-spec.md`](../../docs/summary-system-replacement-spec.md)
(approved 2026-07-19, see spec §0). **Everything here is behind the
`WC_ANALYSIS_V2` flag and is not wired into the visible Review experience.**
Importing these modules has no side effects and does not touch production data.

## What Phase 0 delivers

| Module | Responsibility | Contract point |
| --- | --- | --- |
| `flag.js` | The single `WC_ANALYSIS_V2` gate (default OFF) | — |
| `ids.js` | Typed ids: `arun_ / rart_ / item_ / evid_ / seg_`, asserted at boundaries | §0.2 separate id types |
| `text.js` | Canonical text (NFC + LF), **code-point** offsets, stable raw-word tokenizer, cross-platform offset rules | §0.2 raw-word anchoring |
| `evidence.js` | Evidence anchor: primary raw word range, derived char/time offsets, `transcriptMatched / audioMapped / audioVerified` | §0.2 source-of-record ≠ verified |
| `quotes.js` | Quotes **constructed** from raw ranges; corrections keep raw verbatim + record the change | §0.2 backend-constructed quotes |
| `validate.js` | Grounding, owner/due abstention, decision lifecycle + conflict-preservation, final presence from survivors | §0.1 #6, §0.2 |
| `segment.js` | Window tiling (full coverage) + global structure merge | §0.1 #4, §0.2 complete-source structure |
| `profile.js` | Provisional (sample-only) content profile; presentation eligibility that never suppresses evidence | §0.2 no hard suppression |
| `extract.js` | Extraction prompt-builders + normalization into evidence-anchored items | §0.2 model selects ranges, not text |
| `merge.js` | Dedup order: exact/overlap → lexical → adjudication (no embeddings) | §0.1 #5 |
| `coverage.js` | Processing-coverage tracker + resume plan | §0.2 processing coverage (not recall) |
| `schema.js` | Versioned contracts, separation guards, and the **single** field sets web+Electron persist | §0.2 AnalysisRun ⟂ RenderedArtifact |
| `store.js` | Dedicated versioned `analysis_runs` + `rendered_artifacts` tables (node:sqlite), retention | §0.1 #7, #10 |
| `migrate.js` | Non-destructive migration (adds tables, never touches `recordings`) | Phase 0 boundary |
| `model-adapter.js` | Capability-tier seam; fixture + null adapters (live adapter is Phase 1) | §0.1 #1, #3 |
| `pipeline.js` | Orchestrator; `openAnalysis()` reads persisted state with **zero** model calls | §0.4 zero-generation-on-open |

## Proof

```
node --test shared/analysis/test/*.test.js     # 30 unit/contract tests
node shared/analysis/corpus/gate.js            # human-readable acceptance gate
```

The acceptance gate (`corpus/gate.js`) runs the real audited Ashley Gross
transcript through the pipeline and asserts the spec §0.4 criteria that are
deterministically provable in Phase 0: 10 structural units, no fabricated
decisions/commitments, advice/CTA kept as distinct kinds, exact evidence-linked
quotes (including the `RY → ROI` correction with raw preserved), full processing
coverage, and zero model calls when a note is re-opened.

## Not yet done (Phase 1+)

- The live model adapter (`createLiveAdapter`) is a stub — no real model calls
  happen in Phase 0. The corpus uses a **recorded** extraction so the
  deterministic foundation is proven offline.
- The live-model corpus bake-off that gates the economical extraction tier
  (spec §0.1 #1) is Phase 1.
- No call site is wired yet: `server.js` / Electron `main.js` do not import this.
  Phase 0 deliberately does not change the visible Review experience.
