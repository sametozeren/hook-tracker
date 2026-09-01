import { describe, expect, it } from 'vitest';
import { collectMetrics } from '../../src/api/metrics/collect.js';

function neverResolves() {
  return new Promise(() => {});
}

function fakePrisma({ hangOn } = {}) {
  const groupBy = async () => [];

  return {
    delivery: { groupBy: hangOn === 'deliveries' ? neverResolves : groupBy },
    deliveryAttempt: { groupBy: hangOn === 'attempts' ? neverResolves : groupBy },
    endpoint: { count: async () => 0 },
    $queryRaw: async () => [
      {
        observations: 0,
        total_ms: 0,
        le0: 0,
        le1: 0,
        le2: 0,
        le3: 0,
        le4: 0,
        le5: 0,
        le6: 0,
        le7: 0,
        le8: 0,
      },
    ],
  };
}

function fakeConnection({ hang = false } = {}) {
  return {
    createChannel: async () => ({
      checkQueue: hang ? neverResolves : async () => ({ messageCount: 0 }),
      on: () => {},
      close: async () => {},
    }),
  };
}

function fakePublishCounter() {
  return { snapshot: () => ({ accepted: 0, rejected: 0, error: 0 }) };
}

describe('collectMetrics timeouts', () => {
  it('omits a source that never resolves, without rendering it as zero', async () => {
    const warnings = [];
    const logger = { warn: (fields, message) => warnings.push({ fields, message }) };

    const families = await collectMetrics({
      prisma: fakePrisma(),
      connection: fakeConnection({ hang: true }),
      publishCounter: fakePublishCounter(),
      maxAttempts: 3,
      logger,
      sourceTimeoutMs: 20,
    });

    const names = families.map((family) => family.name);

    expect(names).not.toContain('hooktracker_queue_depth');
    expect(names).not.toContain('hooktracker_dlq_size');
    expect(names).toContain('hooktracker_deliveries_total');
    expect(warnings).toEqual([
      expect.objectContaining({
        fields: expect.objectContaining({ source: 'queues', reason: 'timed out after 20ms' }),
      }),
    ]);
  });

  it('still returns every family when every source answers in time', async () => {
    const families = await collectMetrics({
      prisma: fakePrisma(),
      connection: fakeConnection(),
      publishCounter: fakePublishCounter(),
      maxAttempts: 3,
      sourceTimeoutMs: 20,
    });

    const names = families.map((family) => family.name);

    expect(names).toContain('hooktracker_queue_depth');
    expect(names).toContain('hooktracker_dlq_size');
    expect(names).toContain('hooktracker_deliveries_total');
  });
});
