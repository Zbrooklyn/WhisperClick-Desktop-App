/**
 * Real renderer-driven e2e for WhisperClick Electron.
 *
 * Launches the ACTUAL app (real main process + real shared/frontend renderer)
 * with a MOCKED Python engine (tests/mocks/mock-sidecar.py) and drives the
 * renderer to prove the critical-flow WIRING end to end:
 *   bridge ready -> record gate passes -> stop -> engine 'transcription' event
 *   -> main process stores it -> renderer renders it in the history list.
 *
 * What is REAL here: the Electron main process, the preload bridge, the 5,111-line
 * renderer (index.html) logic, IPC, the state machine, the history store.
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

async function main() {
  // Isolated user-data dir, pre-seeded so the recording gate passes (api mode +
  // a non-empty key) and onboarding is skipped. Never touches real user data.
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-e2e-'));
  const cfgDir = path.join(userData, 'com.whisperclick.dev');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'settings.json'), JSON.stringify({
    mode: 'api', provider: 'openai', openaiApiKey: 'sk-test-e2e-key',
    apiModel: 'whisper-1', onboardingComplete: true, showPill: false,
    soundEnabled: false, theme: 'dark',
  }, null, 2));

  // Point the sidecar at a known Python for the mock engine (the mock lives in
  // tests/mocks with no sibling venv). Prefer the dev venv; otherwise rely on
  // 'python' being on PATH.
  const venvPy = process.platform === 'win32'
    ? path.join(REPO, 'shared', 'engine', '.venv', 'Scripts', 'python.exe')
    : path.join(REPO, 'shared', 'engine', '.venv', 'bin', 'python');
  const pyEnv = fs.existsSync(venvPy) ? { WHISPERCLICK_PYTHON: venvPy } : {};

  let app;
  try {
    app = await electron.launch({
      cwd: REPO,
      args: ['.', `--user-data-dir=${userData}`],
      env: { ...process.env, WHISPERCLICK_ENGINE_PATH: MOCK, ...pyEnv },
      timeout: 30000,
    });
    check('app launches', true);

    const win = await app.firstWindow({ timeout: 20000 });
    await win.waitForLoadState('domcontentloaded');
    check('renderer window loads', true);

    // Renderer shell present
    await win.waitForSelector('#app-frame', { timeout: 10000 });
    check('renderer shell (#app-frame) rendered', true);

    // Preload bridge connected
    await win.waitForFunction(
      () => !!(window.pywebview && window.pywebview.api), null, { timeout: 15000 });
    check('preload bridge (window.pywebview.api) ready', true);

    // Let the app finish wiring its native bridge (configure round-trip).
    await win.waitForTimeout(1500);

    // Drive the trusted hotkey path: start recording.
    await win.evaluate(() => window.triggerTrustedHotkeyToggle());
    // Confirm we actually entered a recording state (gate passed), not a toast.
    const entered = await win.waitForFunction(() => {
      const t = (document.getElementById('status-text') || {}).textContent || '';
      return /record|listen/i.test(t);
    }, null, { timeout: 8000 }).then(() => true).catch(() => false);
    check('record gate passed (entered recording state)', entered,
      entered ? '' : 'status never showed recording — gate may have blocked');

    await win.waitForTimeout(700);
    // Stop recording -> mock emits the transcription event after ~0.3s.
    await win.evaluate(() => window.triggerTrustedHotkeyToggle());

    // The transcription must land in the history list (renderer rendered it).
    const appeared = await win.waitForFunction((expected) => {
      const list = document.getElementById('history-list');
      return !!list && list.textContent.includes(expected);
    }, EXPECTED, { timeout: 12000 }).then(() => true).catch(() => false);
    check('transcription rendered in history (full wiring)', appeared,
      appeared ? `"${EXPECTED}"` : 'transcription text never appeared in #history-list');

  } finally {
    if (app) { try { await app.close(); } catch { /* ignore */ } }
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
