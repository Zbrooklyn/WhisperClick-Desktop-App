// profile.js — multidimensional content profile.
//
// Contract amendment (spec §0.2): a profile is built from a representative
// SAMPLE and is therefore PROVISIONAL. It may guide extraction and narrow
// presentation, but it can NEVER authoritatively declare the whole transcript
// has no decisions / commitments / CTAs / risks, and it must never be used to
// hard-suppress evidence found elsewhere. Final presence is computed after full
// extraction + validation (see validate.deriveFinalPresence).

'use strict';

// buildProfilePrompt(sampleText) -> chat messages for a real adapter. Kept here
// so the prompt travels with the contract.
function buildProfilePrompt(sampleText) {
  return [
    { role: 'system', content:
      'You classify a transcript sample. Return JSON with contentTypes (array of ' +
      '{type, confidence}) and provisionalPresence (object of booleans for ' +
      'decisions, commitments, ctas, risks, questions). These are HINTS from a ' +
      'sample only; do not assert absence for the whole document.' },
    { role: 'user', content: String(sampleText).slice(0, 6000) },
  ];
}

// normalizeProfile(modelOut) -> a profile object with everything marked
// provisional. The `provisional: true` flag is load-bearing: downstream code
// asserts it and refuses to suppress on a provisional profile.
function normalizeProfile(modelOut) {
  const out = modelOut || {};
  return {
    provisional: true,
    contentTypes: Array.isArray(out.contentTypes) ? out.contentTypes : [],
    provisionalPresence: out.provisionalPresence && typeof out.provisionalPresence === 'object'
      ? { ...out.provisionalPresence }
      : {},
    sampledOnly: true,
  };
}

// eligiblePresentation(profile) -> which sections a template MAY present, based
// on content type. This narrows PRESENTATION only; it does not gate extraction
// or discard evidence. Returns a permissive default when unsure.
function eligiblePresentation(profile) {
  const types = new Set((profile.contentTypes || []).map((c) => (c.type || c).toString().toLowerCase()));
  const isMeeting = types.has('meeting') || types.has('call');
  return {
    // Educational / monologue content still MAY show advice/CTAs/quotes; it just
    // does not lead with a Decisions/Action-items frame.
    leadWithDecisions: isMeeting,
    leadWithActions: isMeeting,
    showAdvice: true,
    showCtas: true,
    showQuotes: true,
    note: 'presentation eligibility only — never suppresses discovered evidence',
  };
}

module.exports = { buildProfilePrompt, normalizeProfile, eligiblePresentation };
