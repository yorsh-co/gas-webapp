import { gasEslint } from 'gasdev/eslint';

export default gasEslint(
  {
    ignores: ['.manual-webapp/**'],
    web: {
      files: ['src/web/**/*.ts'],
      tsconfig: './tsconfig.frontend.json',
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
