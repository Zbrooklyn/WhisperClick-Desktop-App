const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Create a unique temporary directory for test isolation.
 * Returns the absolute path.
 */
function createTempDir(prefix = 'wc-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Recursively remove a temporary directory.
 */
function cleanupTempDir(dirPath) {
  if (dirPath && fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Poll a predicate until it returns true or timeout expires.
 * @param {Function} pred - Sync or async function that returns truthy when done
 * @param {Object} opts
 * @param {number} opts.timeout - Max wait in ms (default 5000)
 * @param {number} opts.interval - Poll interval in ms (default 50)
 * @returns {Promise<void>} Rejects on timeout
 */
async function pollUntil(pred, { timeout = 5000, interval = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await pred()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`pollUntil timed out after ${timeout}ms`);
}

module.exports = { createTempDir, cleanupTempDir, pollUntil };
