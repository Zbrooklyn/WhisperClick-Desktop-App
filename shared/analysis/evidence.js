// evidence.js — evidence anchors.
//
// Contract amendments (spec §0.2):
//  - Raw word ranges are the PRIMARY anchor; char offsets / normalized offsets /
//    timestamps are DERIVED.
//  - Raw transcript is source-of-record, NOT verified truth. Three distinct
//    match states, strictly ordered in strength:
//        transcriptMatched  the range exists in the raw transcript (always true
//                           for a constructed anchor)
//        audioMapped        the range additionally maps to ASR word timings
//        audioVerified      a human/tool confirmed the ASR wording is correct
//    Mapping to timings (audioMapped) never implies the wording is correct
//    (audioVerified). audioVerified is only ever set by an explicit verify step,
//    never inferred here.

'use strict';

const text = require('./text');

const MATCH_STATES = Object.freeze(['transcriptMatched', 'audioMapped', 'audioVerified']);

// buildEvidence({ evidenceId, rawWordRange, cps, words, asrTimings })
function buildEvidence({ evidenceId, rawWordRange, cps, words, asrTimings }) {
  if (!Array.isArray(rawWordRange) || rawWordRange.length !== 2) {
    throw new TypeError('rawWordRange must be [startWordId, endWordId]');
  }
  const [a, b] = rawWordRange;
  text.assertRange(words, a, b);

  const rawText = text.rawTextForRange(cps, words, a, b);
  const { charStart, charEnd } = text.charOffsetsForRange(words, a, b);
  const ts = text.deriveTimestamps(words, a, b, asrTimings);

  return {
    evidenceId,
    // PRIMARY anchor:
    rawWordRange: [a, b],
    // DERIVED (never authoritative on their own):
    derived: {
      charStart,
      charEnd,
      timeStart: ts.timeStart,
      timeEnd: ts.timeEnd,
    },
    // Constructed directly from the raw range — this is the record of what the
    // transcript literally says, defects and all.
    rawText,
    // Strength of the mapping, never an assertion that the wording is correct.
    matchState: ts.audioMapped ? 'audioMapped' : 'transcriptMatched',
  };
}

// markAudioVerified — the ONLY way to reach audioVerified. Requires an explicit
// verifier token so it can never be produced by inference.
function markAudioVerified(evidence, verifier) {
  if (!verifier) throw new Error('audioVerified requires an explicit verifier');
  return { ...evidence, matchState: 'audioVerified', verifiedBy: String(verifier) };
}

function isGrounded(evidence, words) {
  if (!evidence || !Array.isArray(evidence.rawWordRange)) return false;
  const [a, b] = evidence.rawWordRange;
  return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a && b < words.length;
}

module.exports = { MATCH_STATES, buildEvidence, markAudioVerified, isGrounded };
