'use strict';
// events-pipeline.test.js — end-to-end proof of the Phase-1B path:
// transcript -> grounded speech events -> DERIVED tasks -> persisted run.
// This is the path Phase 1A could not express (owner recall was 0.000).

const test = require('node:test');
const assert = require('node:assert/strict');

const textMod = require('../text');
const { createAnalysisStore } = require('../store');
const { createFixtureEventAdapter } = require('../model-adapter');
const { createIdFactory } = require('../ids');
const { executeRun } = require('../resume');

const MEETING = textMod.canonicalize(
  'Sprint planning. Present: Priya, Marcus, Dana.\n' +
  'Priya: Dana, can you take the schema review?\n' +
  "Dana: Yes. I'll have the schema review finished by Wednesday.\n" +
  'Marcus: I will write the migration plan by Friday.\n' +
  'Priya: Agreed, we are moving the billing migration to sprint twelve.\n' +
  'Marcus: We could decide to drop the invoice rewrite, but nothing is decided yet.\n' +
  'Priya: The staging database keeps running out of disk.\n'
);

const { words } = textMod.tokenize(MEETING);
const r = (phrase) => {
  const range = textMod.resolvePhraseRange(words, phrase);
  assert.ok(range, `fixture phrase must exist: "${phrase}"`);
  return range;
};

// Raw event records exactly as the live adapter would emit after span resolution.
function recorded() {
  return {
    profile: { contentTypes: [{ type: 'meeting', confidence: 0.95 }], provisionalPresence: {} },
    structureUnits: [],
    events: [
      { type: 'assignmentRequest', range: r('can you take the schema review'), speaker: 'Priya', speakerSpan: r('Priya'), addressee: 'Dana', addresseeSpan: r('Dana,') },
      { type: 'acceptance', range: r("I'll have the schema review finished by Wednesday"), speaker: 'Dana', speakerSpan: r('Dana:'), dueText: 'by Wednesday', dueSpan: r('by Wednesday') },
      { type: 'selfCommitment', range: r('I will write the migration plan by Friday'), speaker: 'Marcus', speakerSpan: r('Marcus:'), dueText: 'by Friday', dueSpan: r('by Friday') },
      { type: 'decisionAgreement', range: r('we are moving the billing migration to sprint twelve'), speaker: 'Priya', speakerSpan: r('Priya:') },
      // adversarial: hedged talk the model mislabelled as a settled decision
      { type: 'decisionAgreement', range: r('We could decide to drop the invoice rewrite'), speaker: 'Marcus' },
      { type: 'risk', range: r('The staging database keeps running out of disk') },
      { type: 'quote', range: r('The staging database keeps running out of disk') },
    ],
  };
}

function memStore() { let n = 1; return createAnalysisStore(':memory:', { now: () => n++ }); }

test('events path derives a task from an assignment + acceptance across turns', async () => {
  const store = memStore();
  const adapter = createFixtureEventAdapter(recorded());
  const { run } = await executeRun({ store, noteId: 'ev1', rawTranscript: MEETING, adapter, ids: createIdFactory(), sourceKind: 'meeting' });

  assert.equal(run.analysis_status, 'complete');
  const tasks = run.cao_json.items.filter((i) => i.kind === 'task');
  const schema = tasks.find((t) => /schema review/i.test(t.text));
  assert.ok(schema, 'schema-review task derived');
  assert.equal(schema.status, 'committed');
  assert.equal(schema.owner, 'Dana', 'owner recovered from the ACCEPTING speaker');
  assert.equal(schema.due, 'by Wednesday', 'deadline recovered from the next turn');
  assert.ok(schema.assignmentEventId && schema.acceptanceEventId, 'multi-turn evidence linked');
  assert.ok(schema.actorEvidence && schema.dueEvidence, 'actor and due carry their own evidence');
});

test('events path derives a self-commitment task with speaker as owner', async () => {
  const store = memStore();
  const adapter = createFixtureEventAdapter(recorded());
  const { run } = await executeRun({ store, noteId: 'ev2', rawTranscript: MEETING, adapter, ids: createIdFactory(), sourceKind: 'meeting' });
  const t = run.cao_json.items.filter((i) => i.kind === 'task').find((x) => /migration plan/i.test(x.text));
  assert.ok(t);
  assert.equal(t.owner, 'Marcus');
  assert.equal(t.due, 'by Friday');
});

test('events path keeps the settled decision and suppresses the hedged one', async () => {
  const store = memStore();
  const adapter = createFixtureEventAdapter(recorded());
  const { run } = await executeRun({ store, noteId: 'ev3', rawTranscript: MEETING, adapter, ids: createIdFactory(), sourceKind: 'meeting' });
  const decisions = run.cao_json.items.filter((i) => i.kind === 'decision');
  assert.equal(decisions.length, 1, 'only the genuinely settled decision survives');
  assert.match(decisions[0].text, /sprint twelve/i);
  const suppressed = run.cao_json.validation.issues.flatMap((i) => i.issues || []);
  assert.ok(suppressed.includes('decision-hypothetical→suppressed'), 'hedged decision suppressed even though the model called it settled');
});

test('events path still produces grounded quotes and risks, and reports presence', async () => {
  const store = memStore();
  const adapter = createFixtureEventAdapter(recorded());
  const { run } = await executeRun({ store, noteId: 'ev4', rawTranscript: MEETING, adapter, ids: createIdFactory(), sourceKind: 'meeting' });
  const p = run.cao_json.presence;
  assert.equal(p.actions, true);
  assert.equal(p.decisions, true);
  assert.equal(p.risks, true);
  assert.equal(p.quotes, true);
  const q = run.cao_json.items.find((i) => i.kind === 'quote');
  // The quote is built from the raw word range, so the final token carries its
  // own punctuation ("disk.") — faithful to the transcript, not trimmed.
  assert.equal(q.rawText, 'The staging database keeps running out of disk.');
});

test('events path resumes without re-billing and reaches the same derived tasks', async () => {
  const store = memStore();
  const rec = recorded();
  let fail = true;
  const base = createFixtureEventAdapter(rec);
  const flaky = {
    ...base,
    async extractEvents(a, ctx) { if (fail) { fail = false; const e = new Error('down'); e.code = 'PROVIDER_ERROR'; throw e; } return base.extractEvents(a, ctx); },
  };
  const first = await executeRun({ store, noteId: 'ev5', rawTranscript: MEETING, adapter: flaky, ids: createIdFactory(), sourceKind: 'meeting' });
  assert.equal(first.run.analysis_status, 'partial');

  const second = await executeRun({ store, analysisRunId: first.run.analysis_run_id, noteId: 'ev5', rawTranscript: MEETING, adapter: flaky, ids: createIdFactory(), sourceKind: 'meeting' });
  assert.equal(second.run.analysis_status, 'complete');
  const owners = second.run.cao_json.items.filter((i) => i.kind === 'task').map((t) => t.owner).sort();
  assert.deepEqual(owners, ['Dana', 'Marcus']);
});
