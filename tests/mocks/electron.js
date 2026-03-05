/**
 * Mock for require('electron') — used by Jest moduleNameMapper.
 *
 * Provides minimal stubs for all Electron APIs used by the codebase:
 * safeStorage, nativeImage, Tray, Menu, BrowserWindow, app, ipcMain,
 * ipcRenderer, contextBridge, clipboard, screen, globalShortcut, dialog.
 */

// --- safeStorage ---
let encryptionAvailable = true;

const safeStorage = {
  isEncryptionAvailable: () => encryptionAvailable,
  encryptString: (plain) => Buffer.from('encrypted:' + plain),
  decryptString: (buf) => {
    const str = buf.toString();
    if (str.startsWith('encrypted:')) return str.slice('encrypted:'.length);
    throw new Error('Cannot decrypt');
  },
  _setAvailable: (val) => { encryptionAvailable = val; },
  _reset: () => { encryptionAvailable = true; },
};

// --- nativeImage ---
const nativeImage = {
  createFromBuffer: jest.fn((buf) => ({
    _buffer: buf,
    toPNG: () => buf,
    getSize: () => ({ width: 16, height: 16 }),
    isEmpty: () => false,
  })),
  createFromPath: jest.fn(() => ({
    isEmpty: () => true, // force fallback to generated icon in tests
    getSize: () => ({ width: 0, height: 0 }),
  })),
};

// --- Tray ---
class Tray {
  static _instances = [];

  constructor(icon) {
    this.icon = icon;
    this.toolTip = '';
    this.contextMenu = null;
    this._listeners = {};
    Tray._instances.push(this);
  }
  setToolTip(tip) { this.toolTip = tip; }
  setContextMenu(menu) { this.contextMenu = menu; }
  popUpContextMenu(menu) { this.lastPopupMenu = menu; }
  setImage(img) { this.icon = img; }
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  async emit(event, ...args) {
    const fns = this._listeners[event] || [];
    for (const fn of fns) await fn(...args);
  }

  static _clear() { Tray._instances.length = 0; }
}

// --- Menu ---
const Menu = {
  buildFromTemplate: jest.fn((template) => ({
    _template: template,
    popup: jest.fn(),
  })),
};

// --- BrowserWindow ---
class BrowserWindow {
  static _instances = [];

  constructor(opts = {}) {
    this.opts = opts;
    this._destroyed = false;
    this._visible = false;
    this._maximized = false;
    this._listeners = {};
    this.webContents = {
      send: jest.fn(),
      executeJavaScript: jest.fn().mockResolvedValue(undefined),
    };
    // jest.fn() wrappers for assertability
    this.loadFile = jest.fn().mockResolvedValue(undefined);
    this.show = jest.fn(() => { this._visible = true; });
    this.hide = jest.fn(() => { this._visible = false; });
    this.close = jest.fn(() => { this._destroyed = true; });
    this.destroy = jest.fn(() => { this._destroyed = true; });
    this.focus = jest.fn();
    this.minimize = jest.fn();
    this.restore = jest.fn();
    this.maximize = jest.fn(() => { this._maximized = true; });
    this.unmaximize = jest.fn(() => { this._maximized = false; });
    this.isMaximized = jest.fn(() => this._maximized);
    this.isMinimized = jest.fn(() => false);
    this.isDestroyed = jest.fn(() => this._destroyed);
    this.setAlwaysOnTop = jest.fn();
    this.setBackgroundColor = jest.fn();
    this.setTitleBarOverlay = jest.fn();
    this.setIgnoreMouseEvents = jest.fn();
    this.setBounds = jest.fn();
    this.getBounds = jest.fn(() => ({ x: 960, y: 50, width: 90, height: 30 }));
    BrowserWindow._instances.push(this);
  }

  once(event, fn) { if (event === 'ready-to-show') fn(); }
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  static _clear() { BrowserWindow._instances.length = 0; }
}

// --- app ---
const _readyCallbacks = [];
const app = {
  isPackaged: false,
  getVersion: () => '2.0.1',
  getName: () => 'WhisperClick',
  getPath: (name) => {
    if (name === 'userData') return '/tmp/whisperclick-test';
    return '/tmp';
  },
  requestSingleInstanceLock: () => true,
  setLoginItemSettings: jest.fn(),
  whenReady: () => ({
    then: (cb) => { _readyCallbacks.push(cb); },
  }),
  on: jest.fn(),
  quit: jest.fn(),
  _triggerReady: () => { _readyCallbacks.forEach(cb => cb()); },
  _readyCallbacks,
};

// --- ipcMain ---
const _handlers = {};
const ipcMain = {
  handle: jest.fn((channel, handler) => {
    _handlers[channel] = handler;
  }),
  _handlers,
  _invoke: async (channel, ...args) => {
    if (_handlers[channel]) return _handlers[channel]({}, ...args);
    throw new Error(`No handler for ${channel}`);
  },
};

// --- ipcRenderer ---
const _rendererListeners = {};
const ipcRenderer = {
  invoke: jest.fn(async (channel, ...args) => {
    // Proxy to ipcMain handlers if available
    if (_handlers[channel]) return _handlers[channel]({}, ...args);
    return undefined;
  }),
  on: jest.fn((channel, fn) => {
    if (!_rendererListeners[channel]) _rendererListeners[channel] = [];
    _rendererListeners[channel].push(fn);
  }),
  _listeners: _rendererListeners,
};

// --- contextBridge ---
let _exposedAPIs = {};
const contextBridge = {
  exposeInMainWorld: jest.fn((name, api) => {
    _exposedAPIs[name] = api;
  }),
  _getExposed: (name) => _exposedAPIs[name],
  _reset: () => { _exposedAPIs = {}; },
};

// --- clipboard ---
let _clipboardText = '';
const clipboard = {
  writeText: jest.fn((text) => { _clipboardText = text; }),
  readText: jest.fn(() => _clipboardText),
  _reset: () => { _clipboardText = ''; },
};

// --- screen ---
const screen = {
  getPrimaryDisplay: () => ({
    id: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    workAreaSize: { width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
  }),
  getAllDisplays: () => [
    {
      id: 1,
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
    },
  ],
};

// --- globalShortcut ---
const _registeredShortcuts = {};
const globalShortcut = {
  register: jest.fn((accel, cb) => {
    _registeredShortcuts[accel] = cb;
    return true;
  }),
  unregister: jest.fn((accel) => {
    delete _registeredShortcuts[accel];
  }),
  unregisterAll: jest.fn(() => {
    for (const k of Object.keys(_registeredShortcuts)) delete _registeredShortcuts[k];
  }),
  _shortcuts: _registeredShortcuts,
};

// --- dialog ---
const dialog = {
  showSaveDialog: jest.fn().mockResolvedValue({ canceled: true }),
  showOpenDialog: jest.fn().mockResolvedValue({ canceled: true }),
  showMessageBox: jest.fn().mockResolvedValue({ response: 0 }),
};

class MockNotification {
  constructor() { this._handlers = {}; }
  on(event, handler) { this._handlers[event] = handler; return this; }
  show() {}
  static isSupported() { return true; }
}

module.exports = {
  safeStorage,
  nativeImage,
  Tray,
  Menu,
  BrowserWindow,
  app,
  ipcMain,
  ipcRenderer,
  contextBridge,
  clipboard,
  screen,
  globalShortcut,
  dialog,
  Notification: MockNotification,
};
