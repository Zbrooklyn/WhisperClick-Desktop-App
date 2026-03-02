/**
 * updater.js — Auto-update module using electron-updater
 *
 * Extracted from main.js to stay under the 800-line budget.
 * Supports stable/beta channels via GitHub releases (pre-release flag).
 */

const { ipcMain, app } = require('electron');
const { autoUpdater } = require('electron-updater');

let _mainWindow = null;
let _store = null;

function sendStatus(data) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    data.currentVersion = app.getVersion();
    data.channel = _store ? (_store.getSettings().updateChannel || 'beta') : 'beta';
    _mainWindow.webContents.send('update-status', data);
  }
}

/**
 * Initialize auto-updater events and IPC handlers.
 * Call once after mainWindow is created.
 */
function initUpdater(mainWindow, store) {
  _mainWindow = mainWindow;
  _store = store;

  // Config
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Set channel from stored preference
  const settings = store.getSettings();
  autoUpdater.allowPrerelease = (settings.updateChannel || 'beta') === 'beta';

  // --- Events → renderer ---
  autoUpdater.on('checking-for-update', () => {
    sendStatus({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus({
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
    });
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
  });

  autoUpdater.on('error', (err) => {
    sendStatus({
      status: 'error',
      message: err.message || 'Update check failed',
    });
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

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('set-update-channel', (_, channel) => {
    const valid = channel === 'stable' ? 'stable' : 'beta';
    const settings = _store.getSettings();
    _store.saveSettings({ ...settings, updateChannel: valid });
    autoUpdater.allowPrerelease = valid === 'beta';
    return { success: true, channel: valid };
  });

  ipcMain.handle('get-update-channel', () => {
    const settings = _store.getSettings();
    return { channel: settings.updateChannel || 'beta' };
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

module.exports = { initUpdater, checkForUpdatesQuietly };
