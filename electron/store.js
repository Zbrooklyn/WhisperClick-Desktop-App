const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

const MAX_HISTORY = 500;

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
  openaiApiKey: '',
  geminiApiKey: '',
};

const KEY_FIELDS = ['openaiApiKey', 'geminiApiKey'];

class Store {
  constructor(configDir) {
    this.configDir = configDir;
    this.settingsPath = path.join(configDir, 'settings.json');
    this.historyPath = path.join(configDir, 'history.json');
    this._ensureDir();
    // In-memory caches — lazy-loaded on first access, updated on every mutation.
    // Eliminates synchronous disk reads from the hot path (getSettings is called
    // on every IPC handler, tray menu build, pill visibility check, etc.).
    this._settingsCache = null;
    this._historyCache = null;
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
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath + '.bak', 'utf8'));
      try { this._atomicWrite(filePath, JSON.stringify(parsed, null, 2)); } catch {}
      return parsed;
    } catch {}
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

  _decryptKey(stored) {
    if (!stored) return stored;
    if (stored.startsWith('enc:')) {
      try {
        const buf = Buffer.from(stored.slice(4), 'base64');
        return safeStorage.decryptString(buf);
      } catch {
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
      for (const field of KEY_FIELDS) {
        settings[field] = this._decryptKey(settings[field]);
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
    history.unshift({ ...entry, id: Date.now().toString() });
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
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

  _saveHistory(history) {
    this._ensureDir();
    this._historyCache = history;
    this._atomicWrite(this.historyPath, JSON.stringify(history, null, 2));
  }
}

module.exports = Store;
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
