const { ipcMain, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const os = require('os');
const path = require('path');
const realFs = require('fs');

const Store = require('../../electron/store');
const { initUpdater, checkForUpdatesQuietly } = require('../../electron/updater');

let tmpDir;
let store;
let mainWindow;

beforeEach(() => {
  tmpDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'wc-updater-'));
  store = new Store(tmpDir);

  mainWindow = new BrowserWindow();
  mainWindow._destroyed = false;

  // Clear ipcMain handlers from previous tests
  for (const key of Object.keys(ipcMain._handlers)) {
    if (['check-for-updates', 'download-update', 'install-update',
         'set-update-channel', 'get-update-channel'].includes(key)) {
      delete ipcMain._handlers[key];
    }
  }

  // Reset autoUpdater mock state
  autoUpdater.removeAllListeners();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.checkForUpdates.mockClear().mockResolvedValue({});
  autoUpdater.downloadUpdate.mockClear().mockResolvedValue([]);
  autoUpdater.quitAndInstall.mockClear();

  initUpdater(mainWindow, store);
});

afterEach(() => {
  realFs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Configuration ─────────────────────────────────────────────────────

describe('configuration', () => {
  test('sets autoDownload to false', () => {
    expect(autoUpdater.autoDownload).toBe(false);
  });

  test('sets autoInstallOnAppQuit to true', () => {
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  test('sets allowPrerelease from store (beta default)', () => {
    expect(autoUpdater.allowPrerelease).toBe(true);
  });

  test('sets allowPrerelease false when channel is stable', () => {
    const settings = store.getSettings();
    store.saveSettings({ ...settings, updateChannel: 'stable' });

    // Re-init to pick up new settings
    autoUpdater.removeAllListeners();
    initUpdater(mainWindow, store);
    expect(autoUpdater.allowPrerelease).toBe(false);
  });
});

// ── Events → renderer ─────────────────────────────────────────────────

describe('event forwarding', () => {
  test('checking-for-update sends checking status', () => {
    autoUpdater.emit('checking-for-update');
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'update-status', expect.objectContaining({ status: 'checking' })
    );
  });

  test('update-available sends version and releaseDate', () => {
    autoUpdater.emit('update-available', { version: '2.2.0', releaseDate: '2026-03-01' });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'update-status', expect.objectContaining({ status: 'available', version: '2.2.0', releaseDate: '2026-03-01' })
    );
  });

  test('update-not-available sends up-to-date', () => {
    autoUpdater.emit('update-not-available', { version: '2.1.0' });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'update-status', expect.objectContaining({ status: 'up-to-date', version: '2.1.0' })
    );
  });

  test('download-progress sends percent and bytes', () => {
    autoUpdater.emit('download-progress', { percent: 45, transferred: 5000000, total: 11000000 });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'update-status', expect.objectContaining({ status: 'downloading', percent: 45, transferred: 5000000, total: 11000000 })
    );
  });

  test('update-downloaded sends ready status', () => {
    autoUpdater.emit('update-downloaded', { version: '2.2.0' });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'update-status', expect.objectContaining({ status: 'ready', version: '2.2.0' })
    );
  });

  test('error sends error status', () => {
    autoUpdater.emit('error', new Error('Network failure'));
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'update-status', expect.objectContaining({ status: 'error', message: 'Network failure' })
    );
  });

  test('sendStatus includes currentVersion and channel', () => {
    autoUpdater.emit('checking-for-update');
    const sentData = mainWindow.webContents.send.mock.calls[0][1];
    expect(sentData).toHaveProperty('currentVersion');
    expect(sentData).toHaveProperty('channel', 'beta');
  });

  test('does not send when window is destroyed', () => {
    mainWindow._destroyed = true;
    mainWindow.webContents.send.mockClear();
    autoUpdater.emit('checking-for-update');
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
  });
});

// ── IPC handlers ──────────────────────────────────────────────────────

describe('IPC handlers', () => {
  test('check-for-updates calls autoUpdater.checkForUpdates', async () => {
    await ipcMain._invoke('check-for-updates');
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
  });

  test('check-for-updates returns error on failure', async () => {
    autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('Offline'));
    const result = await ipcMain._invoke('check-for-updates');
    expect(result).toEqual({ error: 'Offline' });
  });

  test('download-update calls autoUpdater.downloadUpdate', async () => {
    await ipcMain._invoke('download-update');
    expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
  });

  test('download-update returns error on failure', async () => {
    autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error('Disk full'));
    const result = await ipcMain._invoke('download-update');
    expect(result).toEqual({ error: 'Disk full' });
  });

  test('install-update calls quitAndInstall', async () => {
    await ipcMain._invoke('install-update');
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  test('set-update-channel saves to store and updates allowPrerelease', async () => {
    const result = await ipcMain._invoke('set-update-channel', 'stable');
    expect(result).toEqual({ success: true, channel: 'stable' });
    expect(autoUpdater.allowPrerelease).toBe(false);

    const settings = store.getSettings();
    expect(settings.updateChannel).toBe('stable');
  });

  test('set-update-channel defaults invalid to beta', async () => {
    const result = await ipcMain._invoke('set-update-channel', 'invalid');
    expect(result).toEqual({ success: true, channel: 'beta' });
    expect(autoUpdater.allowPrerelease).toBe(true);
  });

  test('get-update-channel returns stored channel', async () => {
    const result = await ipcMain._invoke('get-update-channel');
    expect(result).toEqual({ channel: 'beta' });
  });
});

// ── Quiet check ───────────────────────────────────────────────────────

describe('checkForUpdatesQuietly', () => {
  test('calls checkForUpdates without throwing', () => {
    expect(() => checkForUpdatesQuietly()).not.toThrow();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
  });

  test('swallows errors', () => {
    autoUpdater.checkForUpdates.mockImplementationOnce(() => { throw new Error('fail'); });
    expect(() => checkForUpdatesQuietly()).not.toThrow();
  });

  test('swallows promise rejections', () => {
    autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('async fail'));
    expect(() => checkForUpdatesQuietly()).not.toThrow();
  });
});
