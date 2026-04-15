module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.js'],
  moduleNameMapper: {
    '^\\.\\./config\\.local$': '<rootDir>/tests/mocks/config.local.js',
  },
  clearMocks: true,
  restoreMocks: true,
}
