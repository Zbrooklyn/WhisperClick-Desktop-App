/**
 * Mock for require('electron-updater') — used by Jest moduleNameMapper.
 */

const EventEmitter = require('events');

class MockAutoUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = true;
    this.autoInstallOnAppQuit = false;
    this.allowPrerelease = false;
    this.checkForUpdates = jest.fn().mockResolvedValue({});
    this.downloadUpdate = jest.fn().mockResolvedValue([]);
    this.quitAndInstall = jest.fn();
  }
}

const autoUpdater = new MockAutoUpdater();

module.exports = { autoUpdater };
