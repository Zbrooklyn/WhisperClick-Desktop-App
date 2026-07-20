'use strict';
// validate-coverage.test.js — suppression/abstention, decision lifecycle,
// processing-coverage completeness + partial/resumable.

const test = require('node:test');
const assert = require('node:assert/strict');

const text = require('../text');
const validate = require('../validate');
const { createCoverage } = require('../coverage');

// A synthetic transcript that contains the spans we anchor to.
const T = text.canonicalize(
  'Alice will send the report by Friday. We decided to ship on Monday. ' +
  'You should focus on data. Please subscribe to the newsletter.'
);
const { words } = text.tokenize(T);
const N = words.length;
const full = [0, N - 1];

test('task owner/due abstain when relationship evidence is missing or weak', () => {
  const weak = validate.validateTask({
    itemId: 'item_a', kind: 'task', taskSpan: [1, 4], owner: 'Alice', due: 'Friday',
    // no actorSpan / commitmentCueSpan / dueSpan, low confidence
    relationshipConfidence: 0.2,
  }, words);
  assert.equal(weak.dropped, false);
  assert.equal(weak.item.owner, undefined, 'owner must be abstained');
  assert.equal(weak.item.due, undefined, 'due must be abstained');
  assert.ok(weak.item.ownerAbstained && weak.item.dueAbstained);

  const strong = validate.validateTask({
    itemId: 'item_b', kind: 'task', taskSpan: [1, 4], owner: 'Alice',
    actorSpan: [0, 0], commitmentCueSpan: [1, 1], dueSpan: [5, 6], due: 'Friday',
    relationshipConfidence: 0.9,
  }, words);
  assert.equal(strong.item.owner, 'Alice', 'well-evidenced owner is kept');
});

test('due VALUE must be grounded in its own span wording (no invented calendar dates)', () => {
  // regression: the bake-off caught due=2023-03-10 for a transcript that only
  // says "by Friday".
  const invented = validate.validateTask({
    itemId: 'item_d1', kind: 'task', taskSpan: [1, 4],
    dueSpan: [5, 6], dueText: 'by Friday', due: '2023-03-10',
    relationshipConfidence: 0.95,
  }, words);
  assert.equal(invented.item.due, undefined, 'invented absolute date must be abstained');
  assert.ok(invented.item.dueAbstained);
  assert.ok(invented.issues.includes('due-value-ungrounded→abstained'));

  const faithful = validate.validateTask({
    itemId: 'item_d2', kind: 'task', taskSpan: [1, 4],
    dueSpan: [5, 6], dueText: 'by Friday', due: 'Friday',
    relationshipConfidence: 0.95,
  }, words);
  assert.equal(faithful.item.due, 'Friday', 'wording that matches the span is kept');
});

test('commitments and decisions are suppressed without cue evidence', () => {
  const c = validate.validateCommitment({ itemId: 'item_c', kind: 'commitment', evidence: { rawWordRange: full } }, words);
  assert.equal(c.dropped, true);
  assert.deepEqual(c.issues, ['commitment-uncued→suppressed']);

  const d = validate.validateDecision({ itemId: 'item_d', kind: 'decision', evidence: { rawWordRange: full } }, words);
  assert.equal(d.dropped, true);
  assert.deepEqual(d.issues, ['decision-uncued→suppressed']);

  // A grounded cue is necessary but no longer sufficient: the statement must
  // also be affirmative and non-hypothetical (Phase-1A modality guard).
  const good = validate.validateDecision({
    itemId: 'item_e', kind: 'decision',
    decisionCueSpan: [7, 8], decisionCueText: 'We decided',
    evidence: { rawWordRange: full, rawText: 'We decided to ship on Monday.' },
  }, words);
  assert.equal(good.dropped, false);
  assert.equal(good.item.lifecycle, 'proposed');
});

// Regression tests for the Phase-1A modality guard. These encode the exact
// sentences the first live bake-off wrongly persisted as decisions.
test('modality guard: hypothetical/conditional statements are never decisions', () => {
  const hedged = [
    'We could decide to ship on Monday if the tests go green.',
    'If we decided to move the date, we would need approval from legal first.',
    "Let's not decide that today.",
    'Maybe we should consider a second beta.',
    'Nothing is decided yet.',
  ];
  for (const s of hedged) {
    const item = { itemId: 'item_h', kind: 'decision', decisionCueSpan: [0, 1], decisionCueText: 'decided', evidence: { rawWordRange: full, rawText: s } };
    const r = validate.validateDecision(item, words);
    assert.equal(r.dropped, true, `must suppress: ${s}`);
    assert.ok(r.issues[0].includes('suppressed'));
  }
});

test('modality guard: settled decisions still pass', () => {
  const settled = [
    { text: 'We decided to keep the old billing endpoint alive until April.', cue: 'We decided' },
    { text: 'we are moving the billing migration to sprint twelve', cue: 'Agreed' },
  ];
  for (const s of settled) {
    const item = { itemId: 'item_s', kind: 'decision', decisionCueSpan: [0, 1], decisionCueText: s.cue, evidence: { rawWordRange: full, rawText: s.text } };
    const r = validate.validateDecision(item, words);
    assert.equal(r.dropped, false, `must keep: ${s.text}`);
  }
});

test('modality guard: a merely grammatical "decide" is not an affirmative decision', () => {
  const item = { itemId: 'item_g', kind: 'decision', decisionCueSpan: [0, 1], decisionCueText: 'decide', evidence: { rawWordRange: full, rawText: 'We need to decide the launch date at some point.' } };
  const r = validate.validateDecision(item, words);
  assert.equal(r.dropped, true);
  assert.deepEqual(r.issues, ['decision-not-affirmative→suppressed']);
});

test('modality guard: hypothetical commitments are suppressed too', () => {
  const item = { itemId: 'item_c2', kind: 'commitment', commitmentCueSpan: [0, 1], actorSpan: [0, 0], evidence: { rawWordRange: full, rawText: 'I would send the report if the client asks.' } };
  const r = validate.validateCommitment(item, words);
  assert.equal(r.dropped, true);
  assert.deepEqual(r.issues, ['commitment-hypothetical→suppressed']);
});

test('opposing decisions without explicit revision are preserved as unclear', () => {
  const out = validate.reconcileDecisions([
    { itemId: 'item_1', topicKey: 'launch', stance: 'affirm', lifecycle: 'proposed' },
    { itemId: 'item_2', topicKey: 'launch', stance: 'negate', lifecycle: 'proposed' },
  ]);
  assert.equal(out.length, 2);
  assert.ok(out.every((d) => d.lifecycle === 'unclear'), 'conflict preserved, not auto-resolved');
  assert.deepEqual(out[0].conflictWith, ['item_2']);
});

test('explicit revision supersedes the earlier decision', () => {
  const out = validate.reconcileDecisions([
    { itemId: 'item_1', topicKey: 'launch', stance: 'affirm', lifecycle: 'agreed' },
    { itemId: 'item_2', topicKey: 'launch', stance: 'negate', lifecycle: 'revised', revisionOf: 'item_1' },
  ]);
  const first = out.find((d) => d.itemId === 'item_1');
  assert.equal(first.lifecycle, 'superseded');
});

test('final presence is derived from validated survivors, not a sample', () => {
  const presence = validate.deriveFinalPresence([
    { kind: 'advice' }, { kind: 'cta' }, { kind: 'quote' },
  ]);
  assert.deepEqual(presence, {
    decisions: false, commitments: false, actions: false, quotes: true,
    risks: false, questions: false, advice: true, ctas: true,
  });
});

test('coverage: full tiling reports complete', () => {
  const cov = createCoverage(10);
  cov.assign('seg_1', [0, 4]); cov.markMerged('seg_1');
  cov.assign('seg_2', [4, 9]); cov.markMerged('seg_2'); // overlap ok
  const r = cov.report();
  assert.equal(r.complete, true);
  assert.equal(r.status, 'complete');
  assert.equal(r.unassignedRanges.length, 0);
});

test('coverage: a missing segment is visibly partial + resumable', () => {
  const cov = createCoverage(10);
  cov.assign('seg_1', [0, 4]); cov.markMerged('seg_1');
  cov.assign('seg_2', [5, 9], 'pending'); // never completed
  const r = cov.report();
  assert.equal(r.complete, false);
  assert.equal(r.status, 'partial');
  assert.deepEqual(r.unassignedRanges, [[5, 9]]);
  assert.equal(cov.resumePlan().length, 1);
  assert.equal(cov.resumePlan()[0].segmentId, 'seg_2');
});

test('coverage: a failed range stays visible (never silently dropped)', () => {
  const cov = createCoverage(10);
  cov.assign('seg_1', [0, 4]); cov.markMerged('seg_1');
  cov.assign('seg_2', [5, 9]); cov.markFailed('seg_2');
  const r = cov.report();
  assert.equal(r.complete, false);
  assert.equal(r.status, 'failed');
  assert.deepEqual(r.failedRanges, [[5, 9]]);
  assert.ok(cov.resumePlan().some((s) => s.status === 'failed'));
});
