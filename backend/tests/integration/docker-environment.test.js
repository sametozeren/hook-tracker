import { GenericContainer, Wait } from 'testcontainers';
import { describe, expect, it } from 'vitest';

// Deliberately the smallest possible container. When this fails, the finding is
// about Docker or Testcontainers on this machine, not about hook-tracker.
describe('testcontainers environment', () => {
  it('starts a container and runs a command in it', async () => {
    const container = await new GenericContainer('alpine:3.20')
      .withCommand(['sh', '-c', 'echo container-ready && sleep 120'])
      .withWaitStrategy(Wait.forLogMessage(/container-ready/))
      .withStartupTimeout(120_000)
      .start();

    try {
      const result = await container.exec(['echo', 'exec-ok']);

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('exec-ok');
    } finally {
      await container.stop();
    }
  });
});
