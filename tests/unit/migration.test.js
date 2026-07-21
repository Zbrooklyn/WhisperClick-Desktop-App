const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  migrateLegacyConfig,
  scanLegacyFolders,
  getProvenance,
  hasRealData,
  FOLDER_REGISTRY,
} = require('../../platforms/electron/migration');

function mkTmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wc-mig-${label}-`));
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

function writeRealData(dir, { openaiApiKey = 'sk-real', history = [{ id: '1', text: 'hi' }] } = {}) {
  writeJson(path.join(dir, 'settings.json'), { openaiApiKey });
  writeJson(path.join(dir, 'history.json'), history);
}

function writeFactoryDefaults(dir) {
  writeJson(path.join(dir, 'settings.json'), { theme: 'dark' });
  writeJson(path.join(dir, 'history.json'), []);
}

describe('FOLDER_REGISTRY invariants', () => {
  test('every entry has required fields', () => {
    for (const entry of FOLDER_REGISTRY) {
      expect(typeof entry.name).toBe('string');
      expect(['beta', 'stable', 'dev']).toContain(entry.channel);
      expect(typeof entry.deprecatedIn).toBe('string');
      expect(typeof entry.priority).toBe('number');
      expect(typeof entry.reason).toBe('string');
    }
  });

  test('no duplicate (name, channel) pairs', () => {
    const seen = new Set();
    for (const entry of FOLDER_REGISTRY) {
      const key = `${entry.channel}:${entry.name}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('registry contains all known historical beta paths (regression guard)', () => {
    const betaNames = FOLDER_REGISTRY.filter(e => e.channel === 'beta').map(e => e.name);
    expect(betaNames).toContain('whisperclick-beta');
    expect(betaNames).toContain('com.whisperclick.app');
  });

  test('registry contains all known historical stable paths (regression guard)', () => {
    const stableNames = FOLDER_REGISTRY.filter(e => e.channel === 'stable').map(e => e.name);
    expect(stableNames).toContain('whisperclick');
  });
});

describe('hasRealData', () => {
  let root;
  beforeEach(() => { root = mkTmp('real'); });
  afterEach(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

  test('true when settings has openaiApiKey', () => {
    writeJson(path.join(root, 'settings.json'), { openaiApiKey: 'sk-x' });
    expect(hasRealData(root)).toBe(true);
  });

  test('true when settings has geminiApiKey', () => {
    writeJson(path.join(root, 'settings.json'), { geminiApiKey: 'AIza-x' });
    expect(hasRealData(root)).toBe(true);
  });

  test('true when history has at least one entry', () => {
    writeJson(path.join(root, 'settings.json'), {});
    writeJson(path.join(root, 'history.json'), [{ id: '1', text: 'hi' }]);
    expect(hasRealData(root)).toBe(true);
  });

  test('false for factory-default folder (no key, empty history)', () => {
    writeFactoryDefaults(root);
    expect(hasRealData(root)).toBe(false);
  });

  test('false for non-existent folder', () => {
    expect(hasRealData(path.join(root, 'does-not-exist'))).toBe(false);
  });

  test('false for folder with no settings.json', () => {
    fs.mkdirSync(path.join(root, 'empty'));
    expect(hasRealData(path.join(root, 'empty'))).toBe(false);
  });
});

describe('migrateLegacyConfig', () => {
  let userData;
  beforeEach(() => { userData = mkTmp('root'); });
  afterEach(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch {} });

  test('no-op when current configDir already has settings.json', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    writeRealData(currentDir, { openaiApiKey: 'current-key' });
    writeRealData(path.join(userData, 'whisperclick-beta'), { openaiApiKey: 'legacy-key' });

    const result = migrateLegacyConfig(userData, currentDir, 'beta', '2.2.6-beta');
    expect(result).toBeNull();

    const settings = JSON.parse(fs.readFileSync(path.join(currentDir, 'settings.json'), 'utf8'));
    expect(settings.openaiApiKey).toBe('current-key');
  });

  test('beta: migrates from whisperclick-beta with full provenance record', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    writeRealData(path.join(userData, 'whisperclick-beta'), {
      openaiApiKey: 'sk-x',
      history: [{ id: '1' }, { id: '2' }, { id: '3' }],
    });

    const result = migrateLegacyConfig(userData, currentDir, 'beta', '2.2.6-beta');

    expect(result).toMatchObject({
      from: 'whisperclick-beta',
      appVersion: '2.2.6-beta',
      filesCopied: 2,
      historyCount: 3,
    });
    expect(typeof result.at).toBe('string');
    expect(new Date(result.at).toString()).not.toBe('Invalid Date');
  });

  test('beta: prefers whisperclick-beta over com.whisperclick.app (priority order)', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    writeRealData(path.join(userData, 'whisperclick-beta'), { openaiApiKey: 'older-real' });
    writeRealData(path.join(userData, 'com.whisperclick.app'), { openaiApiKey: 'newer-real' });

    const result = migrateLegacyConfig(userData, currentDir, 'beta', '2.2.6-beta');
    expect(result.from).toBe('whisperclick-beta');
    const settings = JSON.parse(fs.readFileSync(path.join(currentDir, 'settings.json'), 'utf8'));
    expect(settings.openaiApiKey).toBe('older-real');
  });

  test('beta: skips whisperclick-beta when factory-default and imports from com.whisperclick.app', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    writeFactoryDefaults(path.join(userData, 'whisperclick-beta'));
    writeRealData(path.join(userData, 'com.whisperclick.app'), { openaiApiKey: 'stranded' });

    const result = migrateLegacyConfig(userData, currentDir, 'beta', '2.2.6-beta');
    expect(result.from).toBe('com.whisperclick.app');
  });

  test('stable: migrates from whisperclick', () => {
    const currentDir = path.join(userData, 'com.whisperclick.app');
    writeRealData(path.join(userData, 'whisperclick'), { openaiApiKey: 'stable-key' });

    const result = migrateLegacyConfig(userData, currentDir, 'stable', '2.2.6');
    expect(result.from).toBe('whisperclick');
  });

  test('returns null when no legacy path has real data', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    writeFactoryDefaults(path.join(userData, 'whisperclick-beta'));
    writeFactoryDefaults(path.join(userData, 'com.whisperclick.app'));

    const result = migrateLegacyConfig(userData, currentDir, 'beta', '2.2.6-beta');
    expect(result).toBeNull();
    expect(fs.existsSync(path.join(currentDir, 'settings.json'))).toBe(false);
  });

  test('writes provenance file after successful migration', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    writeRealData(path.join(userData, 'whisperclick-beta'));

    migrateLegacyConfig(userData, currentDir, 'beta', '2.2.6-beta');

    const prov = getProvenance(currentDir);
    expect(prov.migrations).toHaveLength(1);
    expect(prov.migrations[0].from).toBe('whisperclick-beta');
    expect(prov.migrations[0].appVersion).toBe('2.2.6-beta');
  });

  test('idempotent: does not re-migrate a path already in provenance', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    writeRealData(path.join(userData, 'whisperclick-beta'), { openaiApiKey: 'v1' });
    migrateLegacyConfig(userData, currentDir, 'beta', '2.2.6-beta');

    // Simulate user manually wiping settings but provenance survives
    fs.unlinkSync(path.join(currentDir, 'settings.json'));
    fs.unlinkSync(path.join(currentDir, 'history.json'));

    // Bump source — we want to verify it is NOT re-read
    writeRealData(path.join(userData, 'whisperclick-beta'), { openaiApiKey: 'v2' });

    const result = migrateLegacyConfig(userData, currentDir, 'beta', '2.2.6-beta');
    // whisperclick-beta already migrated → skipped. com.whisperclick.app empty
    // → null. Migration does not redo work.
    expect(result).toBeNull();
    expect(fs.existsSync(path.join(currentDir, 'settings.json'))).toBe(false);
  });

  test('copies .bak files alongside primary files when present', () => {
    const currentDir = path.join(userData, 'com.whisperclick.beta');
    const legacyDir = path.join(userData, 'whisperclick-beta');
    writeRealData(legacyDir);
    writeJson(path.join(legacyDir, 'settings.json.bak'), { old: true });
    writeJson(path.join(legacyDir, 'history.json.bak'), [{ id: 'old' }]);

    migrateLegacyConfig(userData, currentDir, 'beta', '2.2.6-beta');

    expect(fs.existsSync(path.join(currentDir, 'settings.json.bak'))).toBe(true);
    expect(fs.existsSync(path.join(currentDir, 'history.json.bak'))).toBe(true);
  });
});

describe('scanLegacyFolders', () => {
  let userData;
  beforeEach(() => { userData = mkTmp('scan'); });
  afterEach(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch {} });

  test('returns an entry for every beta registry folder with flags', () => {
    writeRealData(path.join(userData, 'whisperclick-beta'));
    const scan = scanLegacyFolders(userData, 'beta');
    expect(scan).toHaveLength(2);

    const wcb = scan.find(e => e.name === 'whisperclick-beta');
    expect(wcb.exists).toBe(true);
    expect(wcb.hasRealData).toBe(true);
    expect(wcb.size).toBeGreaterThan(0);
    // Jest VM realm can make toBeInstanceOf(Date) fail even for valid Date
    // instances; check the interface rather than the constructor identity.
    expect(typeof wcb.lastModified.getTime).toBe('function');
    expect(Number.isFinite(wcb.lastModified.getTime())).toBe(true);

    const app = scan.find(e => e.name === 'com.whisperclick.app');
    expect(app.exists).toBe(false);
    expect(app.hasRealData).toBe(false);
  });

  test('existing folder with only factory defaults reports hasRealData=false', () => {
    writeFactoryDefaults(path.join(userData, 'whisperclick-beta'));
    const scan = scanLegacyFolders(userData, 'beta');
    const wcb = scan.find(e => e.name === 'whisperclick-beta');
    expect(wcb.exists).toBe(true);
    expect(wcb.hasRealData).toBe(false);
  });

  test('beta channel scan excludes stable-channel entries', () => {
    const scan = scanLegacyFolders(userData, 'beta');
    for (const entry of scan) expect(entry.name).not.toBe('whisperclick');
  });
});
