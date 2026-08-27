import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each integration file starts its own containers; running them at the same
    // time makes the suite flaky on a laptop rather than faster.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 240_000,
  },
});
