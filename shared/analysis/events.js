// events.js — the semantic speech-event model (Phase 1B).
//
// WHY THIS EXISTS
// Phase 1A asked the model to decide whether an utterance was "a task" or "a
// commitment". That is a false choice, and the bake-off proved it: "Dana, can
// you take the schema review?" and "Yes, I'll have it finished by Wednesday"
// are TWO speech acts that together make ONE task. Forcing a single label per
// utterance produced owner recall of 0.000 — the system abstained from
// everything rather than pick wrongly.
//
// So the model no longer classifies outcomes. It reports PRIMITIVE GROUNDED
// SPEECH EVENTS — what was literally said, by whom, to whom. Operational tasks
// are then DERIVED deterministically from those events (see assemble.js).
// Extraction observes; derivation decides.
//
// Every event carries its own exact raw-word evidence range. Relationship
// evidence may therefore span multiple speaker turns without any single text
// span having to contain all of it.

'use strict';

// The 15 primitive event types.
const EVENT_TYPES = Object.freeze([
  'assignmentRequest',   // "Dana, can you take the schema review?"
  'acceptance',          // "Yes, I'll have it finished by Wednesday."
  'selfCommitment',      // "I will write the migration plan by Friday."
  'decline',             // "No, I can't take that."
  'cancellation',        // "We're dropping that task."
  'completionClaim',     // "I already sent it."
  'recommendation',      // "We should probably index that column."
  'audienceAdvice',      // "You should focus on data quality." (to an audience)
  'promotionalCTA',      // "Subscribe to my newsletter."
  'decisionProposal',    // "I think we should move it to next sprint."
  'decisionAgreement',   // "Agreed, we're moving it to sprint twelve."
  'decisionRevision',    // "Actually, let's keep it in this sprint."
  'decisionRescission',  // "Forget that, we're not doing it."
  'risk',                // "The staging database keeps running out of disk."
  'question',            // "Where are we on billing?"
]);

// Which event types can contribute to an operational task.
const OPERATIONAL_EVENTS = Object.freeze([
  'assignmentRequest', 'acceptance', 'selfCommitment', 'decline', 'cancellation', 'completionClaim',
]);

// Decision lifecycle events, in strength order.
const DECISION_EVENTS = Object.freeze([
  'decisionProposal', 'decisionAgreement', 'decisionRevision', 'decisionRescission',
]);

// Events that are explicitly NOT operational, no matter how imperative they sound.
// This is the structural answer to "advice persisted as an assigned task".
const NON_OPERATIONAL_EVENTS = Object.freeze(['audienceAdvice', 'promotionalCTA', 'recommendation']);

// Relevance categories for commitments (Phase 1B §3). A commitment is preserved
// as a FACT regardless of category; the category only tells a template whether it
// belongs in an action list.
const RELEVANCE = Object.freeze([
  'operational',            // real work: "I'll write the migration plan"
  'promotional',            // "subscribe", "follow me"
  'editorial',              // "I'll cover this in the newsletter"
  'futureContent',          // "I will publish more resources about pricing"
  'conversationalFollowup', // "We'll talk again Thursday"
  'taskEligible',           // derived marker: this commitment may become a task
]);

const VALIDATION_STATES = Object.freeze(['grounded', 'abstained', 'suppressed']);

// makeEvent(spec) -> a normalized event record.
//   spec: { eventId, type, evidence, speaker?, addressee?, addresseeEvidence?,
//           dueEvidence?, cueEvidence?, confidence?, relevance?, topicKey?, refs? }
// `evidence` is the event's own raw-word anchor (required and always grounded).
function makeEvent(spec) {
  if (!EVENT_TYPES.includes(spec.type)) throw new TypeError(`unknown event type: ${spec.type}`);
  if (!spec.evidence || !Array.isArray(spec.evidence.rawWordRange)) {
    throw new TypeError(`event ${spec.type} requires grounded evidence`);
  }
  return {
    eventId: spec.eventId,
    type: spec.type,
    evidence: spec.evidence,
    // speaker/addressee are only ever set when GROUNDED in the transcript
    speaker: spec.speaker || null,
    speakerEvidence: spec.speakerEvidence || null,
    addressee: spec.addressee || null,
    addresseeEvidence: spec.addresseeEvidence || null,
    dueEvidence: spec.dueEvidence || null,
    dueText: spec.dueText || null,
    cueEvidence: spec.cueEvidence || null,
    confidence: typeof spec.confidence === 'number' ? spec.confidence : 0.5,
    relevance: spec.relevance || null,
    topicKey: spec.topicKey || null,
    refs: spec.refs || [],           // ids of events this one responds to
    turnIndex: spec.turnIndex == null ? null : spec.turnIndex,
    validation: spec.validation || 'grounded',
    issues: spec.issues || [],
  };
}

// isOperational / isDecision helpers used by the assembler and templates.
const isOperational = (e) => OPERATIONAL_EVENTS.includes(e.type);
const isDecisionEvent = (e) => DECISION_EVENTS.includes(e.type);
const isNonOperational = (e) => NON_OPERATIONAL_EVENTS.includes(e.type);

// classifyCommitmentRelevance(event, ctx) -> relevance category.
//   Deterministic, evidence-driven. A commitment is "operational" only when it
//   describes work inside the conversation's own domain; promotional/editorial/
//   conversational promises are preserved but are not action items.
const PROMO = /\b(subscribe|newsletter|follow me|like button|link (in|below)|channel|download the free|sign up)\b/i;
const EDITORIAL = /\b(publish|post|put out|share|cover(ing)? (this|that|it)|announcements?|video|episode|resources?|article|blog)\b/i;
const CONVERSATIONAL = /\b(talk (again|later|soon)|catch up|circle back|speak (again|soon)|meet again|revisit .* (next|later))\b/i;

function classifyCommitmentRelevance(event, ctx = {}) {
  const t = String((event.evidence && event.evidence.rawText) || '');
  if (event.type === 'promotionalCTA' || PROMO.test(t)) return 'promotional';
  if (CONVERSATIONAL.test(t)) return 'conversationalFollowup';
  if (EDITORIAL.test(t)) return ctx.sourceKind === 'meeting' ? 'operational' : 'futureContent';
  // An educational monologue has no operational surface by default.
  if (ctx.sourceKind === 'educational' || ctx.sourceKind === 'promotional') return 'editorial';
  return 'operational';
}

module.exports = {
  EVENT_TYPES, OPERATIONAL_EVENTS, DECISION_EVENTS, NON_OPERATIONAL_EVENTS,
  RELEVANCE, VALIDATION_STATES,
  makeEvent, isOperational, isDecisionEvent, isNonOperational,
  classifyCommitmentRelevance,
};
