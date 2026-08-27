import { describe, expect, it } from 'vitest';
import { RETRY_SCHEDULE } from '../../src/shared/retry.js';
import { allQueueNames, assertTopology, createTopology } from '../../src/shared/queue/topology.js';

function createRecordingChannel() {
  const exchanges = [];
  const queues = [];
  const bindings = [];

  return {
    exchanges,
    queues,
    bindings,
    assertExchange: async (name, type, options) => {
      exchanges.push({ name, type, options });
    },
    assertQueue: async (name, options) => {
      queues.push({ name, options });
    },
    bindQueue: async (queue, exchange, routingKey) => {
      bindings.push({ queue, exchange, routingKey });
    },
  };
}

describe('createTopology', () => {
  it('names every object as the architecture table does', () => {
    const topology = createTopology();

    expect(topology.exchanges).toEqual({
      main: 'webhook.exchange',
      retry: 'webhook.retry',
      dlx: 'webhook.dlx',
    });

    expect(allQueueNames(topology)).toEqual([
      'webhook.delivery',
      'webhook.retry.1m',
      'webhook.retry.5m',
      'webhook.retry.30m',
      'webhook.retry.2h',
      'webhook.retry.6h',
      'webhook.throttle.10s',
      'webhook.dlq',
    ]);
  });

  it('derives a separate object set from a namespace, so a test never touches the real queues', () => {
    const topology = createTopology({
      namespace: 'test-run',
      schedule: [{ level: '1m', delayMs: 50 }],
    });

    expect(topology.deliveryQueue).toBe('test-run.delivery');
    expect(topology.retryQueues).toEqual([
      { level: '1m', delayMs: 50, queue: 'test-run.retry.1m', routingKey: 'retry.1m' },
    ]);
  });
});

describe('assertTopology', () => {
  it('declares the three exchanges as durable direct exchanges', async () => {
    const channel = createRecordingChannel();

    await assertTopology(channel, createTopology());

    expect(channel.exchanges).toEqual([
      { name: 'webhook.exchange', type: 'direct', options: { durable: true } },
      { name: 'webhook.retry', type: 'direct', options: { durable: true } },
      { name: 'webhook.dlx', type: 'direct', options: { durable: true } },
    ]);
  });

  it('gives every delay queue its own ttl and dead-letters it back to the delivery queue', async () => {
    const channel = createRecordingChannel();

    await assertTopology(channel, createTopology());

    for (const level of RETRY_SCHEDULE) {
      const declared = channel.queues.find(
        (queue) => queue.name === `webhook.retry.${level.level}`,
      );

      expect(declared.options.arguments).toEqual({
        'x-message-ttl': level.delayMs,
        'x-dead-letter-exchange': 'webhook.exchange',
        'x-dead-letter-routing-key': 'delivery',
      });
    }

    const throttle = channel.queues.find((queue) => queue.name === 'webhook.throttle.10s');

    expect(throttle.options.arguments['x-message-ttl']).toBe(10_000);
  });

  it('leaves the delivery queue and the dlq without a ttl', async () => {
    const channel = createRecordingChannel();

    await assertTopology(channel, createTopology());

    const delivery = channel.queues.find((queue) => queue.name === 'webhook.delivery');
    const dlq = channel.queues.find((queue) => queue.name === 'webhook.dlq');

    expect(delivery.options).toEqual({ durable: true });
    expect(dlq.options).toEqual({ durable: true });
  });

  it('binds each queue to the exchange that feeds it', async () => {
    const channel = createRecordingChannel();

    await assertTopology(channel, createTopology());

    expect(channel.bindings).toContainEqual({
      queue: 'webhook.delivery',
      exchange: 'webhook.exchange',
      routingKey: 'delivery',
    });

    expect(channel.bindings).toContainEqual({
      queue: 'webhook.retry.5m',
      exchange: 'webhook.retry',
      routingKey: 'retry.5m',
    });

    expect(channel.bindings).toContainEqual({
      queue: 'webhook.dlq',
      exchange: 'webhook.dlx',
      routingKey: 'dlq',
    });
  });
});
