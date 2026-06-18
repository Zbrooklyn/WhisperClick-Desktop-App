#!/usr/bin/env node
// tools/smoke-test-release.js
//
// Pre-release smoke test: walks the built artifacts and verifies that every
// installer file referenced by latest*.yml (a) exists on disk and (b) has
// the sha512 the yml says it should.
//
// Intended to run in CI between build jobs and the publish step. Fails with
// non-zero exit on any mismatch, which blocks the tag from actually
// releasing — the failure mode this catches is exactly what put us in the
// 404 hole with 2.2.4-beta: yml points at an asset that wasn't built or
// that got corrupted between build and upload.
//
// Usage:
//   node tools/smoke-test-release.js <artifacts-root>
//
// Expects artifacts-root to contain subdirectories like electron-windows/,
// electron-macos-arm64/, electron-linux/, each with their platform-specific
// yml alongside the installer(s) it references.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fail(msg) {
  console.error(`SMOKE-TEST FAIL: ${msg}`);
  process.exitCode = 1;
}

function parseSimpleYaml(text) {
  // electron-updater's latest.yml is a subset of YAML: top-level key: value,
  // a files: list of maps, version/path/sha512/releaseDate at the root.
  // Good enough for our validation; avoids pulling in a dependency.
  const out = { files: [] };
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }

    if (/^files:\s*$/.test(line)) {
      i++;
      let current = null;
      while (i < lines.length && /^\s/.test(lines[i])) {
        const l = lines[i];
        const trimmed = l.trim();
        if (trimmed.startsWith('- ')) {
          if (current) out.files.push(current);
          current = {};
          const rest = trimmed.slice(2);
          const m = rest.match(/^(\w+):\s*(.*)$/);
          if (m) current[m[1]] = m[2];
        } else {
          const m = trimmed.match(/^(\w+):\s*(.*)$/);
          if (m && current) current[m[1]] = m[2];
        }
        i++;
      }
      if (current) out.files.push(current);
      continue;
    }

    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) out[m[1]] = m[2];
    i++;
  }
  return out;
}

function sha512Base64(filePath) {
  const h = crypto.createHash('sha512');
  h.update(fs.readFileSync(filePath));
  return h.digest('base64');
}

function unquote(s) {
  if (!s) return s;
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  return t;
}

function checkYml(ymlPath) {
  console.log(`\nChecking: ${ymlPath}`);
  const text = fs.readFileSync(ymlPath, 'utf8');
  const doc = parseSimpleYaml(text);

  if (!doc.version) { fail(`${ymlPath}: missing 'version' field`); return; }
  if (!doc.files || doc.files.length === 0) { fail(`${ymlPath}: no files listed`); return; }

  console.log(`  version: ${doc.version}   files: ${doc.files.length}`);

  const ymlDir = path.dirname(ymlPath);
  let ok = 0;
  for (const f of doc.files) {
    const url = unquote(f.url);
    const expectSha = unquote(f.sha512);
    const expectSize = f.size ? parseInt(f.size, 10) : null;
    if (!url) { fail(`  file entry missing url`); continue; }
    if (!expectSha) { fail(`  ${url}: missing sha512`); continue; }

    const abs = path.join(ymlDir, url);
    if (!fs.existsSync(abs)) {
      fail(`  ${url}: referenced by ${path.basename(ymlPath)} but not present in ${ymlDir}`);
      continue;
    }
    const stat = fs.statSync(abs);
    if (expectSize != null && stat.size !== expectSize) {
      fail(`  ${url}: size mismatch — yml says ${expectSize}, disk is ${stat.size}`);
      continue;
    }
    const actualSha = sha512Base64(abs);
    if (actualSha !== expectSha) {
      fail(`  ${url}: sha512 mismatch`);
      console.error(`    expected: ${expectSha}`);
      console.error(`    actual:   ${actualSha}`);
      continue;
    }
    console.log(`  OK ${url}  (${stat.size} bytes)`);
    ok++;
  }
  console.log(`  → ${ok}/${doc.files.length} files validated`);
}

function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('Usage: node smoke-test-release.js <artifacts-root>');
    process.exit(2);
  }
  if (!fs.existsSync(root)) {
    console.error(`Artifacts root does not exist: ${root}`);
    process.exit(2);
  }

  // Find every *.yml at any depth under root that matches electron-updater patterns
  const ymlPatterns = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];
  const found = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (ymlPatterns.includes(entry.name)) found.push(p);
    }
  }
  walk(root);

  if (found.length === 0) {
    fail(`no latest*.yml files found under ${root}`);
    return;
  }

  console.log(`Found ${found.length} update manifest(s):`);
  for (const y of found) console.log(`  ${y}`);

  for (const y of found) checkYml(y);

  if (process.exitCode) {
    console.error('\n❌ Smoke test failed. Release will not publish.');
  } else {
    console.log('\n✅ Smoke test passed. All referenced installers exist and sha512 matches.');
  }
}

main();
