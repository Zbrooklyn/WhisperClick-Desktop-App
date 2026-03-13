/**
 * updater.js — Auto-update module using electron-updater
 *
 * Extracted from main.js to stay under the 800-line budget.
 * Supports stable/beta channels via GitHub releases (pre-release flag).
 */

const { ipcMain, app, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

let _mainWindow = null;
let _store = null;
let _sidecar = null;

function sendStatus(data) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    data.currentVersion = app.getVersion();
    const defaultChannel = app.getVersion().includes('beta') ? 'beta' : 'stable';
    data.channel = _store ? (_store.getSettings().updateChannel || defaultChannel) : defaultChannel;
    _mainWindow.webContents.send('update-status', data);
  }
}

/**
 * Initialize auto-updater events and IPC handlers.
 * Call once after mainWindow is created.
 */
function initUpdater(mainWindow, store, sidecar) {
  _mainWindow = mainWindow;
  _store = store;
  _sidecar = sidecar;

  // Config
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Channel determines which GitHub releases electron-updater considers.
  // With GitHub provider, the channel matching logic only considers pre-releases
  // when channel is "alpha" or "beta" — setting channel to "latest" skips them
  // even with allowPrerelease=true. So we must set channel to "beta" explicitly.
  // Falls back from beta.yml → latest.yml automatically if beta.yml doesn't exist.
  const settings = store.getSettings();
  const isBeta = settings.updateChannel
    ? settings.updateChannel === 'beta'
    : app.getVersion().includes('beta');
  autoUpdater.channel = isBeta ? 'beta' : 'latest';
  autoUpdater.allowPrerelease = isBeta;

  // --- Events → renderer ---
  autoUpdater.on('checking-for-update', () => {
    sendStatus({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus({
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes || '',
    });
    // Auto-download if user opted in
    const s = _store ? _store.getSettings() : {};
    if (s.autoDownloadUpdates) {
      autoUpdater.downloadUpdate().catch(() => {});
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    sendStatus({
      status: 'up-to-date',
      version: info.version,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({
      status: 'downloading',
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({
      status: 'ready',
      version: info.version,
    });
    // System notification so user knows even if settings panel is closed
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'WhisperClick Update Ready',
        body: `v${info.version} downloaded — restart to install.`,
      });
      n.on('click', () => {
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.show();
          _mainWindow.focus();
        }
      });
      n.show();
    }
  });

  autoUpdater.on('error', (err) => {
    const msg = err.message || 'Update check failed';
    // electron-updater says "No published versions" when already on latest pre-release
    if (msg.includes('No published versions')) {
      sendStatus({ status: 'up-to-date', version: app.getVersion() });
      return;
    }
    sendStatus({ status: 'error', message: msg });
  });

  // --- IPC handlers ---
  ipcMain.handle('check-for-updates', async () => {
    try {
      return await autoUpdater.checkForUpdates();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('download-update', async () => {
    try {
      return await autoUpdater.downloadUpdate();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('install-update', async () => {
    // Write marker so post-update launch can show success message
    try {
      const markerPath = path.join(app.getPath('userData'), 'update-marker.json');
      fs.writeFileSync(markerPath, JSON.stringify({ from: app.getVersion() }));
    } catch { /* non-critical */ }
    // Stop sidecar before installer runs — lingering child processes
    // can prevent NSIS silent mode from relaunching the app.
    if (_sidecar && _sidecar.isRunning) _sidecar.stop();
    await new Promise(r => setTimeout(r, 500));
    autoUpdater.quitAndInstall(true, true);
  });

  ipcMain.handle('set-update-channel', (_, channel) => {
    const valid = channel === 'stable' ? 'stable' : 'beta';
    const settings = _store.getSettings();
    _store.saveSettings({ ...settings, updateChannel: valid });
    autoUpdater.channel = valid === 'beta' ? 'beta' : 'latest';
    autoUpdater.allowPrerelease = valid === 'beta';
    return { success: true, channel: valid };
  });

  ipcMain.handle('get-update-channel', () => {
    const settings = _store.getSettings();
    const defaultChannel = app.getVersion().includes('beta') ? 'beta' : 'stable';
    return { channel: settings.updateChannel || defaultChannel };
  });
}

/**
 * Quiet startup check — swallows errors so the app boots cleanly.
 */
function checkForUpdatesQuietly() {
  try {
    autoUpdater.checkForUpdates().catch(() => {});
  } catch {
    // Swallow — update check is non-critical
  }
}

/**
 * Check if this launch follows a successful update.
 * Returns { updated: true, from: 'x.y.z' } or { updated: false }.
 * Deletes the marker after reading so it only fires once.
 */
function checkUpdateMarker() {
  const markerPath = path.join(app.getPath('userData'), 'update-marker.json');
  try {
    if (!fs.existsSync(markerPath)) return { updated: false };
    const data = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    fs.unlinkSync(markerPath);
    const current = app.getVersion();
    if (data.from && data.from !== current) {
      return { updated: true, from: data.from, to: current };
    }
    return { updated: false };
  } catch {
    try { fs.unlinkSync(markerPath); } catch { /* ignore */ }
    return { updated: false };
  }
}

module.exports = { initUpdater, checkForUpdatesQuietly, checkUpdateMarker };
