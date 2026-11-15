module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
};
