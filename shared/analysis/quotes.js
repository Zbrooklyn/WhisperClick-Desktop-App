// quotes.js — quotes are CONSTRUCTED from raw evidence ranges.
//
// Contract amendment (spec §0.2): extraction selects raw word ranges; the
// backend constructs rawText directly from those ranges. The model NEVER
// generates verbatim text that we later fuzzy-match. A normalized displayText
// may be shown, but every meaning-changing correction stays visible and is
// linked to the raw wording it replaces.
//
// This is the fix for the audited "RY -> ROI" class of defect: the raw text is
// preserved verbatim (RY), and a correction record carries the normalized form
// (ROI) with a reason, rather than silently rewriting the quote.

'use strict';

const { buildEvidence } = require('./evidence');
const text = require('./text');

// constructQuote({ itemId, evidenceId, rawWordRange, cps, words, asrTimings,
//                  corrections, structureUnitId })
//   corrections: optional [{ rawWordRange, to, reason, kind }]. `from` is filled
//   in from the raw text so it can never drift from what the transcript says.
function constructQuote(args) {
  const {
    itemId, evidenceId, rawWordRange, cps, words, asrTimings,
    corrections = [], structureUnitId = null,
  } = args;

  const evidence = buildEvidence({ evidenceId, rawWordRange, cps, words, asrTimings });

  const resolvedCorrections = corrections.map((c) => {
    const [a, b] = c.rawWordRange;
    const from = text.rawTextForRange(cps, words, a, b);
    return {
      rawWordRange: [a, b],
      from,                 // what the raw transcript literally says
      to: String(c.to),     // the normalized replacement
      reason: c.reason || 'normalization',
      kind: c.kind || 'meaning-changing',
    };
  });

  // displayText: start from the constructed raw text and apply corrections
  // left-to-right by character offset. Corrections are transparent (kept in the
  // record), never hidden.
  const displayText = applyCorrections(cps, words, evidence.rawWordRange, resolvedCorrections);

  return {
    itemId,
    kind: 'quote',
    evidence,
    rawText: evidence.rawText,     // authoritative, verbatim
    displayText,                   // normalized surface, derived + transparent
    corrections: resolvedCorrections,
    structureUnitId,
  };
}

// applyCorrections — rebuild the display string by substituting each corrected
// sub-range's text. Operates on the quote's own word range so offsets are local.
function applyCorrections(cps, words, [qa, qb], corrections) {
  if (!corrections.length) return text.rawTextForRange(cps, words, qa, qb);
  // Work at code-point granularity within the quote span.
  const spanStart = words[qa].start;
  const spanEnd = words[qb].end;
  const pieces = [];
  let cursor = spanStart;
  const ordered = [...corrections].sort((x, y) => words[x.rawWordRange[0]].start - words[y.rawWordRange[0]].start);
  for (const c of ordered) {
    const cs = words[c.rawWordRange[0]].start;
    const ce = words[c.rawWordRange[1]].end;
    if (cs < cursor || ce > spanEnd) continue; // out of span / overlapping; skip defensively
    pieces.push(cps.slice(cursor, cs).join(''));
    pieces.push(c.to);
    cursor = ce;
  }
  pieces.push(cps.slice(cursor, spanEnd).join(''));
  return pieces.join('');
}

module.exports = { constructQuote, applyCorrections };
