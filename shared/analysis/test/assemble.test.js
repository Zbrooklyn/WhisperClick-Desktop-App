'use strict';
// assemble.test.js — deterministic task derivation from grounded speech events.
// Covers the multi-turn patterns Phase 1A could not express.

const test = require('node:test');
const assert = require('node:assert/strict');

const textMod = require('../text');
const { makeEvent, classifyCommitmentRelevance } = require('../events');
const { deriveTasks } = require('../assemble');

// A realistic multi-turn transcript so every span is a real word range.
const T = textMod.canonicalize(
  'Priya: Dana, can you take the schema review? ' +          // words 0..8
  "Dana: Yes. I'll have it finished by Wednesday. " +
  'Marcus: I will write the migration plan by Friday. ' +
  'Priya: You should focus on data quality generally. ' +
  "Marcus: We're dropping the invoice template rewrite. " +
  'Dana: No, I can not take the billing audit.'
);
const { cps, words } = textMod.tokenize(T);

let seq = 0;
function ev(type, phrase, extra = {}) {
  const range = textMod.resolvePhraseRange(words, phrase);
  assert.ok(range, `phrase must exist in fixture: "${phrase}"`);
  const evidence = { evidenceId: `evid_${++seq}`, rawWordRange: range, rawText: textMod.rawTextForRange(cps, words, range[0], range[1]), matchState: 'transcriptMatched' };
  const spec = { eventId: `event_${seq}`, type, evidence, ...extra };
  if (extra.speaker && !extra.speakerEvidence) {
    const sr = textMod.resolvePhraseRange(words, extra.speaker);
    if (sr) spec.speakerEvidence = { evidenceId: `evid_s${seq}`, rawWordRange: sr, rawText: extra.speaker, matchState: 'transcriptMatched' };
  }
  if (extra.addressee && !extra.addresseeEvidence) {
    const ar = textMod.resolvePhraseRange(words, extra.addressee);
    if (ar) spec.addresseeEvidence = { evidenceId: `evid_a${seq}`, rawWordRange: ar, rawText: extra.addressee, matchState: 'transcriptMatched' };
  }
  if (extra.duePhrase) {
    const dr = textMod.resolvePhraseRange(words, extra.duePhrase);
    assert.ok(dr, `due phrase must exist: ${extra.duePhrase}`);
    spec.dueEvidence = { evidenceId: `evid_d${seq}`, rawWordRange: dr, rawText: textMod.rawTextForRange(cps, words, dr[0], dr[1]), matchState: 'transcriptMatched' };
    spec.dueText = extra.dueText || extra.duePhrase;
  }
  return makeEvent(spec);
}

test('assignment + acceptance across turns produces ONE committed task with multi-span evidence', () => {
  const req = ev('assignmentRequest', 'can you take the schema review', { speaker: 'Priya', addressee: 'Dana' });
  const acc = ev('acceptance', "I'll have it finished by Wednesday", { speaker: 'Dana', duePhrase: 'by Wednesday', refs: [] });
  const { tasks } = deriveTasks([req, acc], { sourceKind: 'meeting' });

  assert.equal(tasks.length, 1, 'two utterances make ONE task');
  const t = tasks[0];
  assert.equal(t.status, 'committed');
  assert.equal(t.owner, 'Dana', 'owner comes from the ACCEPTING speaker');
  assert.equal(t.due, 'by Wednesday');
  // evidence spans multiple turns
  assert.equal(t.assignmentEventId, req.eventId);
  assert.equal(t.acceptanceEventId, acc.eventId);
  assert.ok(t.taskEvidence && t.dueEvidence && t.actorEvidence, 'task, due and actor all carry evidence');
  assert.notDeepEqual(t.taskEvidence.rawWordRange, t.dueEvidence.rawWordRange, 'evidence genuinely spans different ranges');
  assert.ok(t.relationshipConfidence >= 0.6);
});

test('self-commitment produces a committed task owned by the speaker', () => {
  const c = ev('selfCommitment', 'I will write the migration plan by Friday', { speaker: 'Marcus', duePhrase: 'by Friday', relevance: 'operational' });
  const { tasks } = deriveTasks([c], { sourceKind: 'meeting' });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, 'committed');
  assert.equal(tasks[0].owner, 'Marcus');
  assert.equal(tasks[0].due, 'by Friday');
  assert.equal(tasks[0].commitmentEventId, c.eventId);
});

test('assignment WITHOUT acceptance is "requested": proposed owner only, and NO due date', () => {
  const req = ev('assignmentRequest', 'can you take the schema review', { speaker: 'Priya', addressee: 'Dana' });
  const { tasks } = deriveTasks([req], { sourceKind: 'meeting' });
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.equal(t.status, 'requested');
  assert.equal(t.owner, null, 'no confirmed owner without acceptance');
  assert.equal(t.proposedOwner, 'Dana', 'directly addressed -> proposed owner');
  assert.equal(t.due, null, 'an unanswered request must never carry a deadline');
  assert.equal(t.acceptanceEventId, null);
});

test('decline marks the request declined rather than leaving an active task', () => {
  const req = ev('assignmentRequest', 'can you take the schema review', { speaker: 'Priya', addressee: 'Dana' });
  const dec = ev('decline', 'No, I can not take the billing audit', { speaker: 'Dana' });
  const { tasks } = deriveTasks([req, dec], { sourceKind: 'meeting' });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, 'declined');
  assert.equal(tasks[0].declineEventId, dec.eventId);
});

test('cancellation marks an existing task cancelled', () => {
  const c = ev('selfCommitment', 'I will write the migration plan by Friday', { speaker: 'Marcus', relevance: 'operational' });
  const cancel = ev('cancellation', "We're dropping the invoice template rewrite", { speaker: 'Marcus', refs: [c.eventId] });
  const { tasks } = deriveTasks([c, cancel], { sourceKind: 'meeting' });
  assert.equal(tasks[0].status, 'cancelled');
  assert.ok(tasks[0].statusEvidence, 'cancellation is itself evidenced');
});

test('an UNLINKED completion claim never marks a task done (live-run regression)', () => {
  // A live run had "It's half done." (about something else entirely) flip an
  // unrelated task to `completed`. Saying work is finished when nobody said so
  // is a fabrication, so an unlinked override must change nothing.
  const c = ev('selfCommitment', 'I will write the migration plan by Friday', { speaker: 'Marcus', relevance: 'operational' });
  const claim = ev('completionClaim', 'No, I can not take the billing audit', { speaker: 'Dana' }); // unrelated wording, no refs
  const { tasks } = deriveTasks([c, claim], { sourceKind: 'meeting' });
  assert.equal(tasks[0].status, 'committed', 'status must NOT become completed');
});

test('a topically-matching completion claim DOES resolve its task', () => {
  const c = ev('selfCommitment', 'I will write the migration plan by Friday', { speaker: 'Marcus', relevance: 'operational' });
  const claim = ev('completionClaim', 'can you take the schema review', { speaker: 'Marcus', refs: [c.eventId] });
  const { tasks } = deriveTasks([c, claim], { sourceKind: 'meeting' });
  assert.equal(tasks[0].status, 'completed', 'an explicitly referenced claim still applies');
});

test('a response from someone OTHER than the addressee does not pair', () => {
  const req = ev('assignmentRequest', 'can you take the schema review', { speaker: 'Priya', addressee: 'Dana' });
  const acc = ev('acceptance', "I'll have it finished by Wednesday", { speaker: 'Marcus' }); // wrong person
  const { tasks } = deriveTasks([req, acc], { sourceKind: 'meeting' });
  const paired = tasks.find((t) => t.acceptanceEventId === acc.eventId);
  assert.equal(paired, undefined, 'must not pair an answer from the wrong speaker');
  assert.equal(tasks[0].status, 'requested');
});

test('audience advice NEVER becomes a task, however imperative', () => {
  const advice = ev('audienceAdvice', 'You should focus on data quality generally', { speaker: 'Priya' });
  const { tasks } = deriveTasks([advice], { sourceKind: 'educational' });
  assert.equal(tasks.length, 0, 'generic "you" guidance produces no task');
});

test('promotional and conversational commitments are preserved but not task-eligible', () => {
  const promoEv = makeEvent({
    eventId: 'event_p', type: 'selfCommitment',
    evidence: { evidenceId: 'e', rawWordRange: [0, 2], rawText: 'Subscribe to my newsletter at the link below', matchState: 'transcriptMatched' },
    speaker: 'Ashley',
  });
  assert.equal(classifyCommitmentRelevance(promoEv, { sourceKind: 'educational' }), 'promotional');

  const chat = makeEvent({
    eventId: 'event_c', type: 'selfCommitment',
    evidence: { evidenceId: 'e2', rawWordRange: [0, 2], rawText: "We'll talk again on Thursday", matchState: 'transcriptMatched' },
    speaker: 'Priya',
  });
  assert.equal(classifyCommitmentRelevance(chat, { sourceKind: 'meeting' }), 'conversationalFollowup');

  const { tasks, commitments } = deriveTasks([promoEv, chat], { sourceKind: 'meeting' });
  assert.equal(tasks.length, 0, 'neither becomes an action item');
  assert.equal(commitments.length, 2, 'but both are preserved as commitment FACTS');
  assert.ok(commitments.every((c) => c.taskEligible === false));
});

test('editorial/future-content commitment is preserved, not an action item', () => {
  const e = makeEvent({
    eventId: 'event_e', type: 'selfCommitment',
    evidence: { evidenceId: 'e3', rawWordRange: [0, 3], rawText: 'I will be putting out a lot more announcements about this', matchState: 'transcriptMatched' },
    speaker: 'Ashley',
  });
  assert.equal(classifyCommitmentRelevance(e, { sourceKind: 'educational' }), 'futureContent');
  const { tasks, commitments } = deriveTasks([e], { sourceKind: 'educational' });
  assert.equal(tasks.length, 0);
  assert.equal(commitments[0].taskEligible, false);
});

test('acceptance with the deadline in the NEXT turn still yields one dated task', () => {
  // the request carries no date; the acceptance supplies it
  const req = ev('assignmentRequest', 'can you take the schema review', { speaker: 'Priya', addressee: 'Dana' });
  const acc = ev('acceptance', "I'll have it finished by Wednesday", { speaker: 'Dana', duePhrase: 'by Wednesday' });
  const { tasks } = deriveTasks([req, acc], { sourceKind: 'meeting' });
  assert.equal(tasks[0].due, 'by Wednesday');
  assert.deepEqual(tasks[0].dueEvidence.rawWordRange, textMod.resolvePhraseRange(words, 'by Wednesday'));
});

test('a due value inconsistent with its own span is refused', () => {
  const c = ev('selfCommitment', 'I will write the migration plan by Friday', { speaker: 'Marcus', duePhrase: 'by Friday', dueText: '2023-03-10', relevance: 'operational' });
  const { tasks } = deriveTasks([c], { sourceKind: 'meeting' });
  assert.equal(tasks[0].due, null, 'an invented calendar date is not carried');
});
