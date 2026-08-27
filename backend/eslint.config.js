import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import { hookTrackerPlugin, sharedRules } from '../tools/eslint-rules/shared.js';

export default [
  { ignores: ['node_modules/**', 'coverage/**', 'src/generated/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: hookTrackerPlugin,
    rules: sharedRules,
  },
  prettier,
];
