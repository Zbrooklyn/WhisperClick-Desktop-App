module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^electron$': '<rootDir>/tests/mocks/electron.js',
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
    './electron/store.js': {
      statements: 100,
      branches: 100,
    },
    './electron/sidecar.js': {
      statements: 100,
    },
    './electron/preload.js': {
      statements: 100,
    },
  },
};
