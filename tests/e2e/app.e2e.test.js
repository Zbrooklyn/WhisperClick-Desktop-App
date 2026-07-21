#!/usr/bin/env node
/**
 * E2E tests for WhisperClick Electron.
 *
 * Launches the real Electron app with WHISPERCLICK_ENGINE_PATH pointing to
 * mock-sidecar.py, then validates behaviour via process output and filesystem.
 *
 * Run: node tests/e2e/app.e2e.test.js
 *   or: npm run test:e2e
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MOCK_SIDECAR = path.resolve(__dirname, '../mocks/mock-sidecar.py');
const ELECTRON_BIN = path.resolve(PROJECT_ROOT, 'node_modules/.bin/electron');

// Use a temp config dir so we don't pollute real settings
const TEST_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-e2e-'));

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, testName, detail = '') {
  if (condition) {
    passed++;
    results.push({ name: testName, status: 'PASS' });
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    results.push({ name: testName, status: 'FAIL', detail });
    console.log(`  FAIL: ${testName}${detail ? ' — ' + detail : ''}`);
  }
}

/**
 * Launch the Electron app with mock sidecar and collect output.
 * Returns { stdout, stderr, code } after the process exits or timeout.
 */
function launchApp({ timeout = 15000, env = {} } = {}) {
  return new Promise((resolve) => {
    const electronPath = process.platform === 'win32'
      ? path.resolve(PROJECT_ROOT, 'node_modules/.bin/electron.cmd')
      : ELECTRON_BIN;

    const child = spawn(electronPath, ['.'], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        WHISPERCLICK_ENGINE_PATH: MOCK_SIDECAR,
        ELECTRON_NO_ATTACH_CONSOLE: '1',
        // Force a test-specific user data dir
        ELECTRON_USER_DATA_OVERRIDE: TEST_CONFIG_DIR,
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ stdout, stderr, code: null, timedOut: true });
    }, timeout);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut: false });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: -1, error: err.message, timedOut: false });
    });
  });
}

/**
 * Launch mock sidecar directly and test its JSON protocol.
 */
function launchMockSidecar() {
  return new Promise((resolve, reject) => {
    // Find Python
    let pythonCmd = 'python';
    try {
      execSync('python3 --version', { stdio: 'ignore' });
      pythonCmd = 'python3';
    } catch {
      try {
        execSync('python --version', { stdio: 'ignore' });
        pythonCmd = 'python';
      } catch {
        reject(new Error('Python not found'));
        return;
      }
    }

    const child = spawn(pythonCmd, [MOCK_SIDECAR], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = [];
    let lineBuffer = '';

    child.stdout.on('data', (d) => {
      lineBuffer += d.toString();
      const parts = lineBuffer.split('\n');
      lineBuffer = parts.pop();
      for (const part of parts) {
        if (part.trim()) {
          try {
            lines.push(JSON.parse(part));
          } catch {}
        }
      }
    });

    resolve({ child, lines });
  });
}

function sendToSidecar(child, msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

function waitForLines(lines, count, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (lines.length >= count) return resolve();
      if (Date.now() - start > timeout) return reject(new Error(`Timeout waiting for ${count} lines, got ${lines.length}`));
      setTimeout(check, 50);
    };
    check();
  });
}

/** Wait until a predicate matches any line in the array */
function waitForEvent(lines, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const match = lines.find(predicate);
      if (match) return resolve(match);
      if (Date.now() - start > timeout) return reject(new Error('Timeout waiting for event'));
      setTimeout(check, 50);
    };
    check();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

async function testMockSidecarReady() {
  const { child, lines } = await launchMockSidecar();
  try {
    await waitForLines(lines, 1, 3000);
    const readyMsg = lines.find(m => m.event === 'ready');
    assert(!!readyMsg, 'Mock sidecar sends ready event on startup');
  } finally {
    sendToSidecar(child, { id: 0, command: 'quit' });
  }
}

async function testMockSidecarPing() {
  const { child, lines } = await launchMockSidecar();
  try {
    await waitForLines(lines, 1, 3000); // wait for ready
    sendToSidecar(child, { id: 1, command: 'ping' });
    await waitForLines(lines, 2, 3000);
    const pong = lines.find(m => m.id === 1);
    assert(pong && pong.result === 'pong', 'Mock sidecar responds to ping');
  } finally {
    sendToSidecar(child, { id: 0, command: 'quit' });
  }
}

async function testMockSidecarConfigure() {
  const { child, lines } = await launchMockSidecar();
  try {
    await waitForLines(lines, 1, 3000);
    sendToSidecar(child, { id: 1, command: 'configure', mode: 'api', provider: 'openai' });
    await waitForLines(lines, 2, 3000);
    const resp = lines.find(m => m.id === 1);
    assert(resp && resp.result === 'ok', 'Mock sidecar handles configure command');
  } finally {
    sendToSidecar(child, { id: 0, command: 'quit' });
  }
}

async function testMockSidecarRecordingFlow() {
  const { child, lines } = await launchMockSidecar();
  try {
    await waitForLines(lines, 1, 3000); // ready

    // Start recording
    sendToSidecar(child, { id: 1, command: 'start_rec' });
    await waitForLines(lines, 2, 3000); // start_rec response
    const startResp = lines.find(m => m.id === 1);
    assert(startResp && startResp.result === 'ok', 'start_rec returns ok');

    // Wait for level events
    await waitForLines(lines, 4, 3000); // at least some level events
    const levelEvents = lines.filter(m => m.event === 'level');
    assert(levelEvents.length > 0, 'start_rec emits level events');

    // Stop recording — transcription event arrives ~300ms later
    sendToSidecar(child, { id: 2, command: 'stop_rec' });
    try {
      const transcription = await waitForEvent(lines, m => m.event === 'transcription', 5000);
      assert(true, 'stop_rec triggers transcription event');
      assert(
        transcription && transcription.data && transcription.data.text,
        'Transcription event contains text'
      );
    } catch {
      assert(false, 'stop_rec triggers transcription event', 'timed out waiting for transcription');
      assert(false, 'Transcription event contains text', 'no transcription received');
    }
  } finally {
    sendToSidecar(child, { id: 0, command: 'quit' });
  }
}

async function testMockSidecarCancel() {
  const { child, lines } = await launchMockSidecar();
  try {
    await waitForLines(lines, 1, 3000);
    sendToSidecar(child, { id: 1, command: 'cancel' });
    await waitForLines(lines, 3, 3000); // ready + cancelled event + cancel response
    const cancelled = lines.find(m => m.event === 'cancelled');
    assert(!!cancelled, 'cancel triggers cancelled event');
  } finally {
    sendToSidecar(child, { id: 0, command: 'quit' });
  }
}

async function testMockSidecarVerifyKeyOpenAI() {
  const { child, lines } = await launchMockSidecar();
  try {
    await waitForLines(lines, 1, 3000);
    sendToSidecar(child, { id: 1, command: 'verify_key', provider: 'openai', api_key: 'sk-test123' });
    await waitForLines(lines, 2, 3000);
    const resp = lines.find(m => m.id === 1);
    assert(resp && resp.valid === true, 'verify_key accepts valid OpenAI key format (sk-)');
  } finally {
    sendToSidecar(child, { id: 0, command: 'quit' });
  }
}

async function testMockSidecarVerifyKeyGemini() {
  const { child, lines } = await launchMockSidecar();
  try {
    await waitForLines(lines, 1, 3000);
    sendToSidecar(child, { id: 1, command: 'verify_key', provider: 'gemini', api_key: 'AIzaTest' });
    await waitForLines(lines, 2, 3000);
    const resp = lines.find(m => m.id === 1);
    assert(resp && resp.valid === true, 'verify_key accepts valid Gemini key format (AIza)');
  } finally {
    sendToSidecar(child, { id: 0, command: 'quit' });
  }
}

async function testMockSidecarDownloadModel() {
  const { child, lines } = await launchMockSidecar();
  try {
    await waitForLines(lines, 1, 3000);
    sendToSidecar(child, { id: 1, command: 'download_model', model_name: 'small' });
    await waitForLines(lines, 7, 5000); // ready + response + 5 progress events
    const progressEvents = lines.filter(m => m.event === 'model_download_progress');
    assert(progressEvents.length >= 4, 'download_model sends progress events (0%, 25%, 50%, 75%, 100%)');
    const complete = progressEvents.find(m => m.data && m.data.status === 'complete');
    assert(!!complete, 'download_model sends completion event');
  } finally {
    sendToSidecar(child, { id: 0, command: 'quit' });
  }
}

async function testMockSidecarCleanQuit() {
  const { child, lines } = await launchMockSidecar();
  await waitForLines(lines, 1, 3000);

  sendToSidecar(child, { id: 99, command: 'quit' });

  // Wait for process to exit
  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  assert(exitCode === 0, 'Mock sidecar exits cleanly on quit command');
}

async function testAppLaunchesWithMockSidecar() {
  // This test only runs if electron can be launched in headless/test mode
  // On CI without a display, this will likely fail — skip gracefully
  try {
    const result = await launchApp({ timeout: 10000 });
    if (result.error) {
      assert(false, 'App launches without crash', result.error);
    } else {
      // App either ran successfully or timed out (which is fine — means it's running)
      const noFatalError = !result.stderr.includes('FATAL') && !result.stderr.includes('Cannot find module');
      assert(noFatalError, 'App launches without fatal errors');
    }
  } catch (err) {
    // Skip if electron can't run (no display, etc.)
    console.log(`  SKIP: App launch test — ${err.message}`);
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────

async function main() {
  console.log('\nWhisperClick Electron — E2E Tests\n');

  await testMockSidecarReady();
  await testMockSidecarPing();
  await testMockSidecarConfigure();
  await testMockSidecarRecordingFlow();
  await testMockSidecarCancel();
  await testMockSidecarVerifyKeyOpenAI();
  await testMockSidecarVerifyKeyGemini();
  await testMockSidecarDownloadModel();
  await testMockSidecarCleanQuit();
  await testAppLaunchesWithMockSidecar();

  // Cleanup
  try { fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E test runner crashed:', err);
  try { fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
