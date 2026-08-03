// text.js — canonical text + stable raw-word anchoring.
//
// Contract amendment (spec §0.2): raw word ranges are the PRIMARY evidence
// anchor; character offsets, normalized offsets and timestamps are DERIVED.
// The offset rules here are the single cross-platform definition so Python,
// web, Electron and Tauri cannot disagree.
//
// THE RULES (must be implemented identically on every platform):
//   1. Canonical form = Unicode NFC, with every CRLF and lone CR folded to LF.
//   2. All offsets are counted in Unicode CODE POINTS (not UTF-16 code units,
//      not bytes). JS: Array.from(str). Python: list(str). Both yield the same
//      sequence, so index i means the same character everywhere.
//   3. A "word" is a maximal run of non-whitespace code points. Words are
//      numbered 0..N-1 in document order; that number is the stable wordId.
//   4. A word range [a, b] is INCLUSIVE of both endpoints. Its raw text is the
//      canonical slice [words[a].start, words[b].end) — this reproduces the
//      original inter-word spacing exactly.

'use strict';

// canonicalize(raw) -> canonical string (NFC + LF newlines).
function canonicalize(raw) {
  let t = String(raw == null ? '' : raw);
  t = t.replace(/\r\n?/g, '\n'); // CRLF and lone CR -> LF
  t = t.normalize('NFC');
  return t;
}

const WS = /\s/;

// tokenize(canonicalText) -> { cps, words }
//   cps   : array of code points (index == code-point offset)
//   words : [{ id, start, end, text }]  start inclusive, end exclusive (code points)
function tokenize(canonicalText) {
  const cps = Array.from(canonicalText);
  const n = cps.length;
  const words = [];
  let i = 0;
  while (i < n) {
    while (i < n && WS.test(cps[i])) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && !WS.test(cps[i])) i++;
    const end = i; // exclusive
    words.push({ id: words.length, start, end, text: cps.slice(start, end).join('') });
  }
  return { cps, words };
}

// rawTextForRange(cps, words, a, b) -> exact canonical substring for word range
// [a, b] inclusive. This is how the backend CONSTRUCTS quote/evidence rawText —
// it is never taken from a model.
function rawTextForRange(cps, words, a, b) {
  assertRange(words, a, b);
  return cps.slice(words[a].start, words[b].end).join('');
}

// charOffsetsForRange -> derived code-point [start, end) for a word range.
function charOffsetsForRange(words, a, b) {
  assertRange(words, a, b);
  return { charStart: words[a].start, charEnd: words[b].end };
}

// deriveTimestamps(words, a, b, asrTimings)
//   asrTimings: optional array aligned 1:1 with words, each { t0, t1 } (seconds).
//   Returns { timeStart, timeEnd, audioMapped }. When timings are absent or the
//   count does not match the tokenization we DO NOT guess — audioMapped=false.
function deriveTimestamps(words, a, b, asrTimings) {
  if (!Array.isArray(asrTimings) || asrTimings.length !== words.length) {
    return { timeStart: null, timeEnd: null, audioMapped: false };
  }
  const s = asrTimings[a];
  const e = asrTimings[b];
  if (!s || !e || typeof s.t0 !== 'number' || typeof e.t1 !== 'number') {
    return { timeStart: null, timeEnd: null, audioMapped: false };
  }
  return { timeStart: s.t0, timeEnd: e.t1, audioMapped: true };
}

// resolvePhraseRange(words, phrase) -> [a, b] | null
//   Utility used by fixtures/tests to turn a human phrase into a stable word
//   range against real text. Matches on a whitespace-insensitive, casefolded
//   comparison of the phrase's word tokens against consecutive document words.
//   Deterministic: returns the FIRST match. Not used on the hot path.
function resolvePhraseRange(words, phrase) {
  const norm = (s) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const target = Array.from(canonicalize(phrase).split(WS.source ? /\s+/ : /\s+/))
    .map((w) => w.trim())
    .filter(Boolean)
    .map(norm)
    .filter(Boolean);
  if (!target.length) return null;
  const docNorm = words.map((w) => norm(w.text));
  for (let i = 0; i + target.length <= docNorm.length; i++) {
    let ok = true;
    for (let k = 0; k < target.length; k++) {
      if (docNorm[i + k] !== target[k]) { ok = false; break; }
    }
    if (ok) return [i, i + target.length - 1];
  }
  return null;
}

// resolvePhraseRangeWithin(words, phrase, lo, hi) -> [a,b] within [lo,hi] | null.
//   EXACT, normalized, contiguous match — never fuzzy. This is how a model's
//   proposed quote text is turned into a raw-word range: if the exact wording is
//   not present, the proposal is REJECTED (returns null), never approximated.
//   That is the anti-corruption guarantee (a model that rewrites "RY" to "ROI"
//   fails to resolve and is dropped, rather than silently matched).
function resolvePhraseRangeWithin(words, phrase, lo = 0, hi = words.length - 1) {
  const norm = (s) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const target = String(phrase).split(/\s+/).map((w) => norm(w)).filter(Boolean);
  if (!target.length) return null;
  const top = Math.min(hi, words.length - 1);
  for (let i = Math.max(0, lo); i + target.length - 1 <= top; i++) {
    let ok = true;
    for (let k = 0; k < target.length; k++) if (norm(words[i + k].text) !== target[k]) { ok = false; break; }
    if (ok) return [i, i + target.length - 1];
  }
  return null;
}

function assertRange(words, a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b >= words.length) {
    throw new RangeError(`invalid word range [${a}, ${b}] against ${words.length} words`);
  }
}

// rawContentVersion(canonicalText) -> short stable hash for raw_version tracking.
function rawContentVersion(canonicalText) {
  return require('crypto').createHash('sha256').update(canonicalText, 'utf8').digest('hex').slice(0, 16);
}

module.exports = {
  canonicalize,
  tokenize,
  rawTextForRange,
  charOffsetsForRange,
  deriveTimestamps,
  resolvePhraseRange,
  resolvePhraseRangeWithin,
  rawContentVersion,
  assertRange,
};
