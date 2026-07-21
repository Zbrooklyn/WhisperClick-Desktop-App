// merge.js — dedup + validation reduce stage.
//
// Contract amendment (spec §0.1 #5): dedup order is
//   1. exact evidence / span overlap,
//   2. lexical similarity,
//   3. adjudication only for the unresolved remainder.
// NO embeddings dependency in v1. Unresolved near-duplicates are flagged
// needsAdjudication rather than silently merged or dropped.

'use strict';

const validate = require('./validate');

// rangeOverlap(a, b) -> true when two inclusive word ranges overlap or touch.
function rangeOverlap(a, b) {
  return a[0] <= b[1] && b[0] <= a[1];
}
function rangeEqual(a, b) { return a[0] === b[0] && a[1] === b[1]; }
function rangeContains(a, b) { return a[0] <= b[0] && a[1] >= b[1]; }

function primaryRange(item) {
  return item.evidence && Array.isArray(item.evidence.rawWordRange) ? item.evidence.rawWordRange : null;
}

// lexical similarity via token Jaccard on the item's display/raw text.
function tokens(s) {
  return new Set(String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
}
function jaccard(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const LEX_SIM = 0.9;

// dedupeItems(items) -> { items, dropped, needsAdjudication }
//   Compares only items of the same kind. Exact/containment overlap => keep the
//   wider range. High lexical similarity on overlapping ranges => merge. High
//   lexical similarity WITHOUT range overlap => flag needsAdjudication (do not
//   guess).
function dedupeItems(items) {
  const kept = [];
  const dropped = [];
  const needsAdjudication = [];

  for (const item of items) {
    const r = primaryRange(item);
    let merged = false;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i];
      if (k.kind !== item.kind) continue;
      const kr = primaryRange(k);
      if (r && kr && rangeOverlap(r, kr)) {
        // Stage 1: exact / containment overlap -> keep the wider evidence range.
        if (rangeEqual(r, kr) || rangeContains(kr, r)) { dropped.push(item); merged = true; break; }
        if (rangeContains(r, kr)) { kept[i] = item; dropped.push(k); merged = true; break; }
        // Stage 2: overlapping + lexically similar -> merge (keep wider span).
        const textA = item.displayText || item.text || '';
        const textB = k.displayText || k.text || '';
        if (jaccard(textA, textB) >= LEX_SIM) {
          const wider = (r[1] - r[0]) >= (kr[1] - kr[0]) ? item : k;
          const loser = wider === item ? k : item;
          kept[i] = wider; dropped.push(loser); merged = true; break;
        }
      }
    }
    if (merged) continue;

    // Stage 2b: lexically identical but non-overlapping ranges -> adjudicate.
    const twin = kept.find((k) => k.kind === item.kind && !rangeOverlap(primaryRange(k) || [-1, -1], r || [-2, -2])
      && jaccard(item.displayText || item.text, k.displayText || k.text) >= LEX_SIM);
    if (twin) needsAdjudication.push({ a: twin.itemId, b: item.itemId, reason: 'lexical-dup-distinct-ranges' });

    kept.push(item);
  }
  return { items: kept, dropped, needsAdjudication };
}

// finalizeItems(items, words) -> { items, presence, validation }
//   Runs the per-kind validators (suppressing ungrounded/uncued claims),
//   reconciles decisions, dedupes, then derives final presence from survivors.
function finalizeItems(items, words) {
  const issues = [];
  const surviving = [];
  const decisions = [];

  for (const it of items) {
    if (it.kind === 'task') {
      const { item, dropped, issues: is } = validate.validateTask(it, words);
      if (is.length) issues.push({ itemId: it.itemId, issues: is });
      if (!dropped) surviving.push(item);
      else issues.push({ itemId: it.itemId, dropped: true });
    } else if (it.kind === 'commitment') {
      const { item, dropped, issues: is } = validate.validateCommitment(it, words);
      if (is.length) issues.push({ itemId: it.itemId, issues: is });
      if (!dropped) surviving.push(item);
    } else if (it.kind === 'decision') {
      const { item, dropped, issues: is } = validate.validateDecision(it, words);
      if (is.length) issues.push({ itemId: it.itemId, issues: is });
      if (!dropped) decisions.push(item);
    } else {
      // quotes / advice / cta / question / risk: require grounded primary evidence.
      const r = primaryRange(it);
      if (r && validate.spanGrounded(r, words)) surviving.push(it);
      else issues.push({ itemId: it.itemId, issues: ['ungrounded→dropped'] });
    }
  }

  const reconciled = validate.reconcileDecisions(decisions);
  const all = surviving.concat(reconciled);
  const deduped = dedupeItems(all);
  const presence = validate.deriveFinalPresence(deduped.items);

  return {
    items: deduped.items,
    presence,
    validation: {
      issues,
      dropped: deduped.dropped.map((d) => d.itemId),
      needsAdjudication: deduped.needsAdjudication,
    },
  };
}

module.exports = { dedupeItems, finalizeItems, jaccard, rangeOverlap };
