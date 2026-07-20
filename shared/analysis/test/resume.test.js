'use strict';
// resume.test.js — the partial-analysis recovery path.
// Required scenarios: one failed middle segment; multiple failed non-adjacent
// segments; provider outage during resume; app restart before resume; duplicate
// resume; cancellation during resume; successful final consolidation.

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const textMod = require('../text');
const segmentMod = require('../segment');
const { createAnalysisStore } = require('../store');
const { createFixtureAdapter } = require('../model-adapter');
const { createIdFactory } = require('../ids');
const { executeRun, resumeRun } = require('../resume');
const ashley = require('../corpus/ashley-gross');

const WINDOW = 400; // small window -> many segments, so failures can be targeted

function corpus() {
  const built = ashley.build();
  const { words } = textMod.tokenize(built.canonical);
  const segs = segmentMod.windowSegments(words, { windowTokens: WINDOW });
  return { canonical: built.canonical, recorded: built.recorded, segs };
}

// An adapter whose extract fails for chosen segment indices. `failing` is a live
// Set so a later resume can "heal" the provider. Records per-index call counts.
function makeAdapter(segs, recorded, failing, opts = {}) {
  const base = createFixtureAdapter(recorded);
  const calls = { profile: 0, structure: 0, byIndex: new Map(), total: 0 };
  const indexOf = (range) => segs.findIndex((s) => s.range[0] === range[0] && s.range[1] === range[1]);
  return {
    calls,
    modelPolicy: base.modelPolicy,
    capabilities: () => base.capabilities(),
    async profile(a) { calls.profile++; calls.total++; return base.profile(a); },
    async detectStructure(a) { calls.structure++; calls.total++; return base.detectStructure(a); },
    async extract(a, ctx = {}) {
      const i = indexOf(a.range);
      calls.byIndex.set(i, (calls.byIndex.get(i) || 0) + 1);
      calls.total++;
      if (ctx.signal && ctx.signal.aborted) { const e = new Error('aborted'); e.code = 'INTERRUPTED'; throw e; }
      if (opts.onExtract) opts.onExtract(i);
      if (failing.has(i)) { const e = new Error('provider down'); e.code = 'PROVIDER_ERROR'; throw e; }
      return base.extract(a);
    },
  };
}

function memStore() {
  let n = 1;
  return createAnalysisStore(':memory:', { now: () => n++ });
}

test('one failed middle segment -> partial, then resume retries ONLY that segment', async () => {
  const { canonical, recorded, segs } = corpus();
  const mid = Math.floor(segs.length / 2);
  const failing = new Set([mid]);
  const store = memStore();
  const adapter = makeAdapter(segs, recorded, failing);

  const first = await executeRun({ store, noteId: 'n1', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW });
  assert.equal(first.run.analysis_status, 'partial', 'run is visibly partial');
  assert.equal(first.run.processing_coverage.complete, false);
  assert.ok(first.run.processing_coverage.failedRanges.length >= 1, 'failed range is visible');

  // heal the provider and resume
  failing.clear();
  const before = new Map(adapter.calls.byIndex);
  const second = await resumeRun({ store, analysisRunId: first.run.analysis_run_id, noteId: 'n1', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW });

  assert.equal(second.segmentsRun, 1, 'exactly one segment re-run');
  assert.equal(second.run.analysis_status, 'complete');
  assert.equal(second.run.processing_coverage.complete, true);
  // no completed segment was re-billed
  for (const [i, c] of adapter.calls.byIndex) {
    if (i !== mid) assert.equal(c, before.get(i), `segment ${i} must not be re-billed`);
  }
  assert.equal(adapter.calls.byIndex.get(mid), before.get(mid) + 1);
  // profile + structure not repeated on resume
  assert.equal(adapter.calls.profile, 1, 'profile not re-billed');
  assert.equal(adapter.calls.structure, 1, 'structure not re-billed');
});

test('multiple failed non-adjacent segments recover together', async () => {
  const { canonical, recorded, segs } = corpus();
  const a = 1, b = Math.min(segs.length - 1, 4);
  assert.ok(b - a >= 2, 'chosen indices are non-adjacent');
  const failing = new Set([a, b]);
  const store = memStore();
  const adapter = makeAdapter(segs, recorded, failing);

  const first = await executeRun({ store, noteId: 'n2', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW });
  assert.equal(first.run.analysis_status, 'partial');

  failing.clear();
  const second = await resumeRun({ store, analysisRunId: first.run.analysis_run_id, noteId: 'n2', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW });
  assert.equal(second.segmentsRun, 2, 'only the two failed segments re-run');
  assert.equal(second.run.analysis_status, 'complete');
});

test('provider outage during resume keeps the run partial (never falsely complete)', async () => {
  const { canonical, recorded, segs } = corpus();
  const failing = new Set([2]);
  const store = memStore();
  const adapter = makeAdapter(segs, recorded, failing);
  const first = await executeRun({ store, noteId: 'n3', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW });
  assert.equal(first.run.analysis_status, 'partial');

  // total outage during the resume attempt
  for (let i = 0; i < segs.length; i++) failing.add(i);
  const second = await resumeRun({ store, analysisRunId: first.run.analysis_run_id, noteId: 'n3', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW });
  assert.equal(second.run.analysis_status, 'partial', 'still partial after a failed resume');
  assert.equal(second.run.processing_coverage.complete, false);

  // repeated failure: still never complete
  const third = await resumeRun({ store, analysisRunId: first.run.analysis_run_id, noteId: 'n3', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW });
  assert.equal(third.run.analysis_status, 'partial');
  const seg2 = store.getSegments(first.run.analysis_run_id).find((s) => s.segment_index === 2);
  assert.ok(seg2.attempts >= 3, 'attempts are recorded across resumes');
});

test('app restart before resume: state survives on disk and resume completes', async () => {
  const { canonical, recorded, segs } = corpus();
  const dbPath = path.join(os.tmpdir(), `wc-resume-${process.pid}-${Number(process.hrtime.bigint() % 1000000n)}.db`);
  try {
    const failing = new Set([3]);
    // --- "session 1" ---
    let store = createAnalysisStore(dbPath, { now: (() => { let n = 1; return () => n++; })() });
    const adapter1 = makeAdapter(segs, recorded, failing);
    const first = await executeRun({ store, noteId: 'n4', rawTranscript: canonical, adapter: adapter1, ids: createIdFactory(), windowTokens: WINDOW });
    const runId = first.run.analysis_run_id;
    assert.equal(first.run.analysis_status, 'partial');
    store.close(); // app quits

    // --- "session 2": brand new store handle on the same file ---
    store = createAnalysisStore(dbPath, { now: (() => { let n = 100; return () => n++; })() });
    const persisted = store.getSegments(runId);
    assert.ok(persisted.length === segs.length, 'segment state survived restart');
    assert.equal(persisted.filter((s) => s.status === 'merged').length, segs.length - 1);

    failing.clear();
    const adapter2 = makeAdapter(segs, recorded, failing);
    const second = await resumeRun({ store, analysisRunId: runId, noteId: 'n4', rawTranscript: canonical, adapter: adapter2, ids: createIdFactory(), windowTokens: WINDOW });
    assert.equal(second.segmentsRun, 1, 'only the failed segment re-run after restart');
    assert.equal(second.run.analysis_status, 'complete');
    assert.equal(adapter2.calls.profile, 0, 'profile not re-billed after restart');
    store.close();
  } finally {
    for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + ext); } catch {} }
  }
});

test('duplicate resume of a complete run is a no-op (zero model calls)', async () => {
  const { canonical, recorded, segs } = corpus();
  const store = memStore();
  const adapter = makeAdapter(segs, recorded, new Set());
  const first = await executeRun({ store, noteId: 'n5', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW });
  assert.equal(first.run.analysis_status, 'complete');

  const before = adapter.calls.total;
  const dup = await resumeRun({ store, analysisRunId: first.run.analysis_run_id, noteId: 'n5', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW });
  assert.equal(dup.noop, true);
  assert.equal(adapter.calls.total, before, 'duplicate resume made zero model calls');
  assert.equal(dup.run.analysis_status, 'complete');
});

test('cancellation during resume preserves completed segments and stays partial', async () => {
  const { canonical, recorded, segs } = corpus();
  const store = memStore();
  const ctrl = new AbortController();
  // abort once we have processed two segments
  let done = 0;
  const adapter = makeAdapter(segs, recorded, new Set(), { onExtract: () => { if (++done === 2) ctrl.abort(); } });

  const res = await executeRun({ store, noteId: 'n6', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW, signal: ctrl.signal });
  assert.equal(res.cancelled, true, 'run reports cancellation');
  assert.equal(res.run.analysis_status, 'partial');
  const merged = store.getSegments(res.run.analysis_run_id).filter((s) => s.status === 'merged').length;
  assert.ok(merged >= 1 && merged < segs.length, 'completed segments were persisted, the rest left pending');

  // resuming after cancellation finishes the job without redoing merged work
  const adapter2 = makeAdapter(segs, recorded, new Set());
  const second = await resumeRun({ store, analysisRunId: res.run.analysis_run_id, noteId: 'n6', rawTranscript: canonical, adapter: adapter2, ids: createIdFactory(), windowTokens: WINDOW });
  assert.equal(second.run.analysis_status, 'complete');
  assert.equal(second.segmentsRun, segs.length - merged, 'only the unfinished segments were run');
});

test('final consolidation after recovery matches a clean single-pass run', async () => {
  const { canonical, recorded, segs } = corpus();
  // clean run
  const cleanStore = memStore();
  const clean = await executeRun({ store: cleanStore, noteId: 'c', rawTranscript: canonical, adapter: makeAdapter(segs, recorded, new Set()), ids: createIdFactory(), windowTokens: WINDOW });

  // failed-then-recovered run
  const failing = new Set([1, 3]);
  const recStore = memStore();
  const adapter = makeAdapter(segs, recorded, failing);
  const first = await executeRun({ store: recStore, noteId: 'r', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW });
  failing.clear();
  const recovered = await resumeRun({ store: recStore, analysisRunId: first.run.analysis_run_id, noteId: 'r', rawTranscript: canonical, adapter, ids: createIdFactory(), windowTokens: WINDOW });

  assert.equal(recovered.run.analysis_status, 'complete');
  assert.equal(recovered.run.processing_coverage.complete, true);
  // same presence + same item count/kinds as the clean run (ids differ)
  assert.deepEqual(recovered.run.cao_json.presence, clean.run.cao_json.presence);
  const kinds = (r) => r.run.cao_json.items.map((i) => i.kind).sort();
  assert.deepEqual(kinds(recovered), kinds(clean), 'recovered analysis equals the clean analysis');
});
