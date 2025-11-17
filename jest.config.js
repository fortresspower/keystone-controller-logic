/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",

  // Look for tests only in src/ and tests/
  testMatch: [
    "**/src/**/?(*.)+(spec|test).[jt]s?(x)",
    "**/tests/**/?(*.)+(spec|test).[jt]s?(x)",
  ],

  // Ignore compiled output and node_modules
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],

  // Optional, just matches your npm test script
  verbose: true,
};
