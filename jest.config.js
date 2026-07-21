module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^electron$': '<rootDir>/tests/mocks/electron.js',
    '^electron-updater$': '<rootDir>/tests/mocks/electron-updater.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'],
  testTimeout: 10000,
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 60,
      functions: 80,
      lines: 88,
    },
    './platforms/electron/store.js': {
      statements: 100,
      branches: 100,
    },
    './platforms/electron/sidecar.js': {
      statements: 100,
    },
    './platforms/electron/preload.js': {
      statements: 100,
    },
  },
};
