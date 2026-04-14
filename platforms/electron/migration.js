const fs = require('fs');
const path = require('path');

const COPY_FILES = ['settings.json', 'settings.json.bak', 'history.json', 'history.json.bak'];

// Priority-ordered legacy config folder names to check when the current
// configDir has no settings.json.
//
// History of path changes:
//   - pre-2.2.1: whisperclick / whisperclick-beta / whisperclick-dev
//   - 2.2.1–2.2.4: com.whisperclick.app (for both beta and stable), com.whisperclick.dev
//   - 2.2.5+: com.whisperclick.app (stable), com.whisperclick.beta (beta), com.whisperclick.dev (dev)
//
// The 2.2.1–2.2.4 window stranded data because the 404 updater bug prevented
// most users from actually installing those versions — they jumped from 2.2.0
// directly to 2.2.4+ and discovered their data was in the old folder.
const LEGACY_PATHS = {
  beta: ['whisperclick-beta', 'com.whisperclick.app'],
  stable: ['whisperclick'],
  dev: [],
};

function migrateLegacyConfig(userData, currentConfigDir, channel) {
  const currentSettings = path.join(currentConfigDir, 'settings.json');
  if (fs.existsSync(currentSettings)) return null;

  const candidates = LEGACY_PATHS[channel] || [];
  for (const name of candidates) {
    const legacyDir = path.join(userData, name);
    const legacySettings = path.join(legacyDir, 'settings.json');
    if (!fs.existsSync(legacySettings)) continue;

    try { fs.mkdirSync(currentConfigDir, { recursive: true }); } catch {}
    for (const file of COPY_FILES) {
      const src = path.join(legacyDir, file);
      const dst = path.join(currentConfigDir, file);
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, dst); } catch {}
      }
    }
    return name;
  }
  return null;
}

module.exports = { migrateLegacyConfig, LEGACY_PATHS };
