'use strict';
// pipeline-acceptance.test.js — the enable-gate proofs (spec §0.4) that are
// provable deterministically in Phase 0:
//   - Ashley Gross fixture: 10 structural units; no fabricated decisions/
//     commitments; advice/CTA separated; exact evidence-linked quotes.
//   - zero generation on open (opening a note makes ZERO model calls).
//   - a partial run is visibly partial + resumable.

const test = require('node:test');
const assert = require('node:assert/strict');

const text = require('../text');
const pipeline = require('../pipeline');
const { createFixtureAdapter, createNullAdapter } = require('../model-adapter');
const { createAnalysisStore } = require('../store');
const { createIdFactory } = require('../ids');
const ashley = require('../corpus/ashley-gross');

function countingAdapter(inner) {
  const calls = { profile: 0, detectStructure: 0, extract: 0, total: 0 };
  return {
    calls,
    ...inner,
    async profile(a) { calls.profile++; calls.total++; return inner.profile(a); },
    async detectStructure(a) { calls.detectStructure++; calls.total++; return inner.detectStructure(a); },
    async extract(a) { calls.extract++; calls.total++; return inner.extract(a); },
    capabilities() { return inner.capabilities(); },
    modelPolicy: inner.modelPolicy,
  };
}

test('Ashley Gross acceptance: 10 units, no phantom decisions/commitments, advice≠CTA, exact quotes', async () => {
  const { canonical, expectations } = ashley.build();
  const adapter = createFixtureAdapter(ashley.build().recorded);
  const run = await pipeline.buildAnalysisRun({
    noteId: 'note_ashley', rawTranscript: canonical, adapter,
    ids: createIdFactory(), now: () => 1,
  });

  // structure: exactly the 10 questions
  assert.equal(run.cao_json.structure.length, expectations.structureUnits, '10 structural units');

  // presence: no fabricated decisions/commitments/actions; advice + CTA + quotes present
  const p = run.cao_json.presence;
  assert.equal(p.decisions, false, 'no fabricated decisions');
  assert.equal(p.commitments, false, 'no fabricated commitments');
  assert.equal(p.actions, false, 'no fabricated action items');
  assert.equal(p.advice, true);
  assert.equal(p.ctas, true);
  assert.equal(p.quotes, true);

  // advice and CTA are DISTINCT kinds (separation), both present in items
  const kinds = new Set(run.cao_json.items.map((it) => it.kind));
  assert.ok(kinds.has('advice') && kinds.has('cta'), 'advice and cta both kept as distinct kinds');
  assert.ok(!kinds.has('decision') && !kinds.has('commitment'), 'no decision/commitment survived');

  // the adversarial hallucinations were suppressed with the right reasons
  const allIssues = run.cao_json.validation.issues.flatMap((i) => i.issues || []);
  for (const reason of expectations.suppressed) assert.ok(allIssues.includes(reason), `suppressed: ${reason}`);

  // exact evidence-linked quotes: rawText equals the transcript slice for its range
  const quotes = run.cao_json.items.filter((it) => it.kind === 'quote');
  const clean = quotes.find((q) => q.rawText.includes(expectations.quoteRawContains));
  assert.ok(clean, 'clean quote present');
  const range = text.resolvePhraseRange(text.tokenize(canonical).words, expectations.quoteRawContains);
  const { cps, words } = text.tokenize(canonical);
  assert.equal(clean.rawText, text.rawTextForRange(cps, words, range[0], range[1]), 'quote rawText is the exact transcript slice');

  // the RY→ROI quote preserves raw verbatim and records the correction
  const roy = quotes.find((q) => q.corrections && q.corrections.length);
  assert.ok(roy, 'corrected quote present');
  assert.ok(roy.rawText.includes(expectations.royRawContains), 'raw keeps "RY"');
  assert.ok(roy.displayText.includes(expectations.royDisplayContains), 'display shows "ROI"');
  assert.equal(roy.corrections[0].from.includes('RY'), true);

  // full processing coverage
  assert.equal(run.analysis_status, 'complete');
  assert.equal(run.processing_coverage.complete, true);
});

test('zero generation on open: building calls the model; opening does NOT', async () => {
  const { canonical } = ashley.build();
  const adapter = countingAdapter(createFixtureAdapter(ashley.build().recorded));
  const ids = createIdFactory();
  const store = createAnalysisStore(':memory:', { now: (() => { let n = 1; return () => n++; })() });

  // build (model IS called) and persist run + artifact
  const run = await pipeline.buildAnalysisRun({ noteId: 'note_z', rawTranscript: canonical, adapter, ids, now: () => 1 });
  store.putRun(run);
  const artifact = pipeline.renderArtifact({ analysisRun: run, ids });
  store.putArtifact(artifact);
  assert.ok(adapter.calls.total > 0, 'building made model calls');

  // open: read persisted state — MUST make zero further calls
  const before = adapter.calls.total;
  const opened = pipeline.openAnalysis(store, 'note_z');
  assert.ok(opened && opened.run && opened.artifact, 'open returns persisted run + artifact');
  assert.equal(adapter.calls.total, before, 'opening a note made ZERO new model calls');
  assert.equal(opened.run.analysis_run_id, run.analysis_run_id);
});

test('template re-render reuses the same AnalysisRun (no re-extraction)', async () => {
  const { canonical } = ashley.build();
  const adapter = countingAdapter(createFixtureAdapter(ashley.build().recorded));
  const run = await pipeline.buildAnalysisRun({ noteId: 'note_r', rawTranscript: canonical, adapter, ids: createIdFactory(), now: () => 1 });
  const after = adapter.calls.total;
  const a1 = pipeline.renderArtifact({ analysisRun: run, templateId: 'brief' });
  const a2 = pipeline.renderArtifact({ analysisRun: run, templateId: 'detailed' });
  assert.equal(adapter.calls.total, after, 're-rendering a different template made no model calls');
  assert.equal(a1.analysis_run_id, a2.analysis_run_id, 'both artifacts reference the same run');
  assert.notEqual(a1.template_id, a2.template_id);
});

test('no capable model -> transcript-only setup-required (never fake analysis)', async () => {
  const { canonical } = ashley.build();
  const run = await pipeline.buildAnalysisRun({ noteId: 'note_n', rawTranscript: canonical, adapter: createNullAdapter(), ids: createIdFactory() });
  assert.equal(run.setupRequired, true);
  assert.ok(!run.cao_json, 'no analysis object fabricated when no model is available');
});

test('a failed segment yields a visibly partial, resumable run', async () => {
  const { canonical } = ashley.build();
  const base = createFixtureAdapter(ashley.build().recorded);
  // adapter that fails the FIRST extract call, succeeds afterwards
  let n = 0;
  const flaky = { ...base, capabilities: () => base.capabilities(), modelPolicy: base.modelPolicy,
    async profile(a) { return base.profile(a); },
    async detectStructure(a) { return base.detectStructure(a); },
    async extract(a) { if (n++ === 0) throw new Error('boom'); return base.extract(a); },
  };
  const run = await pipeline.buildAnalysisRun({ noteId: 'note_f', rawTranscript: canonical, adapter: flaky, ids: createIdFactory(), now: () => 1 });
  assert.equal(run.analysis_status, 'partial');
  assert.equal(run.processing_coverage.complete, false);
  assert.ok(run.resumePlan.length >= 1, 'resume plan lists the failed segment(s)');
});
