# Gold-data governance & changelog

Governance for the evaluation corpus used to select an extraction tier. The
purpose of these rules is blunt: **an evaluation you edit until the model passes
is not an evaluation.** Every gold-label change after a model has been run
against that label must be recorded here, in full, before the next run.

## Policy

1. **Corpus version increments** on any gold change (`CORPUS_VERSION` in
   `shared/analysis/corpus/fixtures.js`). Reports record the version they ran on.
2. **Every change requires**, in the entry below: the exact source span quoted
   verbatim, a written justification grounded in the SOURCE (not in model
   output), the previous label, the new label, the effect on prior scores, and
   the approval status.
3. **Never silently edit a fixture until the model passes.** A change justified
   only by "the model disagreed" is forbidden. The test is: *would this label be
   wrong even if no model had ever run?* If not, the label stands and the model
   fails.
4. **Every historical bake-off report is preserved.** Failed reports are never
   overwritten, amended, or deleted — they are the record of what was true at the
   time. Reports are timestamped and immutable.
5. **Development vs holdout.** Tuning happens against the development corpus
   only. The holdout is frozen and is not inspected during repair. After a failed
   holdout run, the result is recorded and any further tuning requires a NEW
   holdout version or additional unseen fixtures.
6. **Independent review.** Entries below are marked with their approval state.
   Entries marked `SELF-DECLARED` were made by the implementing agent and are
   explicitly flagged for the owner's review rather than being treated as settled.

## Changelog

### v1.0.0 — 2026-07-20 — initial corpus
Five fixtures: Ashley Gross (real audited transcript), an authored sprint-planning
meeting, and three adversarial fixtures (hypothetical decision-lookalike,
promotional CTA, audience advice). No prior scores affected.

---

### v1.1.0 — 2026-07-20 — two commitment labels corrected
**Status: SELF-DECLARED — flagged for owner review.** Both changes were made by
the implementing agent during the Phase-1A bake-off, after the models had run.
They are justified by the source text, but the owner should verify that judgement
because the pattern (relabelling after seeing output) is exactly what rule 3
guards against.

**Change 1 — `ashley-gross-ai-consultant`**
- Source span (verbatim): *"I will be putting out a lot more announcements about
  this because I think that this is more of an open-ended question"*
- Previous label: `commitments: []` with `mustNotProduce.commitments: ['*']`
- New label: `commitments: ["I will be putting out a lot more announcements about this"]`
- Justification: the sentence is a literal first-person future promise and meets
  the stated definition of a commitment. The contract requires no *fabricated*
  commitments; a genuinely stated one is a correct extraction, not a failure. The
  original label asserted "zero commitments", which was wrong about the source
  regardless of any model.
- Effect on prior scores: `gpt-4o-mini` commitment precision on this fixture rises
  from 0.00 to 1.00 (3 runs, bake-off `2026-07-20T00-18-58`). `gpt-4o` loses
  recall on this fixture because it did not find the commitment.

**Change 2 — `adversarial-hypothetical`**
- Source span (verbatim): *"We'll talk again on Thursday."*
- Previous label: `commitments: []` with `mustNotProduce.commitments: ['*']`
- New label: `commitments: ["We'll talk again on Thursday"]`
- Justification: the fixture exists to test hypothetical **decisions**. Blanket-
  banning commitments in a text whose closing line is an ordinary first-person
  commitment was a labelling error. Under Phase 1B this utterance is additionally
  classified `conversationalFollowup`, so it is preserved as a commitment fact but
  is not task-eligible.
- Effect on prior scores: `gpt-4o-mini` commitment precision on this fixture rises
  from 0.00 to 1.00 (3 runs, bake-off `2026-07-20T00-31-14`).

---

### v1.2.0 — pending — Phase 1B semantic-event corpus
Planned: re-express gold in terms of primitive speech events plus derived-task
expectations, add the full fixture inventory, and split development from a frozen
holdout. Not yet applied.

## Report index (immutable)

- `bakeoff-2026-07-20T00-15-42` — first live smoke (1 run, mini). FAILED: fabricated decisions from hypothetical language; structure 8/10.
- `bakeoff-2026-07-20T00-18-58` — 2 models x 3 runs. FAILED: commitment mislabel (corpus bug), structure 8-9/10, invented due dates.
- `bakeoff-2026-07-20T00-24-51` — after modality guard + chunked structure. mini PASSED all gates; gpt-4o failed 1/15 (structure 11).
- `bakeoff-2026-07-20T00-31-14` — after evidence-window widening. REGRESSION: borrowed evidence across turns.
- `bakeoff-2026-07-20T00-35-45` — after bounded window. Both tiers fail; no selection.
