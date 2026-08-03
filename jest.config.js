module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^electron$': '<rootDir>/tests/mocks/electron.js',
    '^electron-updater$': '<rootDir>/tests/mocks/electron-updater.js',
  },
  // The three ignored source trees hold node:test suites, not Jest suites — they
  // `require('node:test')` and Jest cannot execute them, so it reports 11 red
  // suites that have nothing to do with the code. That noise is what let the one
  // REAL failure (tests/unit/main-ipc.test.js) sit unnoticed behind a
  // continue-on-error in ci.yml. They are not being silenced: `npm run test:node`
  // runs all 92 of them and ci.yml gates on it.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/e2e/',
    '/shared/analysis/test/',
    '/platforms/electron/premium/',
    '/platforms/web/tests/',
  ],
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
