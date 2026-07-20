// people-store.js — a local registry of known speakers for diarization.
//
// Same zero-dep footprint as history-store: Node's built-in SQLite. Each person
// has a name and zero-or-more voice embeddings (voiceprints). Matching a new
// meeting speaker is a cosine-similarity lookup against every enrolled print;
// the best person above a threshold is the suggestion the UI shows as a pill.
//
// Embeddings are produced elsewhere (the engine, next phase). This module only
// stores them and does the maths, so it is fully unit-testable on its own.

const { DatabaseSync } = require('node:sqlite');

function safeJson(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

// Cosine similarity of two equal-length numeric vectors. Returns -1..1 (0 if a
// vector is empty or zero-magnitude — i.e. "no signal", never a false match).
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function rowToPerson(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    created: row.created || 0,
    updated: row.updated || 0,
    embeddings: row.embeddings ? safeJson(row.embeddings, []) : [],
    meta: row.meta ? safeJson(row.meta, {}) : {},
  };
}

function createPeopleStore(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(`CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    embeddings TEXT,
    meta TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_people_name ON people(name)');

  const upsert = db.prepare(
    'INSERT OR REPLACE INTO people (id,name,created,updated,embeddings,meta) VALUES (?,?,?,?,?,?)');

  function write(p) {
    upsert.run(p.id, p.name, p.created, p.updated,
      JSON.stringify(p.embeddings || []), JSON.stringify(p.meta || {}));
    return p;
  }

  const store = {
    db,

    list() {
      return db.prepare('SELECT * FROM people ORDER BY name COLLATE NOCASE ASC').all().map(rowToPerson);
    },

    get(id) {
      return rowToPerson(db.prepare('SELECT * FROM people WHERE id = ?').get(String(id)));
    },

    getByName(name) {
      return rowToPerson(db.prepare('SELECT * FROM people WHERE name = ? COLLATE NOCASE').get(String(name)));
    },

    // Create a person, or return the existing one with that name. `now` is passed
    // in (the store never reads the clock itself, so tests are deterministic).
    ensure(name, now) {
      const clean = String(name || '').trim();
      if (!clean) throw new Error('name required');
      const existing = this.getByName(clean);
      if (existing) return existing;
      const id = 'p_' + Math.abs(hashStr(clean + ':' + now)).toString(36);
      return write({ id, name: clean, created: now, updated: now, embeddings: [], meta: {} });
    },

    rename(id, name, now) {
      const p = this.get(id);
      if (!p) return null;
      p.name = String(name || '').trim() || p.name;
      p.updated = now;
      return write(p);
    },

    // Enroll a voiceprint for a person (a name + a vector). Keeps up to `keep`
    // most-recent prints so a voice can drift over time without unbounded growth.
    enroll(name, embedding, now, keep = 8) {
      const p = this.ensure(name, now);
      if (Array.isArray(embedding) && embedding.length) {
        p.embeddings.push({ v: embedding, at: now });
        if (p.embeddings.length > keep) p.embeddings = p.embeddings.slice(-keep);
      }
      p.updated = now;
      return write(p);
    },

    remove(id) { return db.prepare('DELETE FROM people WHERE id = ?').run(String(id)).changes; },
    clear() { db.exec('DELETE FROM people'); },

    // Best-matching person for a voiceprint. Scores each person by their strongest
    // enrolled print; returns { person, score } when above threshold, else null.
    match(embedding, { threshold = 0.75 } = {}) {
      if (!Array.isArray(embedding) || !embedding.length) return null;
      let best = null;
      for (const p of this.list()) {
        let s = 0;
        for (const e of p.embeddings) { const c = cosine(embedding, e.v); if (c > s) s = c; }
        if (!best || s > best.score) best = { person: p, score: s };
      }
      return best && best.score >= threshold ? best : null;
    },

    close() { try { db.close(); } catch {} },
  };
  return store;
}

// Small stable string hash (FNV-1a) — for deterministic ids without a clock/RNG.
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h | 0;
}

module.exports = { createPeopleStore, cosine };
