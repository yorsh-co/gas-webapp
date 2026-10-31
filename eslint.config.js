import { gasEslint } from 'gas-dev-config/eslint';

export default gasEslint(
  {
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
);
