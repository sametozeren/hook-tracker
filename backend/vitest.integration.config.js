import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.js'],

    // docker-environment.test.js is the standalone probe that tells a Docker
    // problem apart from a code problem, so it must not sit behind a global
    // setup that starts containers before it runs. `npm run test:docker`.
    exclude: ['tests/integration/docker-environment.test.js'],

    globalSetup: ['tests/support/global-setup.js'],

    // The files share one stack; running them at once would let them race for
    // it and would make the suite flaky rather than faster.
    fileParallelism: false,

    testTimeout: 180_000,
    hookTimeout: 240_000,
  },
});
