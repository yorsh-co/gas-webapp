import { gasEslint } from 'gas-dev-config/eslint';

export default gasEslint(
  {
    ignores: ['.manual-webapp/**'],
    web: {
      files: ['src/web/**/*.ts'],
      tsconfig: './tsconfig.frontend.json',
    },
  },
  // Remove once gas-dev-config ^1.5.0 is adopted: the preset ships this rule.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/web/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: ':function[async=true]',
          message:
            'Apps Script rejects async/await on push; Apps Script code must be synchronous.',
        },
        {
          selector: 'AwaitExpression',
          message:
            'Apps Script rejects async/await on push; Apps Script code must be synchronous.',
        },
        {
          selector: 'ForOfStatement[await=true]',
          message:
            'Apps Script rejects async/await on push; Apps Script code must be synchronous.',
        },
      ],
    },
  },
  // The manual fixture is a global-scope Apps Script file that uses the
  // library's globals, like a consumer's code.
  {
    files: ['manual/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        console: 'readonly',
        Utilities: 'readonly',
        GasError: 'readonly',
        GasWebApp: 'readonly',
        createAckTracker: 'readonly',
        createLoggingMiddleware: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
