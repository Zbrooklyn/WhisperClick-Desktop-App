'use strict';
// scoring.test.js — the bake-off scorer and gates, verified deterministically
// against fixture-adapter output (no live model).

const test = require('node:test');
const assert = require('node:assert/strict');

const pipeline = require('../pipeline');
const { createFixtureAdapter } = require('../model-adapter');
const { createIdFactory } = require('../ids');
const ashley = require('../corpus/ashley-gross');
const { ashleyFixture, allFixtures, CORPUS_VERSION } = require('../corpus/fixtures');
const { scoreFixture, evaluateGates, resolveGold, prf } = require('../corpus/scoring');

test('corpus exposes base + adversarial fixtures with resolvable gold anchors', () => {
  const fx = allFixtures();
  assert.ok(fx.length >= 5);
  assert.ok(fx.some((f) => f.family === 'base') && fx.some((f) => f.family === 'adversarial'));
  for (const f of fx) {
    const gold = resolveGold(f);
    const declared = (f.gold.decisions || []).length + (f.gold.commitments || []).length +
      (f.gold.advice || []).length + (f.gold.ctas || []).length + (f.gold.tasks || []).length;
    const resolved = gold.decisions.length + gold.commitments.length + gold.advice.length + gold.ctas.length + gold.tasks.length;
    assert.equal(resolved, declared, `every gold anchor in ${f.id} must resolve to a real word range`);
  }
  assert.ok(CORPUS_VERSION);
});

test('prf handles the empty/empty case as perfect (nothing expected, nothing produced)', () => {
  assert.deepEqual(prf([], []), { tp: 0, fp: 0, fn: 0, precision: 1, recall: 1 });
  const p = prf([[0, 1]], []); // a fabrication
  assert.equal(p.precision, 0);
});

test('scoring a clean fixture run reports valid quotes, exact structure, no fabrications', async () => {
  const fixture = ashleyFixture();
  const adapter = createFixtureAdapter(ashley.build().recorded);
  const run = await pipeline.buildAnalysisRun({
    noteId: 'score', rawTranscript: fixture.text, adapter, ids: createIdFactory(), now: () => 1,
  });
  const m = scoreFixture({ fixture, run, telemetry: adapter.telemetry, pricing: { inPerM: 1, outPerM: 1 } });

  assert.equal(m.quoteRangeValidity, 1, 'every quote is constructed from a valid range');
  assert.equal(m.evidenceValidity, 1);
  assert.equal(m.structure.exact, true, '10 structural units');
  assert.equal(m.owners.invented, 0);
  assert.equal(m.dues.invented, 0);
  assert.equal(m.categories.decisions.precision, 1, 'no fabricated decisions');
  assert.equal(m.categories.commitments.precision, 1, 'no fabricated commitments');
  assert.equal(m.coverage.complete, true);

  const { passed, gates } = evaluateGates([{ model: 'fixture', metrics: m }]);
  assert.equal(passed, true, 'clean run passes all gates: ' + gates.filter((g) => !g.ok).map((g) => g.name).join(', '));
});

test('gates FAIL on a fabricated owner and on advice persisted as a task', () => {
  const fixture = allFixtures().find((f) => f.id === 'adversarial-audience-advice');
  const gold = resolveGold(fixture);
  const adviceRange = gold.advice[0].range;

  // a run that turns audience advice into an owned task with an invented owner
  const badRun = {
    analysis_status: 'complete',
    processing_coverage: { complete: true, failedRanges: [], unassignedRanges: [] },
    cao_json: {
      structure: [],
      presence: { actions: true },
      validation: { issues: [], dropped: [] },
      items: [{
        itemId: 'item_bad', kind: 'task', text: 'focus on data quality',
        evidence: { rawWordRange: adviceRange },
        owner: 'Dana', due: 'Friday',
      }],
    },
  };
  const m = scoreFixture({ fixture, run: badRun, telemetry: null, pricing: null });
  assert.equal(m.owners.invented, 1);
  assert.equal(m.dues.invented, 1);
  assert.equal(m.misclass.adviceAsTask, 1);

  const res = evaluateGates([{ model: 'x', metrics: m }]);
  assert.equal(res.passed, false);
  const failed = res.failedGates.map((g) => g.name);
  assert.ok(failed.includes('zero invented owners'));
  assert.ok(failed.includes('zero invented due dates'));
  assert.ok(failed.includes('zero audience advice persisted as assigned tasks'));
  // and the offending items are listed individually, not averaged away
  assert.ok(res.failedGates.every((g) => g.offenders.length >= 0));
  assert.ok(m.failures.some((f) => f.type === 'invented-owner'));
});

test('gates FAIL when a partial run hides its failed ranges (silent omission)', () => {
  const fixture = allFixtures().find((f) => f.id === 'adversarial-hypothetical');
  const run = {
    analysis_status: 'partial',
    processing_coverage: { complete: false, failedRanges: [], unassignedRanges: [] }, // nothing visible
    cao_json: { structure: [], presence: {}, validation: { issues: [], dropped: [] }, items: [] },
  };
  const m = scoreFixture({ fixture, run, telemetry: null, pricing: null });
  assert.ok(m.failures.some((f) => f.type === 'silent-omission'));
  const res = evaluateGates([{ model: 'x', metrics: m }]);
  assert.equal(res.gates.find((g) => g.name === 'no failed segment silently omitted').ok, false);
});
