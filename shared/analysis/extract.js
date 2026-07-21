// extract.js — per-segment extraction: prompt-building + normalization into
// typed, evidence-anchored items.
//
// Contract amendments (spec §0.2):
//  - The model SELECTS raw word ranges; it does not author verbatim text. Quote
//    rawText is constructed here from the range (never from the model).
//  - Every item is anchored to raw evidence. Relationship spans (actor/task/due/
//    commitment cue) are carried through so the validator can enforce them.

'use strict';

const { constructQuote } = require('./quotes');
const { buildEvidence } = require('./evidence');

// buildExtractPrompt(segmentText, ctx) -> chat messages for a real adapter.
function buildExtractPrompt(segmentText, ctx = {}) {
  const off = ctx.globalWordOffset || 0;
  return [
    { role: 'system', content:
      'Extract structured items from this transcript segment. Word ids are GLOBAL ' +
      `and start at ${off} for the first word of this segment. For every item, ` +
      'return raw word ranges [startWordId, endWordId] as evidence. Do NOT write ' +
      'quote text yourself — only select ranges; the system builds the text. ' +
      'For tasks, include actorSpan/taskSpan/dueSpan/commitmentCueSpan when and ' +
      'only when they are explicitly present. For decisions, include a ' +
      'decisionCueSpan only when there is explicit decision language. Never invent ' +
      'owners, dates, decisions, or commitments.' },
    { role: 'user', content: String(segmentText).slice(0, 12000) },
  ];
}

// normalizeExtraction(rawItems, ctx) -> typed items ready for validation.
//   ctx = { ids, cps, words, asrTimings }
//   rawItems from the adapter: { kind, range, ...spans, text?, corrections?, ... }
function normalizeExtraction(rawItems, ctx) {
  const { ids, cps, words, asrTimings } = ctx;
  const out = [];
  for (const raw of rawItems || []) {
    if (!Array.isArray(raw.range)) continue;
    const kind = raw.kind || 'note';
    if (kind === 'quote') {
      out.push(constructQuote({
        itemId: ids.itemId(),
        evidenceId: ids.evidenceId(),
        rawWordRange: raw.range,
        cps, words, asrTimings,
        corrections: raw.corrections || [],
        structureUnitId: raw.structureUnitId || null,
      }));
      continue;
    }
    // Non-quote items: anchor a primary evidence to the item's own range, and
    // carry any relationship spans verbatim for the validator to enforce.
    const evidence = buildEvidence({ evidenceId: ids.evidenceId(), rawWordRange: raw.range, cps, words, asrTimings });
    const item = {
      itemId: ids.itemId(),
      kind,
      evidence,
      // display text is derived from the raw range unless the caller supplies a
      // normalized surface; it is never treated as verbatim truth.
      text: raw.displayText != null ? String(raw.displayText) : evidence.rawText,
      structureUnitId: raw.structureUnitId || null,
    };
    // Relationship / cue spans, plus the CONSTRUCTED text for each (sliced from
    // the raw range, never taken from the model) so validators can reason about
    // the actual wording without re-deriving offsets.
    for (const span of ['actorSpan', 'taskSpan', 'dueSpan', 'commitmentCueSpan', 'decisionCueSpan']) {
      if (!Array.isArray(raw[span])) continue;
      const [sa, sb] = raw[span];
      if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < sa || sb >= words.length) continue;
      item[span] = [sa, sb];
      item[span.replace(/Span$/, 'Text')] = require('./text').rawTextForRange(cps, words, sa, sb);
    }
    if (raw.owner != null) item.owner = String(raw.owner);
    if (raw.due != null) item.due = String(raw.due);
    if (raw.relationshipConfidence != null) item.relationshipConfidence = Number(raw.relationshipConfidence);
    if (raw.lifecycle != null) item.lifecycle = String(raw.lifecycle);
    if (raw.stance != null) item.stance = String(raw.stance);
    if (raw.topicKey != null) item.topicKey = String(raw.topicKey);
    if (raw.revisionOf != null) item.revisionOf = String(raw.revisionOf);
    if (raw.retractionEvidence != null) item.retractionEvidence = !!raw.retractionEvidence;
    out.push(item);
  }
  return out;
}

module.exports = { buildExtractPrompt, normalizeExtraction };
