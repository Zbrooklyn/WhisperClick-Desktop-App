/**
 * Real renderer-driven e2e for WhisperClick Electron.
 *
 * Launches the ACTUAL app (real main process + real shared/frontend renderer)
 * with a MOCKED Python engine (tests/mocks/mock-sidecar.py) and drives the
 * renderer to prove real WIRING end to end.
 *
 * Phase 1 — critical flow + a settings mutation, then quit:
 *   bridge ready -> record gate passes -> stop -> engine 'transcription' event
 *   -> main process stores it -> renderer renders it in the history list; then
 *   change two settings through the real bridge and quit the app.
 * Phase 2 — relaunch the SAME user-data dir and prove durability:
 *   the transcription is still in the rebuilt history list (history store
 *   survived restart + re-rendered), and the two mutated settings persisted
 *   (settings store survived restart).
 *
 * What is REAL here: the Electron main process, the preload bridge, the 5,111-line
 * renderer (index.html) logic, IPC, the state machine, the settings + history
 * stores, and a real process restart.
 * What is MOCKED: the Python engine (no real audio capture / Whisper / network).
 * NOT covered (needs a local, non-RDP machine): real microphone capture, real
 * transcription accuracy, real OS paste/Enter injection.
 *
 * Run: npm run test:e2e:renderer
 */
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '../..');
const MOCK = path.join(REPO, 'tests', 'mocks', 'mock-sidecar.py');
const EXPECTED = 'Hello, this is a test transcription.';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// Point the sidecar at a known Python for the mock engine (the mock lives in
// tests/mocks with no sibling venv). Prefer the dev venv; otherwise rely on
// 'python' being on PATH.
const venvPy = process.platform === 'win32'
  ? path.join(REPO, 'shared', 'engine', '.venv', 'Scripts', 'python.exe')
  : path.join(REPO, 'shared', 'engine', '.venv', 'bin', 'python');
const pyEnv = fs.existsSync(venvPy) ? { WHISPERCLICK_PYTHON: venvPy } : {};

// Pre-seed an isolated user-data dir so the recording gate passes (api mode +
// a non-empty key) and onboarding is skipped. Never touches real user data.
function seedSettings(userData, overrides = {}) {
  const cfgDir = path.join(userData, 'com.whisperclick.dev');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'settings.json'), JSON.stringify({
    mode: 'api', provider: 'openai', openaiApiKey: 'sk-test-e2e-key',
    apiModel: 'whisper-1', onboardingComplete: true, showPill: false,
    soundEnabled: false, theme: 'dark', ...overrides,
  }, null, 2));
  return cfgDir;
}

async function launch(userData) {
  const app = await electron.launch({
    cwd: REPO,
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...process.env, WHISPERCLICK_ENGINE_PATH: MOCK, ...pyEnv },
    timeout: 30000,
  });
  const win = await app.firstWindow({ timeout: 20000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#app-frame', { timeout: 10000 });
  await win.waitForFunction(
    () => !!(window.pywebview && window.pywebview.api), null, { timeout: 15000 });
  // Let the app finish wiring its native bridge (configure round-trip).
  await win.waitForTimeout(1500);
  return { app, win };
}

async function phase1(userData) {
  const { app, win } = await launch(userData);
  try {
    check('app launches', true);
    check('renderer shell + preload bridge ready', true);

    // Drive the trusted hotkey path: start recording.
    await win.evaluate(() => window.triggerTrustedHotkeyToggle());
    const entered = await win.waitForFunction(() => {
      const t = (document.getElementById('status-text') || {}).textContent || '';
      return /record|listen/i.test(t);
    }, null, { timeout: 8000 }).then(() => true).catch(() => false);
    check('record gate passed (entered recording state)', entered,
      entered ? '' : 'status never showed recording — gate may have blocked');

    await win.waitForTimeout(700);
    // Stop recording -> mock emits the transcription event after ~0.3s.
    await win.evaluate(() => window.triggerTrustedHotkeyToggle());

    const appeared = await win.waitForFunction((expected) => {
      const list = document.getElementById('history-list');
      return !!list && list.textContent.includes(expected);
    }, EXPECTED, { timeout: 12000 }).then(() => true).catch(() => false);
    check('transcription rendered in history (full wiring)', appeared,
      appeared ? `"${EXPECTED}"` : 'transcription text never appeared in #history-list');

    // Mutate two settings through the real bridge (distinct flips from the seed:
    // theme dark->light, auto_copy/autoPaste default-true->false).
    const saved = await win.evaluate(async () => {
      await window.pywebview.api.save_settings({ theme: 'light', auto_copy: false });
      return true;
    }).catch(() => false);
    check('settings mutated through bridge (save_settings)', saved);

    // Give the atomic write time to flush before we quit.
    await win.waitForTimeout(600);
  } finally {
    if (app) { try { await app.close(); } catch { /* ignore */ } }
  }
}

async function phase2(userData) {
  const { app, win } = await launch(userData);
  try {
    // History survived the restart AND the renderer re-rendered it on load.
    const historyPersisted = await win.waitForFunction((expected) => {
      const list = document.getElementById('history-list');
      return !!list && list.textContent.includes(expected);
    }, EXPECTED, { timeout: 12000 }).then(() => true).catch(() => false);
    check('history persisted across restart (re-rendered after relaunch)', historyPersisted,
      historyPersisted ? '' : 'transcription missing from #history-list after restart');

    // Settings survived the restart (read back through the real bridge/store).
    const settings = await win.evaluate(() => window.pywebview.api.get_settings());
    check('settings persisted across restart: theme=light',
      settings && settings.theme === 'light', `got theme=${settings && settings.theme}`);
    check('settings persisted across restart: auto_copy=false',
      settings && settings.auto_copy === false, `got auto_copy=${settings && settings.auto_copy}`);
  } finally {
    if (app) { try { await app.close(); } catch { /* ignore */ } }
  }
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-e2e-'));
  seedSettings(userData);
  try {
    await phase1(userData);
    await phase2(userData);
  } finally {
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map(f => f.name).join('; '));
    process.exit(1);
  }
  console.log('renderer-flow e2e: ALL PASS');
  process.exit(0);
}

main().catch((err) => { console.error('e2e crashed:', err); process.exit(1); });
