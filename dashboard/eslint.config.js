import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import { hookTrackerPlugin, sharedRules } from '../tools/eslint-rules/shared.js';

export default [
  { ignores: ['node_modules/**', 'dist/**'] },
  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: hookTrackerPlugin,
    rules: sharedRules,
  },
  {
    files: ['vite.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
];
