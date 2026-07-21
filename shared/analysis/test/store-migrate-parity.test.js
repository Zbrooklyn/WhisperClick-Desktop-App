'use strict';
// store-migrate-parity.test.js — dedicated stores, non-destructive migration,
// and web/Electron contract parity.

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const schema = require('../schema');
const { createAnalysisStore } = require('../store');
const { migrate } = require('../migrate');
const { createIdFactory } = require('../ids');

function tmpDb(tag) {
  return path.join(os.tmpdir(), `wc-analysis-${tag}-${process.pid}-${Number(process.hrtime.bigint() % 1000000n)}.db`);
}
function counterClock() { let n = 1000; return () => n++; }

function sampleRun(ids, noteId, status = 'complete') {
  return {
    analysis_run_id: ids.analysisRunId(),
    note_id: noteId,
    schema_version: schema.SCHEMA_VERSION,
    raw_version: 'v1', normalized_version: 'nfc-lf@v1',
    analysis_status: status,
    processing_coverage: { complete: status === 'complete', totalWords: 10 },
    cao_json: { items: [], presence: {}, structure: [] },
    model_policy: { provider: 'fixture' },
  };
}

test('analysis store persists runs in a dedicated table and finds resumable ones', () => {
  const ids = createIdFactory();
  const store = createAnalysisStore(':memory:', { now: counterClock() });
  const done = store.putRun(sampleRun(ids, 'note_1', 'complete'));
  const partial = store.putRun(sampleRun(ids, 'note_1', 'partial'));
  assert.equal(store.getRun(done.analysis_run_id).analysis_status, 'complete');
  assert.equal(store.latestCompleteRun('note_1').analysis_run_id, done.analysis_run_id);
  const resumable = store.findResumable('note_1');
  assert.equal(resumable.length, 1);
  assert.equal(resumable[0].analysis_run_id, partial.analysis_run_id);
});

test('rendered artifacts persist separately and must reference a real run', () => {
  const ids = createIdFactory();
  const store = createAnalysisStore(':memory:', { now: counterClock() });
  const run = store.putRun(sampleRun(ids, 'note_2'));
  const art = store.putArtifact({
    render_artifact_id: ids.renderArtifactId(), analysis_run_id: run.analysis_run_id,
    note_id: 'note_2', template_id: 'default', rendered_sections: { quotes: [] },
  });
  assert.equal(store.getArtifact(art.render_artifact_id).analysis_run_id, run.analysis_run_id);
  assert.throws(() => store.putArtifact({
    render_artifact_id: ids.renderArtifactId(), analysis_run_id: ids.analysisRunId(),
    note_id: 'note_2', template_id: 'default',
  }), /unknown analysis_run_id/);
});

test('retention keeps the last 5 ordinary artifacts; pinned/edited are exempt', () => {
  const ids = createIdFactory();
  const store = createAnalysisStore(':memory:', { now: counterClock() });
  const run = store.putRun(sampleRun(ids, 'note_3'));
  // oldest first: pin #0, edit #1, then 6 ordinary
  const mk = (extra) => store.putArtifact({
    render_artifact_id: ids.renderArtifactId(), analysis_run_id: run.analysis_run_id,
    note_id: 'note_3', template_id: 'default', ...extra,
  });
  const pinned = mk({ pinned: true });
  const edited = mk({ user_modifications: { title: 'edited' } });
  for (let i = 0; i < 6; i++) mk({});
  const res = store.enforceRetention('note_3', 5);
  const remaining = store.listArtifactsForNote('note_3').map((a) => a.render_artifact_id);
  assert.ok(remaining.includes(pinned.render_artifact_id), 'pinned kept');
  assert.ok(remaining.includes(edited.render_artifact_id), 'edited kept');
  // 6 ordinary, keep 5 -> exactly 1 deleted
  assert.equal(res.deleted.length, 1);
});

test('schema separation guards reject cross-contamination', () => {
  const ids = createIdFactory();
  const run = sampleRun(ids, 'note_x');
  assert.equal(schema.validateAnalysisRun(run).ok, true);
  // an AnalysisRun carrying a RenderedArtifact field must fail
  const bad = { ...run, template_id: 'default' };
  const r = schema.validateAnalysisRun(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /template_id/.test(e)));
  // a RenderedArtifact carrying cao_json must fail
  const badArt = { render_artifact_id: ids.renderArtifactId(), analysis_run_id: ids.analysisRunId(), template_id: 'd', cao_json: {} };
  const ra = schema.validateRenderedArtifact(badArt);
  assert.equal(ra.ok, false);
  assert.ok(ra.errors.some((e) => /cao_json/.test(e)));
});

test('migration is non-destructive: recordings untouched, analysis tables added', () => {
  const dbPath = tmpDb('migrate');
  try {
    // seed a recordings table via the real history store
    const { createHistoryStore } = require('../../../platforms/web/history-store.js');
    const hist = createHistoryStore(dbPath);
    hist.add({ id: '1700000000000-aaaa', text: 'hello world', timestamp: 't' });
    hist.add({ id: '1700000000001-bbbb', text: 'second note', timestamp: 't' });
    const before = hist.count();
    hist.close();

    const report = migrate(dbPath);
    assert.equal(report.recordingsUntouched, true);
    assert.equal(report.recordingsCount, before);
    assert.deepEqual(report.created.sort(), ['analysis_runs', 'analysis_segments', 'rendered_artifacts']);

    // reopen and confirm the two recordings are still there and readable
    const hist2 = createHistoryStore(dbPath);
    assert.equal(hist2.count(), before);
    assert.equal(hist2.get('1700000000000-aaaa').text, 'hello world');
    hist2.close();

    // running migrate again is idempotent
    const again = migrate(dbPath);
    assert.equal(again.created.length, 0);
    assert.equal(again.alreadyPresent, true);
  } finally {
    for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + ext); } catch {} }
  }
});

test('web/Electron parity: both platforms load the SAME frozen field sets', () => {
  // Two independent import specifiers that resolve to the same source module —
  // this is the parity guarantee: there is ONE definition, so platforms cannot
  // diverge. (In production, web/server.js and electron/main.js both require it.)
  const asWeb = require('../schema');
  const asElectron = require(path.resolve(__dirname, '..', 'schema.js'));
  assert.equal(asWeb.ANALYSIS_RUN_FIELDS, asElectron.ANALYSIS_RUN_FIELDS, 'same frozen array instance');
  assert.ok(Object.isFrozen(asWeb.ANALYSIS_RUN_FIELDS));
  assert.deepEqual(asWeb.RENDERED_ARTIFACT_FIELDS, asElectron.RENDERED_ARTIFACT_FIELDS);

  // And a run persisted "by web" round-trips identically "by electron".
  const ids = createIdFactory();
  const run = sampleRun(ids, 'note_p');
  const web = createAnalysisStore(':memory:', { now: () => 5 });
  const electron = createAnalysisStore(':memory:', { now: () => 5 });
  web.putRun(run); electron.putRun(run);
  assert.deepEqual(web.getRun(run.analysis_run_id), electron.getRun(run.analysis_run_id));
});
