module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 15000,
  maxWorkers: 1,
  setupFiles: ['<rootDir>/tests/setup.js'],
};
