const fs = require('fs');
const path = require('path');

// Files we copy during a migration. Bak variants come along so a subsequent
// corrupt-primary recovery still works after the move.
const COPY_FILES = ['settings.json', 'settings.json.bak', 'history.json', 'history.json.bak'];

// Provenance file written to the CURRENT configDir after a successful
// migration. Gives us idempotency (never re-migrate the same path twice),
// accountability (Settings UI can read this), and structural evidence that
// migration ran — so we don't look at a populated current dir and assume it
// was a fresh install.
const PROVENANCE_FILE = '_migrated-from.json';

// ---------------------------------------------------------------------------
// Folder registry
// ---------------------------------------------------------------------------
//
// Every historical configDir name in WhisperClick's history. Each entry pairs
// a legacy folder name with the channel it served. When a user upgrades from
// an older version, the startup migration walks this list filtered to their
// current channel and imports the first match with real data.
//
// Rules for maintainers:
//   1. NEVER delete entries. A user on an old version can skip many releases;
//      removing an entry silently breaks their upgrade.
//   2. When you rename a configDir, add the OLD name here, not the new one.
//      The new name is whatever main.js builds from isBeta/isDev — by
//      definition not legacy.
//   3. `priority` is searched ascending within a channel. Lower = prefer.
//      Used when multiple legacy folders exist for the same channel so we
//      pick the one closest to the user's actual last-used config.
//
// If you change configDir in main.js and this registry's test in
// migration.test.js still passes without an edit here, the test is wrong.
const FOLDER_REGISTRY = [
  // Channel: beta
  {
    name: 'whisperclick-beta',
    channel: 'beta',
    deprecatedIn: '2.2.1-beta',
    priority: 1,
    reason: 'renamed to com.whisperclick.app during 2.2.1-beta mono-repo restructure',
  },
  {
    name: 'com.whisperclick.app',
    channel: 'beta',
    deprecatedIn: '2.2.5-beta',
    priority: 2,
    reason: 'beta/stable split; beta moved to com.whisperclick.beta in 2.2.5-beta',
  },

  // Channel: stable
  {
    name: 'whisperclick',
    channel: 'stable',
    deprecatedIn: '2.2.1-beta',
    priority: 1,
    reason: 'renamed to com.whisperclick.app during 2.2.1-beta mono-repo restructure',
  },

  // Channel: dev — no legacy entries. Dev users rarely persist data they care
  // about across config-path renames. Add one here if that ever stops being true.
];

// ---------------------------------------------------------------------------
// Has-real-data heuristic
// ---------------------------------------------------------------------------
//
// Returns true only if the folder looks like it belonged to a user who
// actually used the app — an encrypted API key was stored, or at least one
// history entry exists. Empty factory-default folders don't get surfaced:
// there's nothing to migrate, and bugging the user about them creates noise.

function _readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function hasRealData(legacyDir) {
  const settings = _readJsonSafe(path.join(legacyDir, 'settings.json'));
  const history = _readJsonSafe(path.join(legacyDir, 'history.json'));
  const hasKey = !!(settings && (settings.openaiApiKey || settings.geminiApiKey));
  const hasHistory = Array.isArray(history) && history.length > 0;
  return hasKey || hasHistory;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

function _readProvenance(currentConfigDir) {
  const p = path.join(currentConfigDir, PROVENANCE_FILE);
  return _readJsonSafe(p) || { migrations: [] };
}

function _writeProvenance(currentConfigDir, record) {
  try {
    fs.mkdirSync(currentConfigDir, { recursive: true });
    fs.writeFileSync(
      path.join(currentConfigDir, PROVENANCE_FILE),
      JSON.stringify(record, null, 2),
    );
  } catch { /* non-fatal; migration still worked in memory */ }
}

function _alreadyMigratedFrom(currentConfigDir, legacyName) {
  const record = _readProvenance(currentConfigDir);
  return record.migrations.some(m => m.from === legacyName);
}

function _appendProvenance(currentConfigDir, entry) {
  const record = _readProvenance(currentConfigDir);
  record.migrations.push(entry);
  _writeProvenance(currentConfigDir, record);
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------
//
// Returns null if nothing migrated. Otherwise:
//   { from, at, appVersion, filesCopied, historyCount }
// The main process uses this to log + surface a toast to the user.

function migrateLegacyConfig(userData, currentConfigDir, channel, appVersion) {
  const currentSettings = path.join(currentConfigDir, 'settings.json');
  if (fs.existsSync(currentSettings)) return null; // current dir already populated

  const candidates = FOLDER_REGISTRY
    .filter(e => e.channel === channel)
    .filter(e => !_alreadyMigratedFrom(currentConfigDir, e.name))
    .sort((a, b) => a.priority - b.priority);

  for (const entry of candidates) {
    const legacyDir = path.join(userData, entry.name);
    if (!fs.existsSync(legacyDir)) continue;
    if (!hasRealData(legacyDir)) continue;

    try { fs.mkdirSync(currentConfigDir, { recursive: true }); } catch {}
    let copied = 0;
    for (const file of COPY_FILES) {
      const src = path.join(legacyDir, file);
      const dst = path.join(currentConfigDir, file);
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, dst); copied++; } catch {}
      }
    }

    const history = _readJsonSafe(path.join(legacyDir, 'history.json'));
    const historyCount = Array.isArray(history) ? history.length : 0;
    const record = {
      from: entry.name,
      at: new Date().toISOString(),
      appVersion: appVersion || 'unknown',
      filesCopied: copied,
      historyCount,
    };
    _appendProvenance(currentConfigDir, record);
    return record;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------
//
// Surfaces what legacy folders exist on this machine, matched against the
// registry. Used by any future Settings → Data UI to give the user a full
// view of what's still sitting around in AppData.

function scanLegacyFolders(userData, channel) {
  return FOLDER_REGISTRY
    .filter(e => e.channel === channel)
    .map(e => {
      const dir = path.join(userData, e.name);
      const exists = fs.existsSync(dir);
      let lastModified = null;
      let size = 0;
      if (exists) {
        for (const f of COPY_FILES) {
          const p = path.join(dir, f);
          if (fs.existsSync(p)) {
            const stat = fs.statSync(p);
            size += stat.size;
            if (!lastModified || stat.mtime > lastModified) lastModified = stat.mtime;
          }
        }
      }
      return {
        name: e.name,
        deprecatedIn: e.deprecatedIn,
        reason: e.reason,
        exists,
        hasRealData: exists && hasRealData(dir),
        lastModified,
        size,
      };
    });
}

function getProvenance(currentConfigDir) {
  return _readProvenance(currentConfigDir);
}

module.exports = {
  migrateLegacyConfig,
  scanLegacyFolders,
  getProvenance,
  hasRealData,
  FOLDER_REGISTRY,
};
