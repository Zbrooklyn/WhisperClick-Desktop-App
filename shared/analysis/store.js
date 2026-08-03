// store.js — dedicated, versioned analysis-run + rendered-artifact stores.
//
// Contract amendments (spec §0.1 #7, §0.2):
//  - Analysis runs live in a DEDICATED store (their own tables), NOT as a `cao`
//    field on the recordings row. Rendered artifacts persist separately and
//    reference an analysis_run_id.
//  - Runs are versioned and partial/resumable (analysis_status pending|partial|
//    complete|failed; findResumable() returns the ones a resume must finish).
//  - Retention: keep the last 5 ordinary artifacts per note; pinned/user-edited
//    artifacts are exempt.
//
// Uses Node's built-in node:sqlite (same as history-store.js) — zero new deps.
// It ADDS tables to whatever db file it is given and never touches `recordings`.

'use strict';

const { DatabaseSync } = require('node:sqlite');
const schema = require('./schema');

const RETENTION_KEEP = 5;

function ensureSchema(db) {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(`CREATE TABLE IF NOT EXISTS analysis_runs (
    analysis_run_id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    raw_version TEXT,
    normalized_version TEXT,
    schema_version TEXT NOT NULL,
    analysis_status TEXT NOT NULL,
    processing_coverage TEXT,
    cao_json TEXT,
    model_policy TEXT,
    created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_runs_note ON analysis_runs(note_id, created_at DESC)');
  db.exec(`CREATE TABLE IF NOT EXISTS rendered_artifacts (
    render_artifact_id TEXT PRIMARY KEY,
    analysis_run_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    template_id TEXT,
    template_version TEXT,
    depth TEXT,
    language TEXT,
    presentation TEXT,
    rendered_sections TEXT,
    user_modifications TEXT,
    pinned INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_arts_note ON rendered_artifacts(note_id, created_at DESC)');
  // Per-segment durability: successful segments are persisted BEFORE the run
  // completes, so a resume retries only what actually failed and never re-bills
  // work already paid for. Segment identity is (run, index) — deterministic, so
  // it survives a process/app restart.
  db.exec(`CREATE TABLE IF NOT EXISTS analysis_segments (
    analysis_run_id TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    range_start INTEGER NOT NULL,
    range_end INTEGER NOT NULL,
    status TEXT NOT NULL,
    items_json TEXT,
    attempts INTEGER DEFAULT 0,
    error_code TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (analysis_run_id, segment_index)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_segs_run ON analysis_segments(analysis_run_id, segment_index)');
}

const J = (v) => (v == null ? null : JSON.stringify(v));
const P = (s) => { try { return s == null ? null : JSON.parse(s); } catch { return null; } };

function runRowToObj(row) {
  if (!row) return null;
  return {
    analysis_run_id: row.analysis_run_id,
    note_id: row.note_id,
    raw_version: row.raw_version,
    normalized_version: row.normalized_version,
    schema_version: row.schema_version,
    analysis_status: row.analysis_status,
    processing_coverage: P(row.processing_coverage),
    cao_json: P(row.cao_json),
    model_policy: P(row.model_policy),
    created_at: row.created_at,
  };
}
function artRowToObj(row) {
  if (!row) return null;
  return {
    render_artifact_id: row.render_artifact_id,
    analysis_run_id: row.analysis_run_id,
    note_id: row.note_id,
    template_id: row.template_id,
    template_version: row.template_version,
    depth: row.depth,
    language: row.language,
    presentation: P(row.presentation),
    rendered_sections: P(row.rendered_sections),
    user_modifications: P(row.user_modifications),
    pinned: !!row.pinned,
    created_at: row.created_at,
  };
}

// createAnalysisStore(dbPathOrDb, opts) — accepts a path or an existing
// DatabaseSync (so it can share the history db). opts.now injectable for tests.
function createAnalysisStore(dbPathOrDb, opts = {}) {
  const db = typeof dbPathOrDb === 'string' ? new DatabaseSync(dbPathOrDb) : dbPathOrDb;
  ensureSchema(db);
  const now = opts.now || (() => Date.now());

  const putRunStmt = db.prepare(`INSERT OR REPLACE INTO analysis_runs
    (${schema.ANALYSIS_RUN_FIELDS.join(',')}) VALUES (${schema.ANALYSIS_RUN_FIELDS.map(() => '?').join(',')})`);

  const putArtStmt = db.prepare(`INSERT OR REPLACE INTO rendered_artifacts
    (${schema.RENDERED_ARTIFACT_FIELDS.join(',')}) VALUES (${schema.RENDERED_ARTIFACT_FIELDS.map(() => '?').join(',')})`);

  const store = {
    db,

    putRun(run) {
      const r = { schema_version: schema.SCHEMA_VERSION, created_at: now(), ...run };
      const v = schema.validateAnalysisRun({ ...r, processing_coverage: r.processing_coverage || {}, cao_json: r.cao_json || {} });
      if (!v.ok) throw new Error('invalid AnalysisRun: ' + v.errors.join('; '));
      putRunStmt.run(
        r.analysis_run_id, r.note_id, r.raw_version || null, r.normalized_version || null,
        r.schema_version, r.analysis_status, J(r.processing_coverage), J(r.cao_json),
        J(r.model_policy), r.created_at,
      );
      return r;
    },

    getRun(id) {
      return runRowToObj(db.prepare('SELECT * FROM analysis_runs WHERE analysis_run_id = ?').get(String(id)));
    },

    listRunsForNote(noteId) {
      return db.prepare('SELECT * FROM analysis_runs WHERE note_id = ? ORDER BY created_at DESC, rowid DESC')
        .all(String(noteId)).map(runRowToObj);
    },

    latestCompleteRun(noteId) {
      return runRowToObj(db.prepare(
        "SELECT * FROM analysis_runs WHERE note_id = ? AND analysis_status = 'complete' ORDER BY created_at DESC, rowid DESC LIMIT 1"
      ).get(String(noteId)));
    },

    // A resume must finish any run left pending/partial/failed.
    findResumable(noteId) {
      const sql = noteId
        ? "SELECT * FROM analysis_runs WHERE note_id = ? AND analysis_status IN ('pending','partial','failed') ORDER BY created_at DESC"
        : "SELECT * FROM analysis_runs WHERE analysis_status IN ('pending','partial','failed') ORDER BY created_at DESC";
      const rows = noteId ? db.prepare(sql).all(String(noteId)) : db.prepare(sql).all();
      return rows.map(runRowToObj);
    },

    putArtifact(art) {
      const a = { template_version: '1', created_at: now(), pinned: false, ...art };
      const v = schema.validateRenderedArtifact(a);
      if (!v.ok) throw new Error('invalid RenderedArtifact: ' + v.errors.join('; '));
      // referential integrity: the run must exist.
      if (!store.getRun(a.analysis_run_id)) throw new Error('rendered artifact references unknown analysis_run_id');
      putArtStmt.run(
        a.render_artifact_id, a.analysis_run_id, a.note_id, a.template_id || null,
        a.template_version || null, a.depth || null, a.language || null,
        J(a.presentation), J(a.rendered_sections), J(a.user_modifications),
        a.pinned ? 1 : 0, a.created_at,
      );
      return a;
    },

    getArtifact(id) {
      return artRowToObj(db.prepare('SELECT * FROM rendered_artifacts WHERE render_artifact_id = ?').get(String(id)));
    },

    listArtifactsForNote(noteId) {
      return db.prepare('SELECT * FROM rendered_artifacts WHERE note_id = ? ORDER BY created_at DESC, rowid DESC')
        .all(String(noteId)).map(artRowToObj);
    },

    latestArtifact(noteId) {
      return artRowToObj(db.prepare('SELECT * FROM rendered_artifacts WHERE note_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
        .get(String(noteId)));
    },

    // Retention: keep the last RETENTION_KEEP ORDINARY artifacts per note; never
    // delete pinned or user-edited (user_modifications present) artifacts.
    enforceRetention(noteId, keep = RETENTION_KEEP) {
      const all = store.listArtifactsForNote(noteId);
      const ordinary = all.filter((a) => !a.pinned && !hasEdits(a));
      const toDelete = ordinary.slice(keep);
      const del = db.prepare('DELETE FROM rendered_artifacts WHERE render_artifact_id = ?');
      for (const a of toDelete) del.run(a.render_artifact_id);
      return { deleted: toDelete.map((a) => a.render_artifact_id), kept: all.length - toDelete.length };
    },

    // ---- per-segment durability (resume support) ----

    putSegment(runId, seg) {
      db.prepare(`INSERT OR REPLACE INTO analysis_segments
        (analysis_run_id, segment_index, range_start, range_end, status, items_json, attempts, error_code, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        String(runId), seg.segment_index, seg.range[0], seg.range[1], seg.status,
        J(seg.items || null), seg.attempts || 0, seg.error_code || null, now(),
      );
      return seg;
    },

    getSegments(runId) {
      return db.prepare('SELECT * FROM analysis_segments WHERE analysis_run_id = ? ORDER BY segment_index')
        .all(String(runId)).map((r) => ({
          segment_index: r.segment_index,
          range: [r.range_start, r.range_end],
          status: r.status,
          items: P(r.items_json) || [],
          attempts: r.attempts,
          error_code: r.error_code,
          updated_at: r.updated_at,
        }));
    },

    close() { if (typeof dbPathOrDb === 'string') { try { db.close(); } catch {} } },
  };
  return store;
}

function hasEdits(a) {
  return a.user_modifications && Object.keys(a.user_modifications).length > 0;
}

module.exports = { createAnalysisStore, ensureSchema, RETENTION_KEEP };
