// validate.js — grounding, relationship evidence, decision lifecycle, and the
// suppression/abstention bias.
//
// Contract amendments (spec §0.1 #6, §0.2):
//  - Bias toward SUPPRESSION for decisions, commitments, owners, due dates: when
//    the required evidence is missing or weak, we drop the claim rather than
//    guess. Not fabricating beats being complete.
//  - Relationship evidence: an owner/due is only asserted when the specific
//    relationship span exists AND relationshipConfidence clears the bar. A name
//    or date merely co-occurring in the same span is not enough.
//  - Decision lifecycle: proposed | agreed | revised | rescinded | superseded |
//    unclear. A later opposing statement is NOT auto-chosen as authoritative
//    unless explicit revision/retraction evidence exists; otherwise the conflict
//    is preserved and both sides are marked `unclear`.

'use strict';

const { isGrounded } = require('./evidence');

const LIFECYCLE = Object.freeze(['proposed', 'agreed', 'revised', 'rescinded', 'superseded', 'unclear']);

// Confidence bars. Deliberately conservative — the cost of a dropped true item
// is lower than the cost of a fabricated one in a meeting record.
const OWNER_MIN = 0.6;
const DUE_MIN = 0.6;

function spanGrounded(span, words) {
  return Array.isArray(span) && isGrounded({ rawWordRange: span }, words);
}

// validateTask(item, words) -> { item, issues, dropped }
//   Strips (abstains on) owner/due that lack the required relationship evidence.
function validateTask(item, words) {
  const issues = [];
  const out = { ...item };

  if (!spanGrounded(out.taskSpan, words)) {
    return { item: out, issues: ['task-ungrounded'], dropped: true };
  }
  const conf = typeof out.relationshipConfidence === 'number' ? out.relationshipConfidence : 0;

  if (out.owner != null) {
    const ok = spanGrounded(out.actorSpan, words) && spanGrounded(out.commitmentCueSpan, words) && conf >= OWNER_MIN;
    if (!ok) {
      delete out.owner;
      delete out.actorSpan;
      out.ownerAbstained = true;
      issues.push('owner-unsupported→abstained');
    }
  }
  if (out.due != null) {
    const spanOk = spanGrounded(out.dueSpan, words) && conf >= DUE_MIN;
    // VALUE grounding (added in Phase 1A): a grounded span is not enough — the
    // stored value must match the wording the span actually contains. The
    // bake-off caught the stronger tier "normalising" a transcript that only
    // says "by Friday" into due=2023-03-10, inventing a calendar date (and a
    // year) that appears nowhere in the source. A deadline the user never said
    // is exactly the fabrication class this system exists to prevent.
    const valueOk = spanOk && dueValueGrounded(out);
    if (!valueOk) {
      delete out.due;
      delete out.dueSpan;
      out.dueAbstained = true;
      issues.push(spanOk ? 'due-value-ungrounded→abstained' : 'due-unsupported→abstained');
    }
  }
  return { item: out, issues, dropped: false };
}

// ---------------------------------------------------------------------------
// MODALITY GUARD (added in Phase 1A after the live bake-off).
//
// The first live bake-off caught the economical tier turning hypothetical
// language into decisions: "We could decide to ship on Monday" and "If we
// decided to move the date…" were both persisted as decisions. The model had
// dutifully supplied a decision "cue" ("could decide", "decided"), and the
// validator accepted it because it only checked that a cue EXISTED and was
// grounded — it never checked the MOOD of the sentence.
//
// A prompt can never be trusted to prevent this, so the guard is deterministic:
//  - a hedged/conditional/negated statement is never a decision or commitment;
//  - the cue (or the statement) must contain affirmative, settled language.
// Consistent with approved decision #6, this deliberately trades recall for
// precision: a real decision phrased conditionally is dropped rather than risk
// inventing one.

const HYPOTHETICAL = /\b(could|would|might|may|if|whether|maybe|perhaps|unless|suppose|hypothetical(?:ly)?|possibly|potentially|consider(?:ing)?|thinking about|not\s+decid\w*|nothing\s+is\s+decided|don'?t\s+decide|isn'?t\s+decided|undecided|revisit)\b/i;

const AFFIRMATIVE_DECISION = /\b(decided|decision\s+is|agreed|approved|final(?:ized|ised|)|settled|signed\s+off|locked\s+in|confirmed|going\s+with|go\s+with|we'?re\s+doing)\b/i;

function statementText(item) {
  return [item && item.evidence && item.evidence.rawText, item && item.text].filter(Boolean).join(' ');
}

function hasHypotheticalModality(item) { return HYPOTHETICAL.test(statementText(item)); }

// dueValueGrounded — the persisted `due` must be consistent with the raw wording
// of its own dueSpan. Either may contain the other ("Friday" vs "by Friday"),
// but an absolute date the transcript never states ("2023-03-10") matches
// nothing and is rejected.
function dueValueGrounded(item) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const spanText = norm(item.dueText);
  const value = norm(item.due);
  if (!spanText || !value) return false;
  return spanText.includes(value) || value.includes(spanText);
}

function hasAffirmativeDecision(item) {
  return AFFIRMATIVE_DECISION.test(String(item.decisionCueText || '')) || AFFIRMATIVE_DECISION.test(statementText(item));
}

// validateCommitment — a commitment requires a speaker-owned actor span AND an
// explicit commitment-cue span ("I will", "we'll", "by Friday"). Audience-
// directed advice / CTAs never satisfy this, which is what keeps an educational
// monologue from producing phantom commitments.
function validateCommitment(item, words) {
  const grounded = spanGrounded(item.commitmentCueSpan, words) && spanGrounded(item.actorSpan, words);
  if (!grounded) return { item, issues: ['commitment-uncued→suppressed'], dropped: true };
  if (hasHypotheticalModality(item)) return { item, issues: ['commitment-hypothetical→suppressed'], dropped: true };
  return { item, issues: [], dropped: false };
}

// validateDecision — a decision requires an explicit decision-cue span
// ("we decided", "let's go with", "agreed"). Without it the item is suppressed.
function validateDecision(item, words) {
  if (!spanGrounded(item.decisionCueSpan, words)) {
    return { item, issues: ['decision-uncued→suppressed'], dropped: true };
  }
  // Modality guard: hedged/conditional/negated statements are never decisions.
  if (hasHypotheticalModality(item)) {
    return { item, issues: ['decision-hypothetical→suppressed'], dropped: true };
  }
  // And the cue must be affirmative, settled language — not merely the presence
  // of the word "decide" in some grammatical form.
  if (!hasAffirmativeDecision(item)) {
    return { item, issues: ['decision-not-affirmative→suppressed'], dropped: true };
  }
  const out = { ...item };
  if (!LIFECYCLE.includes(out.lifecycle)) out.lifecycle = 'proposed';
  return { item: out, issues: [], dropped: false };
}

// reconcileDecisions(decisions) -> reconciled decisions.
//   Groups by topicKey. Opposing stances with no explicit revision/retraction
//   evidence become `unclear` and record conflictWith; the conflict is never
//   silently resolved toward the later statement.
function reconcileDecisions(decisions) {
  const byTopic = new Map();
  for (const d of decisions) {
    const k = d.topicKey || d.itemId;
    if (!byTopic.has(k)) byTopic.set(k, []);
    byTopic.get(k).push(d);
  }
  const out = [];
  for (const group of byTopic.values()) {
    if (group.length < 2) { out.push(...group); continue; }
    const stances = new Set(group.map((d) => d.stance).filter(Boolean));
    const hasExplicitRevision = group.some((d) => d.revisionOf || d.retractionEvidence);
    if (stances.size > 1 && !hasExplicitRevision) {
      const ids = group.map((d) => d.itemId);
      for (const d of group) {
        out.push({ ...d, lifecycle: 'unclear', conflictWith: ids.filter((i) => i !== d.itemId) });
      }
    } else if (hasExplicitRevision) {
      // Mark the revised-away items superseded; keep the revising item as-is.
      const supersededIds = new Set(group.filter((d) => d.revisionOf).map((d) => d.revisionOf));
      for (const d of group) {
        out.push(supersededIds.has(d.itemId) ? { ...d, lifecycle: 'superseded' } : d);
      }
    } else {
      out.push(...group);
    }
  }
  return out;
}

// deriveFinalPresence(validatedItems) -> presence flags.
//   Computed AFTER complete extraction + validation across the whole source, not
//   from a sample. A section is "present" only if at least one grounded item of
//   that kind survived validation.
function deriveFinalPresence(items) {
  const has = (kind) => items.some((it) => it.kind === kind);
  return {
    decisions: has('decision'),
    commitments: has('commitment'),
    actions: has('task'),
    quotes: has('quote'),
    risks: has('risk'),
    questions: has('question'),
    advice: has('advice'),
    ctas: has('cta'),
  };
}

module.exports = {
  LIFECYCLE, OWNER_MIN, DUE_MIN,
  validateTask, validateCommitment, validateDecision,
  reconcileDecisions, deriveFinalPresence, spanGrounded,
  hasHypotheticalModality, hasAffirmativeDecision, HYPOTHETICAL, AFFIRMATIVE_DECISION,
};
