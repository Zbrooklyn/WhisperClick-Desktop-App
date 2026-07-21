// segment.js — adaptive, structure-aligned segmentation.
//
// Contract amendments (spec §0.1 #4, §0.2):
//  - Adaptive, structure-aligned segmentation with a configurable fallback
//    window (~1,800 tokens, sentence-aligned overlap).
//  - Structure is detected across the COMPLETE source: short inputs from the
//    full transcript; long inputs by detecting local units per segment then
//    merging globally. A profile SAMPLE alone can never detect every unit.
//
// Two deterministic primitives live here and are fully unit-tested:
//   windowSegments()      — the fallback tiling that guarantees full coverage.
//   mergeStructureUnits() — global normalization/merge of local unit candidates.
// The semantic act of *detecting* candidate units is a model/adapter call
// (see model-adapter.js); this module only tiles and merges deterministically.

'use strict';

const DEFAULT_WINDOW_TOKENS = 1800;
const DEFAULT_SENTENCE_OVERLAP = 1;

// findSentenceStarts(words) -> ascending list of word ids that begin a sentence.
// A sentence starts at word 0 and after any word ending in . ? ! (…): the next
// word begins a new sentence. Deterministic, punctuation-based.
function findSentenceStarts(words) {
  const starts = [0];
  for (let i = 0; i < words.length - 1; i++) {
    if (/[.?!…]["')\]]?$/.test(words[i].text)) starts.push(i + 1);
  }
  return starts;
}

// windowSegments(words, opts) -> [{ index, range:[a,b] }]
//   Tiles the whole word list into windows of ~windowTokens, snapping each
//   window's END to a sentence boundary and overlapping the NEXT window back by
//   `sentenceOverlap` sentences. Guarantees: word 0 is covered, the last word is
//   covered, and consecutive windows are contiguous or overlapping (no gap).
function windowSegments(words, opts = {}) {
  const windowTokens = opts.windowTokens || DEFAULT_WINDOW_TOKENS;
  const sentenceOverlap = opts.sentenceOverlap == null ? DEFAULT_SENTENCE_OVERLAP : opts.sentenceOverlap;
  const n = words.length;
  if (n === 0) return [];
  if (n <= windowTokens) return [{ index: 0, range: [0, n - 1] }];

  const starts = findSentenceStarts(words);
  const segs = [];
  let cursor = 0;
  while (cursor < n) {
    const hardEnd = Math.min(cursor + windowTokens - 1, n - 1);
    // Snap end down to the last sentence boundary <= hardEnd+1, but keep at least
    // one full window of progress so we always move forward.
    let end = hardEnd;
    if (hardEnd < n - 1) {
      const boundary = lastBoundaryAtOrBefore(starts, hardEnd + 1);
      if (boundary != null && boundary - 1 > cursor) end = boundary - 1;
    }
    segs.push({ index: segs.length, range: [cursor, end] });
    if (end >= n - 1) break;
    // Next window starts `sentenceOverlap` sentences before `end+1`.
    const nextStart = backUpSentences(starts, end + 1, sentenceOverlap);
    cursor = Math.max(nextStart, cursor + 1); // guarantee forward progress
  }
  return segs;
}

function lastBoundaryAtOrBefore(starts, wordId) {
  let best = null;
  for (const s of starts) { if (s <= wordId) best = s; else break; }
  return best;
}
function backUpSentences(starts, wordId, k) {
  // Find index of the first start >= wordId, step back k sentences.
  let idx = starts.length - 1;
  for (let i = 0; i < starts.length; i++) { if (starts[i] >= wordId) { idx = i; break; } }
  return starts[Math.max(0, idx - k)] ?? 0;
}

// mergeStructureUnits(candidates, totalWords) -> ordered, non-overlapping units.
//   candidates: [{ title?, range:[a,b], kind? }] possibly overlapping / unordered
//   / duplicated (as produced by per-segment local detection). We:
//     1. drop invalid ranges,
//     2. sort by start,
//     3. merge exact duplicates and containment,
//     4. clip overlaps so the sequence is strictly ordered and non-overlapping.
//   The result is the global structure. It does NOT invent coverage — gaps
//   between units are legal (not every word belongs to a titled unit).
function mergeStructureUnits(candidates, totalWords) {
  const valid = (candidates || [])
    .filter((c) => Array.isArray(c.range) && Number.isInteger(c.range[0]) && Number.isInteger(c.range[1])
      && c.range[0] >= 0 && c.range[1] >= c.range[0] && c.range[1] < totalWords)
    .map((c) => ({ title: c.title || null, kind: c.kind || 'unit', range: [c.range[0], c.range[1]] }))
    .sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);

  const out = [];
  for (const c of valid) {
    const prev = out[out.length - 1];
    if (!prev) { out.push(c); continue; }
    if (c.range[0] === prev.range[0] && c.range[1] === prev.range[1]) continue; // exact dup
    if (c.range[0] <= prev.range[1]) {
      // overlap: clip current to start after prev; drop if it vanishes
      const clippedStart = prev.range[1] + 1;
      if (clippedStart > c.range[1]) continue; // fully contained -> drop
      c.range[0] = clippedStart;
    }
    out.push(c);
  }
  return out.map((u, i) => ({ ...u, index: i }));
}

module.exports = {
  DEFAULT_WINDOW_TOKENS, DEFAULT_SENTENCE_OVERLAP,
  findSentenceStarts, windowSegments, mergeStructureUnits,
};
