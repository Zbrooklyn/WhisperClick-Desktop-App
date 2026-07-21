'use strict';
// foundation.test.js — text/anchoring, quotes, evidence, ids, flag, segment.

const test = require('node:test');
const assert = require('node:assert/strict');

const text = require('../text');
const { buildEvidence } = require('../evidence');
const { constructQuote } = require('../quotes');
const ids = require('../ids');
const flag = require('../flag');
const segment = require('../segment');

test('canonicalize folds CRLF/CR to LF and applies NFC', () => {
  assert.equal(text.canonicalize('a\r\nb\rc'), 'a\nb\nc');
  // é as e + combining accent (NFD) -> single code point (NFC)
  const nfd = 'é';
  assert.equal(text.canonicalize(nfd), 'é');
});

test('tokenize gives stable word ids and code-point offsets', () => {
  const t = text.canonicalize('Hello  world,\nfoo');
  const { cps, words } = text.tokenize(t);
  assert.deepEqual(words.map((w) => w.text), ['Hello', 'world,', 'foo']);
  assert.deepEqual(words.map((w) => w.id), [0, 1, 2]);
  // range [0,1] reproduces original spacing exactly (two spaces preserved)
  assert.equal(text.rawTextForRange(cps, words, 0, 1), 'Hello  world,');
});

test('rawTextForRange reproduces exact inter-word spacing', () => {
  const t = text.canonicalize('one   two\tthree');
  const { cps, words } = text.tokenize(t);
  assert.equal(text.rawTextForRange(cps, words, 0, 2), 'one   two\tthree');
  assert.deepEqual(text.charOffsetsForRange(words, 0, 0), { charStart: 0, charEnd: 3 });
});

test('offsets are code points, not UTF-16 units (astral safe)', () => {
  // 😀 is one code point but two UTF-16 units. Word after it must have the
  // right code-point offset.
  const t = text.canonicalize('😀 tail');
  const { cps, words } = text.tokenize(t);
  assert.equal(cps.length, 6); // 😀, space, t,a,i,l
  assert.equal(words[1].text, 'tail');
  assert.equal(words[1].start, 2); // code point index, not 3
  assert.equal(text.rawTextForRange(cps, words, 1, 1), 'tail');
});

test('deriveTimestamps only maps when timings align 1:1', () => {
  const { words } = text.tokenize('a b c');
  assert.deepEqual(text.deriveTimestamps(words, 0, 2, null), { timeStart: null, timeEnd: null, audioMapped: false });
  const timings = [{ t0: 0, t1: 1 }, { t0: 1, t1: 2 }, { t0: 2, t1: 3 }];
  assert.deepEqual(text.deriveTimestamps(words, 0, 2, timings), { timeStart: 0, timeEnd: 3, audioMapped: true });
  // wrong length -> no guess
  assert.equal(text.deriveTimestamps(words, 0, 2, [{ t0: 0, t1: 1 }]).audioMapped, false);
});

test('evidence: primary anchor is the raw word range; matchState reflects mapping only', () => {
  const t = text.canonicalize('the quick brown fox');
  const { cps, words } = text.tokenize(t);
  const ev = buildEvidence({ evidenceId: 'evid_x', rawWordRange: [1, 2], cps, words });
  assert.deepEqual(ev.rawWordRange, [1, 2]);
  assert.equal(ev.rawText, 'quick brown');
  assert.equal(ev.matchState, 'transcriptMatched'); // no timings -> not audioMapped
  const mapped = buildEvidence({ evidenceId: 'evid_y', rawWordRange: [0, 0], cps, words, asrTimings: words.map((_, i) => ({ t0: i, t1: i + 1 })) });
  assert.equal(mapped.matchState, 'audioMapped');
});

test('quotes are constructed from ranges; corrections keep raw verbatim and record the change', () => {
  const t = text.canonicalize('please prove RY now');
  const { cps, words } = text.tokenize(t);
  const q = constructQuote({
    itemId: 'item_1', evidenceId: 'evid_1', rawWordRange: [1, 2], cps, words,
    corrections: [{ rawWordRange: [2, 2], to: 'ROI', reason: 'ASR error' }],
  });
  assert.equal(q.rawText, 'prove RY');          // verbatim, preserved
  assert.equal(q.displayText, 'prove ROI');      // normalized surface
  assert.equal(q.corrections[0].from, 'RY');     // change is transparent
  assert.equal(q.corrections[0].to, 'ROI');
});

test('typed ids are distinct and asserted at boundaries', () => {
  const f = ids.createIdFactory({ rand: (() => { let n = 0; return () => `u${n++}`; })() });
  const arun = f.analysisRunId();
  const item = f.itemId();
  assert.equal(ids.kindOf(arun), 'analysisRun');
  assert.equal(ids.kindOf(item), 'item');
  assert.ok(ids.isId(arun, 'analysisRun'));
  assert.throws(() => ids.assertId(item, 'evidence', 'boundary'), /expected evidence id/);
});

test('flag defaults OFF and reads env truthiness', () => {
  assert.equal(flag.enabled({ env: {} }), false);
  assert.equal(flag.enabled({ env: { WC_ANALYSIS_V2: '1' } }), true);
  assert.equal(flag.enabled({ env: { WC_ANALYSIS_V2: 'off' } }), false);
  assert.equal(flag.enabled({ override: true }), true);
});

test('windowSegments fully tiles a long document with sentence-aligned overlap', () => {
  // 500 short sentences -> well over one window at a small window size.
  const src = Array.from({ length: 500 }, (_, i) => `word${i}a word${i}b.`).join(' ');
  const { words } = text.tokenize(text.canonicalize(src));
  const segs = segment.windowSegments(words, { windowTokens: 200, sentenceOverlap: 1 });
  assert.ok(segs.length > 1);
  // union covers every word, contiguously (no gap between consecutive windows)
  assert.equal(segs[0].range[0], 0);
  assert.equal(segs[segs.length - 1].range[1], words.length - 1);
  for (let i = 1; i < segs.length; i++) {
    assert.ok(segs[i].range[0] <= segs[i - 1].range[1] + 1, `gap before segment ${i}`);
  }
});

test('mergeStructureUnits dedups, orders, and clips overlaps', () => {
  const merged = segment.mergeStructureUnits([
    { title: 'b', range: [10, 20] },
    { title: 'a', range: [0, 5] },
    { title: 'dup', range: [0, 5] },
    { title: 'overlap', range: [4, 12] },
  ], 100);
  // exact dup dropped; overlapping ranges have their START clipped past the
  // previous unit so the sequence is strictly ordered and non-overlapping.
  assert.deepEqual(merged.map((u) => u.range), [[0, 5], [6, 12], [13, 20]]);
  assert.deepEqual(merged.map((u) => u.index), [0, 1, 2]);
});
