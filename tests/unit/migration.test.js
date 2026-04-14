const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrateLegacyConfig } = require('../../platforms/electron/migration');

function mkTmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wc-mig-${label}-`));
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

describe('migrateLegacyConfig', () => {
  let userData;

  beforeEach(() => { userData = mkTmp('root'); });
  afterEach(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch {} });

  test('no-op when current configDir already has settings.json', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    writeJson(path.join(currentDir, 'settings.json'), { openaiApiKey: 'current' });
    writeJson(path.join(userData, 'whisperclick-beta', 'settings.json'), { openaiApiKey: 'legacy' });

    const result = migrateLegacyConfig(userData, currentDir, 'beta');

    expect(result).toBeNull();
    const current = JSON.parse(fs.readFileSync(path.join(currentDir, 'settings.json'), 'utf8'));
    expect(current.openaiApiKey).toBe('current');
  });

  test('beta channel: migrates from whisperclick-beta when current is missing', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    const legacyDir = path.join(userData, 'whisperclick-beta');
    writeJson(path.join(legacyDir, 'settings.json'), { openaiApiKey: 'real-key' });
    writeJson(path.join(legacyDir, 'history.json'), [{ id: '1', text: 'hello' }]);

    const result = migrateLegacyConfig(userData, currentDir, 'beta');

    expect(result).toBe('whisperclick-beta');
    const settings = JSON.parse(fs.readFileSync(path.join(currentDir, 'settings.json'), 'utf8'));
    const history = JSON.parse(fs.readFileSync(path.join(currentDir, 'history.json'), 'utf8'));
    expect(settings.openaiApiKey).toBe('real-key');
    expect(history).toEqual([{ id: '1', text: 'hello' }]);
  });

  test('beta channel: falls back to com.whisperclick.app if whisperclick-beta missing', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    const legacyDir = path.join(userData, 'com.whisperclick.app');
    writeJson(path.join(legacyDir, 'settings.json'), { openaiApiKey: 'stranded-key' });

    const result = migrateLegacyConfig(userData, currentDir, 'beta');

    expect(result).toBe('com.whisperclick.app');
    const settings = JSON.parse(fs.readFileSync(path.join(currentDir, 'settings.json'), 'utf8'));
    expect(settings.openaiApiKey).toBe('stranded-key');
  });

  test('beta channel: whisperclick-beta wins over com.whisperclick.app when both exist', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    writeJson(path.join(userData, 'whisperclick-beta', 'settings.json'), { openaiApiKey: 'older-real' });
    writeJson(path.join(userData, 'com.whisperclick.app', 'settings.json'), { openaiApiKey: 'factory-defaults' });

    const result = migrateLegacyConfig(userData, currentDir, 'beta');

    expect(result).toBe('whisperclick-beta');
    const settings = JSON.parse(fs.readFileSync(path.join(currentDir, 'settings.json'), 'utf8'));
    expect(settings.openaiApiKey).toBe('older-real');
  });

  test('stable channel: migrates from whisperclick', () => {
    const currentDir = path.join(userData, 'com.whisperclick.app');
    writeJson(path.join(userData, 'whisperclick', 'settings.json'), { openaiApiKey: 'stable-key' });

    const result = migrateLegacyConfig(userData, currentDir, 'stable');

    expect(result).toBe('whisperclick');
    const settings = JSON.parse(fs.readFileSync(path.join(currentDir, 'settings.json'), 'utf8'));
    expect(settings.openaiApiKey).toBe('stable-key');
  });

  test('returns null when no legacy path has data', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    const result = migrateLegacyConfig(userData, currentDir, 'beta');
    expect(result).toBeNull();
    expect(fs.existsSync(path.join(currentDir, 'settings.json'))).toBe(false);
  });

  test('copies .bak files alongside primary files when present', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    const legacyDir = path.join(userData, 'whisperclick-beta');
    writeJson(path.join(legacyDir, 'settings.json'), { a: 1 });
    writeJson(path.join(legacyDir, 'settings.json.bak'), { a: 0 });
    writeJson(path.join(legacyDir, 'history.json'), []);
    writeJson(path.join(legacyDir, 'history.json.bak'), [{ id: 'old' }]);

    migrateLegacyConfig(userData, currentDir, 'beta');

    expect(fs.existsSync(path.join(currentDir, 'settings.json.bak'))).toBe(true);
    expect(fs.existsSync(path.join(currentDir, 'history.json.bak'))).toBe(true);
  });
});
