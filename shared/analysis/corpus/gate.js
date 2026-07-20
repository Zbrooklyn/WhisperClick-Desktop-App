#!/usr/bin/env node
'use strict';
// gate.js — human-readable acceptance-gate runner (spec §0.4).
//
// Prints a plain PASS/FAIL report for the deterministically-provable enable-gate
// criteria. This is the same logic the automated tests assert; it exists so the
// gate result can be captured as evidence. Run: `node shared/analysis/corpus/gate.js`.

const text = require('../text');
const pipeline = require('../pipeline');
const { createFixtureAdapter } = require('../model-adapter');
const { createAnalysisStore } = require('../store');
const { createIdFactory } = require('../ids');
const ashley = require('./ashley-gross');

const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond, detail: detail || '' }); }

(async () => {
  const { canonical, expectations } = ashley.build();

  // --- build once (model calls happen here) ---
  const counter = { n: 0 };
  const inner = createFixtureAdapter(ashley.build().recorded);
  const adapter = {
    modelPolicy: inner.modelPolicy, capabilities: () => inner.capabilities(),
    async profile(a) { counter.n++; return inner.profile(a); },
    async detectStructure(a) { counter.n++; return inner.detectStructure(a); },
    async extract(a) { counter.n++; return inner.extract(a); },
  };
  const run = await pipeline.buildAnalysisRun({ noteId: 'gate', rawTranscript: canonical, adapter, ids: createIdFactory(), now: () => 1 });
  const buildCalls = counter.n;

  check('structure = 10 units', run.cao_json.structure.length === expectations.structureUnits, `${run.cao_json.structure.length}`);
  const p = run.cao_json.presence;
  check('no fabricated decisions', p.decisions === false);
  check('no fabricated commitments', p.commitments === false);
  check('advice present & CTA present (separated)', p.advice && p.ctas);
  const kinds = new Set(run.cao_json.items.map((i) => i.kind));
  check('advice and cta are distinct kinds', kinds.has('advice') && kinds.has('cta') && !kinds.has('decision') && !kinds.has('commitment'));
  const issues = run.cao_json.validation.issues.flatMap((i) => i.issues || []);
  check('adversarial decision suppressed', issues.includes('decision-uncued→suppressed'));
  check('adversarial commitment suppressed', issues.includes('commitment-uncued→suppressed'));

  const quotes = run.cao_json.items.filter((i) => i.kind === 'quote');
  const { cps, words } = text.tokenize(canonical);
  const cleanRange = text.resolvePhraseRange(words, expectations.quoteRawContains);
  const clean = quotes.find((q) => q.rawText.includes(expectations.quoteRawContains));
  check('quote rawText is the exact transcript slice', clean && clean.rawText === text.rawTextForRange(cps, words, cleanRange[0], cleanRange[1]));
  const roy = quotes.find((q) => q.corrections && q.corrections.length);
  check('RY quote: raw keeps "RY", display shows "ROI"', roy && roy.rawText.includes('RY') && roy.displayText.includes('ROI'));

  check('full processing coverage (complete)', run.processing_coverage.complete === true && run.analysis_status === 'complete');

  // --- zero generation on open ---
  const store = createAnalysisStore(':memory:', { now: (() => { let n = 1; return () => n++; })() });
  store.putRun(run);
  store.putArtifact(pipeline.renderArtifact({ analysisRun: run, ids: createIdFactory() }));
  const before = counter.n;
  const opened = pipeline.openAnalysis(store, 'gate');
  check('zero generation on open', opened && counter.n === before, `open added ${counter.n - before} calls`);
  check('build did call the model (sanity)', buildCalls > 0, `${buildCalls} calls`);

  // --- report ---
  const pass = results.filter((r) => r.ok).length;
  console.log('\nWhisperClick — Summary System v2 · Phase-0 acceptance gate\n');
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
  console.log(`\n  ${pass}/${results.length} checks passed\n`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('gate crashed:', e); process.exit(2); });
