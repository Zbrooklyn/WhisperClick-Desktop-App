const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { createTempDir, cleanupTempDir } = require('../helpers/test-utils');
const Store = require('../../platforms/electron/store');
const { DEFAULT_SETTINGS } = require('../../platforms/electron/store');

let tmpDir;
let store;

beforeEach(() => {
  tmpDir = createTempDir();
  safeStorage._reset();
  store = new Store(tmpDir);
});

afterEach(() => {
  cleanupTempDir(tmpDir);
});

// ── Directory creation ──────────────────────────────────────────────────

describe('directory creation', () => {
  test('constructor creates config directory', () => {
    const dir = path.join(tmpDir, 'subdir');
    expect(fs.existsSync(dir)).toBe(false);
    new Store(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });

  test('constructor tolerates existing directory', () => {
    // tmpDir already exists; constructing again should not throw
    expect(() => new Store(tmpDir)).not.toThrow();
  });
});

// ── Atomic writes ───────────────────────────────────────────────────────

describe('atomic writes', () => {
  test('creates the target file', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS });
    expect(fs.existsSync(store.settingsPath)).toBe(true);
  });

  test('creates a .bak file', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS });
    // Second write should create .bak from the first
    store.saveSettings({ ...DEFAULT_SETTINGS, theme: 'light' });
    expect(fs.existsSync(store.settingsPath + '.bak')).toBe(true);
  });

  test('.tmp file is cleaned up after write', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS });
    expect(fs.existsSync(store.settingsPath + '.tmp')).toBe(false);
  });

  test('works with no prior file', () => {
    // Fresh store, no settings.json yet
    expect(() => store.saveSettings({ ...DEFAULT_SETTINGS })).not.toThrow();
    const data = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8'));
    expect(data.theme).toBe('dark');
  });
});

// ── Safe read fallback ──────────────────────────────────────────────────

describe('safe read fallback', () => {
  test('reads valid JSON', () => {
    fs.writeFileSync(store.settingsPath, JSON.stringify({ theme: 'light' }));
    const result = store.getSettings();
    expect(result.theme).toBe('light');
  });

  test('falls back to .bak on corrupt primary', () => {
    fs.writeFileSync(store.settingsPath + '.bak', JSON.stringify({ theme: 'light' }));
    fs.writeFileSync(store.settingsPath, 'NOT JSON!!!');
    const result = store.getSettings();
    expect(result.theme).toBe('light');
  });

  test('restores primary from .bak after fallback', () => {
    fs.writeFileSync(store.settingsPath + '.bak', JSON.stringify({ theme: 'light' }));
    fs.writeFileSync(store.settingsPath, 'CORRUPT');
    store.getSettings();
    // After fallback read, primary should be restored
    const raw = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8'));
    expect(raw.theme).toBe('light');
  });

  test('returns defaults when both primary and .bak are corrupt', () => {
    fs.writeFileSync(store.settingsPath, 'BAD');
    fs.writeFileSync(store.settingsPath + '.bak', 'ALSO BAD');
    const result = store.getSettings();
    expect(result.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  test('returns defaults when file is missing', () => {
    const result = store.getSettings();
    expect(result).toEqual(expect.objectContaining(DEFAULT_SETTINGS));
  });

  test('recovers silently from .bak when primary is simply missing', () => {
    // No primary file (ENOENT) but a valid backup exists — normal-ish, recover.
    fs.writeFileSync(store.settingsPath + '.bak', JSON.stringify({ theme: 'light' }));
    const result = store.getSettings();
    expect(result.theme).toBe('light');
  });
});

// ── Silent-failure surfacing (corruption / data loss) ─────────────────────

describe('corruption is surfaced to the logger', () => {
  test('logs a warning when recovering a corrupt file from its backup', () => {
    const logger = { warn: jest.fn(), error: jest.fn() };
    const s = new Store(tmpDir, logger);
    fs.writeFileSync(s.settingsPath + '.bak', JSON.stringify({ theme: 'light' }));
    fs.writeFileSync(s.settingsPath, 'NOT JSON!!!');
    s.getSettings();
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('logs an error (data loss) when primary and backup are both unreadable', () => {
    const logger = { warn: jest.fn(), error: jest.fn() };
    const s = new Store(tmpDir, logger);
    fs.writeFileSync(s.settingsPath, 'BAD');
    fs.writeFileSync(s.settingsPath + '.bak', 'ALSO BAD');
    s.getSettings();
    expect(logger.error).toHaveBeenCalled();
  });

  test('does not log when the file is simply missing (first run)', () => {
    const logger = { warn: jest.fn(), error: jest.fn() };
    const s = new Store(tmpDir, logger);
    s.getSettings();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ── Encryption ──────────────────────────────────────────────────────────

describe('encryption', () => {
  test('encrypts API keys with enc: prefix when encryption is available', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS, openaiApiKey: 'sk-test123' });
    const raw = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8'));
    expect(raw.openaiApiKey).toMatch(/^enc:/);
  });

  test('stores plaintext when encryption is unavailable', () => {
    safeStorage._setAvailable(false);
    store.saveSettings({ ...DEFAULT_SETTINGS, openaiApiKey: 'sk-test123' });
    const raw = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8'));
    expect(raw.openaiApiKey).toBe('sk-test123');
  });

  test('empty key passes through without encryption', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS, openaiApiKey: '' });
    const raw = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8'));
    expect(raw.openaiApiKey).toBe('');
  });

  test('decrypts enc: values on read', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS, openaiApiKey: 'sk-test123' });
    const result = store.getSettings();
    expect(result.openaiApiKey).toBe('sk-test123');
  });

  test('decrypt failure returns empty string', () => {
    // Write a corrupted enc: value
    const settings = { ...DEFAULT_SETTINGS, openaiApiKey: 'enc:INVALIDBASE64!!!' };
    fs.writeFileSync(store.settingsPath, JSON.stringify(settings));
    const result = store.getSettings();
    expect(result.openaiApiKey).toBe('');
  });

  test('plaintext key passes through on read (migration path)', () => {
    // Legacy plaintext key — should be returned as-is
    const settings = { ...DEFAULT_SETTINGS, openaiApiKey: 'sk-legacy-plain' };
    fs.writeFileSync(store.settingsPath, JSON.stringify(settings));
    const result = store.getSettings();
    expect(result.openaiApiKey).toBe('sk-legacy-plain');
  });
});

// ── Settings ────────────────────────────────────────────────────────────

describe('settings', () => {
  test('returns defaults when no file exists', () => {
    const s = store.getSettings();
    expect(s.mode).toBe('api');
    expect(s.provider).toBe('openai');
    expect(s.theme).toBe('dark');
  });

  test('merges saved values with defaults', () => {
    fs.writeFileSync(store.settingsPath, JSON.stringify({ theme: 'light' }));
    const s = store.getSettings();
    expect(s.theme).toBe('light');
    // Other defaults still present
    expect(s.mode).toBe('api');
    expect(s.hotkey).toBe('Ctrl+Alt+R');
  });

  test('decrypts API keys on read', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS, geminiApiKey: 'AIza-test' });
    const s = store.getSettings();
    expect(s.geminiApiKey).toBe('AIza-test');
  });

  test('encrypts API keys on write', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS, geminiApiKey: 'AIza-test' });
    const raw = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8'));
    expect(raw.geminiApiKey).toMatch(/^enc:/);
  });

  test('resetSettings restores all defaults', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS, theme: 'light', mode: 'local' });
    const result = store.resetSettings();
    expect(result.theme).toBe('dark');
    expect(result.mode).toBe('api');
    // Verify persisted to disk
    const onDisk = store.getSettings();
    expect(onDisk.theme).toBe('dark');
  });

  test('resetAll clears settings and history', () => {
    store.saveSettings({ ...DEFAULT_SETTINGS, theme: 'light', mode: 'local' });
    store.addHistory({ text: 'entry1' });
    store.addHistory({ text: 'entry2' });
    expect(store.getHistory()).toHaveLength(2);

    store.resetAll();

    const settings = store.getSettings();
    expect(settings.theme).toBe('dark');
    expect(settings.mode).toBe('api');
    expect(settings.onboardingComplete).toBe(false);
    expect(store.getHistory()).toEqual([]);
  });

  test('full settings round-trip preserves all fields', () => {
    const custom = {
      ...DEFAULT_SETTINGS,
      theme: 'light',
      provider: 'gemini',
      language: 'es',
      hotkey: 'Ctrl+Shift+Z',
      autoPaste: false,
      showPill: false,
      openaiApiKey: 'sk-round-trip',
      geminiApiKey: 'AIza-round-trip',
    };
    store.saveSettings(custom);
    const result = store.getSettings();
    expect(result.theme).toBe('light');
    expect(result.provider).toBe('gemini');
    expect(result.language).toBe('es');
    expect(result.hotkey).toBe('Ctrl+Shift+Z');
    expect(result.autoPaste).toBe(false);
    expect(result.showPill).toBe(false);
    expect(result.openaiApiKey).toBe('sk-round-trip');
    expect(result.geminiApiKey).toBe('AIza-round-trip');
  });

  test('both API keys encrypted independently', () => {
    store.saveSettings({
      ...DEFAULT_SETTINGS,
      openaiApiKey: 'sk-aaa',
      geminiApiKey: 'AIza-bbb',
    });
    const raw = JSON.parse(fs.readFileSync(store.settingsPath, 'utf8'));
    expect(raw.openaiApiKey).toMatch(/^enc:/);
    expect(raw.geminiApiKey).toMatch(/^enc:/);
    // They should be different encrypted values
    expect(raw.openaiApiKey).not.toBe(raw.geminiApiKey);
  });
});

// ── History ─────────────────────────────────────────────────────────────

describe('history', () => {
  test('returns empty array when no file exists', () => {
    expect(store.getHistory()).toEqual([]);
  });

  test('prepends entry with generated id', () => {
    const history = store.addHistory({ text: 'hello' });
    expect(history).toHaveLength(1);
    expect(history[0].text).toBe('hello');
    expect(history[0].id).toBeDefined();
  });

  test('caps history at 500 entries', () => {
    // Write 500 entries directly
    const entries = Array.from({ length: 500 }, (_, i) => ({
      id: String(i),
      text: `entry-${i}`,
    }));
    fs.writeFileSync(store.historyPath, JSON.stringify(entries));

    // Adding one more should keep length at 500
    const result = store.addHistory({ text: 'overflow' });
    expect(result).toHaveLength(500);
    expect(result[0].text).toBe('overflow');
  });

  test('rollover deletes the dropped entry audio file (no orphaned .ogg)', () => {
    const orphanAudio = path.join(tmpDir, 'old-recording.ogg');
    fs.writeFileSync(orphanAudio, 'fake-audio');

    const entries = Array.from({ length: 500 }, (_, i) => ({ id: String(i), text: `e${i}` }));
    entries[entries.length - 1].audio_file = orphanAudio; // this entry will be dropped
    fs.writeFileSync(store.historyPath, JSON.stringify(entries));
    expect(fs.existsSync(orphanAudio)).toBe(true);

    store.addHistory({ text: 'overflow' }); // 501 -> drops the oldest
    expect(fs.existsSync(orphanAudio)).toBe(false); // audio cleaned up, not orphaned
  });

  test('updateHistory modifies matching entry', () => {
    store.addHistory({ text: 'original' });
    const history = store.getHistory();
    const id = history[0].id;

    const updated = store.updateHistory(id, { text: 'modified' });
    expect(updated[0].text).toBe('modified');
    expect(updated[0].id).toBe(id);
  });

  test('updateHistory with non-existent id returns unchanged history', () => {
    store.addHistory({ text: 'entry' });
    const before = store.getHistory();
    const after = store.updateHistory('nonexistent-id', { text: 'nope' });
    expect(after).toEqual(before);
  });

  test('deleteHistory removes matching entry', () => {
    store.addHistory({ text: 'first' });
    store.addHistory({ text: 'second' });
    const history = store.getHistory();
    expect(history).toHaveLength(2);

    const id = history[0].id;
    const after = store.deleteHistory(id);
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe('first'); // second was added first (prepend)
  });

  test('deleteHistory with non-existent id returns unchanged history', () => {
    store.addHistory({ text: 'entry' });
    const before = store.getHistory();
    const after = store.deleteHistory('nonexistent-id');
    expect(after).toHaveLength(before.length);
  });

  test('clearHistory returns empty array', () => {
    store.addHistory({ text: 'entry' });
    const result = store.clearHistory();
    expect(result).toEqual([]);
    expect(store.getHistory()).toEqual([]);
  });

  test('multiple addHistory entries have unique ids', () => {
    store.addHistory({ text: 'a' });
    store.addHistory({ text: 'b' });
    store.addHistory({ text: 'c' });
    const history = store.getHistory();
    const ids = history.map(h => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('ids are unique even within the SAME millisecond — no data loss on delete', () => {
    // Force a Date.now() collision: a bare timestamp id would make both entries
    // share an id, so deleting one would wipe BOTH (silent history data loss).
    const spy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    store.addHistory({ text: 'first' });
    store.addHistory({ text: 'second' });
    spy.mockRestore();

    const history = store.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].id).not.toBe(history[1].id); // distinct despite same ms

    const after = store.deleteHistory(history[0].id);
    expect(after).toHaveLength(1);          // exactly one removed, not both
    expect(after[0].text).toBe('first');
  });

  test('history persists to disk', () => {
    store.addHistory({ text: 'persistent' });
    // Create a new store pointing to the same dir
    const store2 = new Store(tmpDir);
    const history = store2.getHistory();
    expect(history.some(h => h.text === 'persistent')).toBe(true);
  });
});
