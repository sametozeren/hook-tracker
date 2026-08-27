import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import paddingAroundDefinitions from '../tools/eslint-rules/padding-around-definitions.js';

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
    plugins: {
      'hook-tracker': { rules: { 'padding-around-definitions': paddingAroundDefinitions } },
    },
    rules: {
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'hook-tracker/padding-around-definitions': 'error',
      'lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: true }],
    },
  },
  prettier,
];
