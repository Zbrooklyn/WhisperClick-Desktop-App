// history-store.js — embedded local history database for the web build.
//
// Lightest possible footprint: uses Node's BUILT-IN SQLite (node:sqlite, no npm
// dependency, no native compile). One file on disk. Reads pages instead of
// loading the whole history into memory, so it stays fast and light no matter
// how many recordings pile up — no 200/500 cap, no full-file rewrite per save.
//
// The row shape mirrors the old JSON item exactly, so the rest of the server
// keeps working with plain item objects; this module is the only thing that
// knows about SQL.

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

// Columns we store as first-class (searchable / sortable); everything else on
// an item rides along in `extra` (JSON) so we never lose a field.
const CORE_KEYS = new Set([
  'id', 'text', 'timestamp', 'duration', 'transcription_time', 'provider',
  'model', 'language', 'words', 'audio_file', '_wav', 'meeting', 'source_url',
  'edited', 'retranscribed',
]);

function sortKey(item) {
  // Recordings sort newest-first. Derive a numeric key from the id prefix
  // (`${Date.now()}-${stamp}`), falling back to the timestamp.
  if (item && typeof item.id === 'string') {
    const n = parseInt(item.id.split('-')[0], 10);
    if (Number.isFinite(n)) return n;
  }
  const t = item && item.timestamp ? Date.parse(item.timestamp) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function rowToItem(row) {
  if (!row) return null;
  const item = {
    id: row.id,
    text: row.text || '',
    timestamp: row.timestamp || '',
    duration: row.duration || 0,
    transcription_time: row.transcription_time || 0,
    provider: row.provider || '',
    model: row.model || '',
    language: row.language || null,
    words: row.words ? safeJson(row.words, null) : null,
    audio_file: row.audio_file || null,
    _wav: row.wav || null,
    meeting: !!row.meeting,
    source_url: row.source_url || null,
    edited: !!row.edited,
    retranscribed: !!row.retranscribed,
  };
  if (row.extra) Object.assign(item, safeJson(row.extra, {}));
  return item;
}

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function itemToRow(item) {
  const extra = {};
  for (const k of Object.keys(item)) {
    if (!CORE_KEYS.has(k)) extra[k] = item[k];
  }
  return {
    id: String(item.id),
    created: sortKey(item),
    text: item.text || '',
    timestamp: item.timestamp || '',
    duration: Number(item.duration) || 0,
    transcription_time: Number(item.transcription_time) || 0,
    provider: item.provider || '',
    model: item.model || '',
    language: item.language || null,
    words: item.words ? JSON.stringify(item.words) : null,
    audio_file: item.audio_file || null,
    wav: item._wav || null,
    meeting: item.meeting ? 1 : 0,
    source_url: item.source_url || null,
    edited: item.edited ? 1 : 0,
    retranscribed: item.retranscribed ? 1 : 0,
    extra: Object.keys(extra).length ? JSON.stringify(extra) : null,
  };
}

function createHistoryStore(dbPath, opts = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');   // concurrent-safe, no full rewrite
  db.exec('PRAGMA synchronous = NORMAL'); // fast + durable enough for a local app
  db.exec(`CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    created INTEGER NOT NULL,
    text TEXT,
    timestamp TEXT,
    duration REAL,
    transcription_time REAL,
    provider TEXT,
    model TEXT,
    language TEXT,
    words TEXT,
    audio_file TEXT,
    wav TEXT,
    meeting INTEGER DEFAULT 0,
    source_url TEXT,
    edited INTEGER DEFAULT 0,
    retranscribed INTEGER DEFAULT 0,
    extra TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created DESC)');

  const COLS = ['id', 'created', 'text', 'timestamp', 'duration', 'transcription_time',
    'provider', 'model', 'language', 'words', 'audio_file', 'wav', 'meeting',
    'source_url', 'edited', 'retranscribed', 'extra'];
  const insertSql = `INSERT OR REPLACE INTO recordings (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`;
  const insertStmt = db.prepare(insertSql);

  function insertRow(row) { insertStmt.run(...COLS.map((c) => row[c])); }

  const store = {
    db,
    // One-time migration: import an existing history.json, then keep it as a
    // .bak backup so nothing is ever lost. Only runs when the table is empty.
    migrateFromJson(jsonPath) {
      if (this.count() > 0) return { migrated: 0, skipped: 'table not empty' };
      if (!jsonPath || !fs.existsSync(jsonPath)) return { migrated: 0 };
      let arr;
      try { arr = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { return { migrated: 0, error: 'unreadable json' }; }
      if (!Array.isArray(arr) || !arr.length) return { migrated: 0 };
      const tx = db.prepare('BEGIN'); tx.run();
      try {
        for (const item of arr) insertRow(itemToRow(item));
        db.prepare('COMMIT').run();
      } catch (e) { db.prepare('ROLLBACK').run(); return { migrated: 0, error: e.message }; }
      try { fs.renameSync(jsonPath, jsonPath + '.migrated.bak'); } catch {}
      return { migrated: arr.length };
    },

    add(item) { insertRow(itemToRow(item)); return item; },

    update(id, fields) {
      const cur = this.get(id);
      if (!cur) return null;
      const merged = { ...cur, ...fields, id: cur.id };
      insertRow(itemToRow(merged));
      return merged;
    },

    delete(id) { return db.prepare('DELETE FROM recordings WHERE id = ?').run(String(id)).changes; },
    clear() { db.exec('DELETE FROM recordings'); },

    get(id) {
      return rowToItem(db.prepare('SELECT * FROM recordings WHERE id = ?').get(String(id)));
    },

    count(query) {
      if (query && query.trim()) {
        return db.prepare('SELECT COUNT(*) c FROM recordings WHERE text LIKE ?').get('%' + query.trim() + '%').c;
      }
      return db.prepare('SELECT COUNT(*) c FROM recordings').get().c;
    },

    // Newest-first page. { limit, offset, query } — query does a substring
    // match on the transcript text.
    page({ limit = 50, offset = 0, query = '' } = {}) {
      limit = Math.max(1, Math.min(500, Number(limit) || 50));
      offset = Math.max(0, Number(offset) || 0);
      let rows;
      // rowid DESC breaks ties for entries created in the same millisecond, so
      // ordering is deterministic and matches insertion order.
      if (query && query.trim()) {
        rows = db.prepare('SELECT * FROM recordings WHERE text LIKE ? ORDER BY created DESC, rowid DESC LIMIT ? OFFSET ?')
          .all('%' + query.trim() + '%', limit, offset);
      } else {
        rows = db.prepare('SELECT * FROM recordings ORDER BY created DESC, rowid DESC LIMIT ? OFFSET ?').all(limit, offset);
      }
      return rows.map(rowToItem);
    },

    // Full internal list (includes _wav) — used where the server needs to scan
    // (e.g. legacy callers). Prefer page() at scale.
    allItems({ limit = 100000 } = {}) {
      return db.prepare('SELECT * FROM recordings ORDER BY created DESC, rowid DESC LIMIT ?').all(limit).map(rowToItem);
    },

    close() { try { db.close(); } catch {} },
  };
  return store;
}

module.exports = { createHistoryStore };
