"use strict";

const js = require("@eslint/js");
const globals = require("globals");
const promise = require("eslint-plugin-promise");

const commonRules = {
  ...js.configs.recommended.rules,
  "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
  "no-unreachable": "error",
  "no-constant-binary-expression": "error",
  "valid-typeof": "error",
  "no-dupe-keys": "warn",
  "no-useless-assignment": "off",
  "preserve-caught-error": "off",
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-implicit-coercion": "warn",
  "promise/catch-or-return": "warn",
  "promise/no-return-wrap": "error",
  "promise/param-names": "error",
};

module.exports = [
  {
    ignores: [
      "node_modules/**", "dist/**", "release/**", "test-build/**",
      "dist-qa-*/**", "test-local/screenshots/**",
    ],
  },
  {
    files: ["src/**/*.js", "scripts/**/*.js", "scripts/**/*.cjs", "eslint.config.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.es2025 },
    },
    plugins: { promise },
    rules: commonRules,
  },
  {
    files: ["src/renderer/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.es2025 } },
  },
  {
    files: [
      "src/display-number-format.js",
      "src/history-chart-model.js",
      "src/history-opponent-character-stats.js",
    ],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.es2025 } },
  },
  {
    files: ["test-local/**/*.js", "test-local/**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.browser, ...globals.es2025 },
    },
    plugins: { promise },
    rules: commonRules,
  },
];
