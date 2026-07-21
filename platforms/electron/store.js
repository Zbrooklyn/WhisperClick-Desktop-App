const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeStorage } = require('electron');

const MAX_HISTORY = 500;

// Collision-proof history id: timestamp prefix (keeps rough chronological
// readability) + a random suffix. A bare Date.now() collides when two
// transcriptions land in the same millisecond, producing duplicate ids — which
// makes deleteHistory remove BOTH entries (silent data loss) and updateHistory
// target the wrong one. The random suffix guarantees uniqueness within history.
function makeHistoryId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

const DEFAULT_SETTINGS = {
  mode: 'api',
  provider: 'openai',
  apiModel: 'whisper-1',
  localModel: 'base',
  language: 'auto',
  hotkey: 'Ctrl+Alt+R',
  theme: 'dark',
  alwaysOnTop: false,
  autoPaste: true,
  autoEnterMode: 'off',
  showPill: false,
  closeBehavior: 'tray',
  autoStart: false,
  soundEnabled: true,
  outputMode: 'transcribe',
  targetLanguage: 'en',
  sourceLanguage: 'auto',
  customBaseUrl: '',
  visualizerStyle: 'classic',
  visualizerMotion: 'balanced',
  audioRetentionDays: 30,
  onboardingComplete: false,
  autoDownloadUpdates: false,
  updateChannel: 'beta',
  trayClickAction: 'show',
  debugLogging: false,
  openaiApiKey: '',
  geminiApiKey: '',
  // --- Premium (Pro) ---
  premiumEnabled: true,
  customVocabulary: '',
  activeSnippet: '',
  snippetTemplates: [],
  recordingSound: 'default',
  postProcessingEnabled: false,
  postProcessingPrompt: '',
  voiceCommands: false,
  smartPunctuation: false,
  liveStreaming: false,
  continuousListening: false,
  voiceCorrections: false,
  confidenceHighlighting: false,
  // --- Premium tiers / integrations (Phase 3-4) ---
  licenseKey: '',
  licenseToken: '',
  licenseTier: 'free',
  licenseLastValidated: 0,
  managedProxyUrl: '',
  meetingMode: false,
  integrations: {},
  obsidianVaultPath: '',
  activeIntegration: '',
  _dismissedTips: [],
};

const KEY_FIELDS = ['openaiApiKey', 'geminiApiKey', 'licenseKey', 'licenseToken'];

class Store {
  constructor(configDir, logger) {
    this.configDir = configDir;
    this.settingsPath = path.join(configDir, 'settings.json');
    this.historyPath = path.join(configDir, 'history.json');
    // Optional logger so corruption/data-loss recovery isn't silent. Defaults to
    // a no-op when none is injected (keeps the store usable standalone/in tests).
    this._log = logger || { warn() {}, error() {} };
    this._ensureDir();
    // In-memory caches — lazy-loaded on first access, updated on every mutation.
    // Eliminates synchronous disk reads from the hot path (getSettings is called
    // on every IPC handler, tray menu build, pill visibility check, etc.).
    this._settingsCache = null;
    this._historyCache = null;
    this._decryptFailures = {};
  }

  // Map of {field: true} for KEY_FIELDS that were present on disk as enc:…
  // but failed to decrypt (profile moved between machines, DPAPI key rotated,
  // running under a different Windows user, etc.). Main can surface a banner
  // so the user knows to re-enter rather than staring at an empty field.
  getDecryptFailures() {
    this.getSettings();
    return { ...this._decryptFailures };
  }

  _ensureDir() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  // --- Crash-safe I/O ---

  _atomicWrite(filePath, data) {
    const tmp = filePath + '.tmp';
    const bak = filePath + '.bak';
    try { if (fs.existsSync(filePath)) fs.copyFileSync(filePath, bak); } catch {}
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, filePath);
  }

  _safeReadJSON(filePath, fallback) {
    let primaryErr = null;
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch (err) { primaryErr = err; }
    // A missing primary is normal (first run). A primary that exists but won't
    // parse is corruption worth surfacing — don't let it pass silently.
    const primaryCorrupt = primaryErr.code !== 'ENOENT';
    const name = path.basename(filePath);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath + '.bak', 'utf8'));
      if (primaryCorrupt) {
        this._log.warn(`[store] ${name} was unreadable; recovered from backup`);
      }
      try { this._atomicWrite(filePath, JSON.stringify(parsed, null, 2)); } catch {}
      return parsed;
    } catch {}
    if (primaryCorrupt) {
      this._log.error(`[store] ${name} and its backup are both unreadable; resetting to defaults (data loss)`);
    }
    return fallback;
  }

  // --- API key encryption ---

  _encryptKey(plain) {
    if (!plain) return plain;
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(plain).toString('base64');
    }
    return plain;
  }

  _decryptKey(stored, fieldName) {
    if (!stored) return stored;
    if (stored.startsWith('enc:')) {
      try {
        const buf = Buffer.from(stored.slice(4), 'base64');
        return safeStorage.decryptString(buf);
      } catch (err) {
        if (fieldName) this._decryptFailures[fieldName] = true;
        try { console.error(`[store] decrypt failed for ${fieldName || 'key'}: ${err && err.message}`); } catch {}
        return '';
      }
    }
    // Legacy plaintext — returned as-is, will be re-encrypted on next save
    return stored;
  }

  // --- Settings ---

  getSettings() {
    if (!this._settingsCache) {
      const raw = this._safeReadJSON(this.settingsPath, { ...DEFAULT_SETTINGS });
      const settings = { ...DEFAULT_SETTINGS, ...raw };
      this._decryptFailures = {};
      for (const field of KEY_FIELDS) {
        settings[field] = this._decryptKey(settings[field], field);
      }
      this._settingsCache = settings;
    }
    return { ...this._settingsCache };
  }

  saveSettings(settings) {
    this._ensureDir();
    // Update cache immediately (decrypted values)
    this._settingsCache = { ...settings };
    // Write encrypted version to disk
    const toWrite = { ...settings };
    for (const field of KEY_FIELDS) {
      toWrite[field] = this._encryptKey(toWrite[field]);
    }
    this._atomicWrite(this.settingsPath, JSON.stringify(toWrite, null, 2));
  }

  resetSettings() {
    this.saveSettings(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }

  resetAll() {
    this.saveSettings({ ...DEFAULT_SETTINGS });
    this._historyCache = [];
    this._saveHistory([]);
  }

  // --- History ---

  getHistory() {
    if (!this._historyCache) {
      this._historyCache = this._safeReadJSON(this.historyPath, []);
    }
    return [...this._historyCache];
  }

  addHistory(entry) {
    const history = this.getHistory();
    history.unshift({ ...entry, id: makeHistoryId() });
    if (history.length > MAX_HISTORY) {
      // Drop the oldest entries beyond the cap AND delete their audio files, so
      // .ogg recordings don't orphan and grow disk usage unbounded (R6). Only
      // store knows about rollover drops, so the cleanup belongs here.
      const dropped = history.splice(MAX_HISTORY);
      for (const d of dropped) {
        if (d && d.audio_file) {
          try { fs.unlinkSync(d.audio_file); } catch { /* already gone */ }
        }
      }
    }
    this._saveHistory(history);
    return history;
  }

  updateHistory(id, updates) {
    const history = this.getHistory();
    const idx = history.findIndex(h => h.id === id);
    if (idx === -1) return history;
    history[idx] = { ...history[idx], ...updates };
    this._saveHistory(history);
    return history;
  }

  deleteHistory(id) {
    let history = this.getHistory();
    history = history.filter(h => h.id !== id);
    this._saveHistory(history);
    return history;
  }

  clearHistory() {
    this._saveHistory([]);
    return [];
  }

  // --- Query surface (parity with the web SQLite store: page + count) ---

  // Case-insensitive substring match across the fields the web search covers,
  // so desktop search behaves the same as web (/api/history/page?q=).
  _matchesQuery(entry, needle) {
    if (!needle) return true;
    const hay = [entry.text, entry.title, entry.summary]
      .filter(v => typeof v === 'string').join('\n').toLowerCase();
    return hay.includes(needle);
  }

  // Newest-first (history is stored newest-first) paginated slice, optional text
  // query. Mirrors the web /api/history/page contract's item set.
  page({ limit = 50, offset = 0, query = '' } = {}) {
    const needle = String(query || '').trim().toLowerCase();
    const lim = Math.max(0, parseInt(limit, 10) || 0);
    const off = Math.max(0, parseInt(offset, 10) || 0);
    const filtered = needle
      ? this.getHistory().filter(h => this._matchesQuery(h, needle))
      : this.getHistory();
    return filtered.slice(off, off + lim);
  }

  // Total matching rows (for pager math) — the whole set when no query.
  count(query = '') {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return this.getHistory().length;
    return this.getHistory().filter(h => this._matchesQuery(h, needle)).length;
  }

  _saveHistory(history) {
    this._ensureDir();
    this._historyCache = history;
    this._atomicWrite(this.historyPath, JSON.stringify(history, null, 2));
  }
}

module.exports = Store;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
