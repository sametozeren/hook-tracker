import paddingAroundDefinitions from './padding-around-definitions.js';

// backend/ and dashboard/ are independent packages with no root workspace, so
// the two configs stay separate. What they must agree on lives here: the two
// packages are reviewed against one rule set, and drift between them would make
// docs/code-review.md untrue for one of them.
export const hookTrackerPlugin = {
  'hook-tracker': { rules: { 'padding-around-definitions': paddingAroundDefinitions } },
};

export const sharedRules = {
  'no-console': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  eqeqeq: ['error', 'always'],
  'prefer-const': 'error',
  'no-var': 'error',
  'hook-tracker/padding-around-definitions': 'error',
  'lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: true }],
};
