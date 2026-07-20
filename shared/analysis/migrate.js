// migrate.js — non-destructive migration scaffolding.
//
// Phase 0 requirement: add the analysis-run + rendered-artifact tables WITHOUT
// altering any existing visible summaries. The migration only ever runs CREATE
// TABLE IF NOT EXISTS; it never touches the `recordings` table, and it verifies
// that fact by snapshotting the recordings row count before and after.

'use strict';

const { DatabaseSync } = require('node:sqlite');
const { ensureSchema } = require('./store');

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}
function safeCount(db, table) {
  if (!tableExists(db, table)) return null;
  try { return db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c; } catch { return null; }
}

// migrate(dbPathOrDb) -> report
//   Adds the two analysis tables if missing. Asserts recordings is untouched.
function migrate(dbPathOrDb) {
  const db = typeof dbPathOrDb === 'string' ? new DatabaseSync(dbPathOrDb) : dbPathOrDb;
  const TABLES = ['analysis_runs', 'rendered_artifacts', 'analysis_segments'];
  const snapshot = () => {
    const s = { recordings: safeCount(db, 'recordings') };
    for (const t of TABLES) s[t] = tableExists(db, t);
    return s;
  };

  const before = snapshot();
  ensureSchema(db); // CREATE TABLE IF NOT EXISTS only
  const after = snapshot();

  const recordingsUntouched = before.recordings === after.recordings;
  const created = TABLES.filter((t) => !before[t] && after[t]);

  if (typeof dbPathOrDb === 'string') { try { db.close(); } catch {} }

  return {
    created,
    recordingsUntouched,
    recordingsCount: after.recordings,
    alreadyPresent: TABLES.every((t) => before[t]),
  };
}

module.exports = { migrate, tableExists };
