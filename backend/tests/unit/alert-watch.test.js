import { describe, expect, it } from 'vitest';
import { createAlertWatch } from '../../src/jobs/alert-watch.js';

const topology = { deadLetterQueue: 'webhook.dlq', deliveryQueue: 'webhook.delivery' };

const config = { ALERT_DLQ_THRESHOLD: 100 };

function createAlerts() {
  const calls = [];

  return {
    calls,
    notify: async (alert) => {
      calls.push(alert);
    },
    notifyConfiguredProjects: async (alert) => {
      calls.push(alert);
    },
  };
}

function createChannel({ depth = 0, failing = false } = {}) {
  return {
    checkQueue: async (queue) => {
      if (failing) {
        throw new Error('channel closed');
      }

      return { queue, messageCount: queue === topology.deadLetterQueue ? depth : 0 };
    },
  };
}

const healthyRedis = { ping: async () => 'PONG' };

const healthyPrisma = { $queryRaw: async () => [{ '?column?': 1 }] };

describe('createAlertWatch', () => {
  it('says nothing while the dead-letter queue is below its threshold', async () => {
    const alerts = createAlerts();
    const run = createAlertWatch({
      prisma: healthyPrisma,
      redis: healthyRedis,
      channel: createChannel({ depth: 99 }),
      topology,
      alerts,
      config,
    });

    await run();

    expect(alerts.calls).toHaveLength(0);
  });

  it('reports the backlog once the queue reaches its threshold', async () => {
    const alerts = createAlerts();
    const run = createAlertWatch({
      prisma: healthyPrisma,
      redis: healthyRedis,
      channel: createChannel({ depth: 100 }),
      topology,
      alerts,
      config,
    });

    await run();

    expect(alerts.calls).toEqual([
      {
        reason: 'dead_letter_backlog',
        detail: { queue: 'webhook.dlq', depth: 100, threshold: 100 },
      },
    ]);
  });

  it('reports an unreachable dependency under its own name', async () => {
    const alerts = createAlerts();
    const run = createAlertWatch({
      prisma: healthyPrisma,
      redis: {
        ping: async () => {
          throw new Error('connection refused');
        },
      },
      channel: createChannel(),
      topology,
      alerts,
      config,
      logger: { error: () => {} },
    });

    await run();

    expect(alerts.calls).toEqual([
      { reason: 'dependency_unreachable', scope: 'redis', detail: { dependency: 'redis' } },
    ]);
  });

  it('logs an unreachable Postgres without alerting, because the addresses live there', async () => {
    const alerts = createAlerts();
    const logged = [];
    const run = createAlertWatch({
      prisma: {
        $queryRaw: async () => {
          throw new Error('connection refused');
        },
      },
      redis: healthyRedis,
      channel: createChannel(),
      topology,
      alerts,
      config,
      logger: { error: (fields) => logged.push(fields) },
    });

    await run();

    expect(alerts.calls).toHaveLength(0);
    expect(logged).toEqual([{ dependency: 'postgres', reason: 'connection refused' }]);
  });
});
