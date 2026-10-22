import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default defineConfig([
  globalIgnores(['convex/_generated/**', '.convex/**', 'coverage/**']),
  js.configs.recommended,
  tsPlugin.configs['flat/eslint-recommended'],
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.ts'],
    extends: [tsPlugin.configs['flat/base']],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
]);
