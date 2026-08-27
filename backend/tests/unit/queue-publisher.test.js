import { describe, expect, it } from 'vitest';
import { newId } from '../../src/shared/ids.js';
import { createPublisher } from '../../src/shared/queue/publisher.js';
import { createTopology } from '../../src/shared/queue/topology.js';

function createRecordingChannel() {
  const published = [];

  return {
    published,
    publish: (exchange, routingKey, content, options, callback) => {
      published.push({ exchange, routingKey, content, options });
      callback(null);

      return true;
    },
  };
}

function lastMessage(channel) {
  const entry = channel.published.at(-1);

  return { ...entry, body: JSON.parse(entry.content.toString('utf8')) };
}

describe('createPublisher', () => {
  const deliveryId = newId('delivery');

  it('publishes a first attempt to the main exchange', async () => {
    const channel = createRecordingChannel();
    const publisher = createPublisher({ channel });

    await publisher.publishDelivery({ deliveryId, attempt: 1 });

    const message = lastMessage(channel);

    expect(message.exchange).toBe('webhook.exchange');
    expect(message.routingKey).toBe('delivery');
    expect(message.options.persistent).toBe(true);
    expect(message.options.expiration).toBeUndefined();
  });

  it('carries the delivery id and attempt only, so the broker holds no payload or secret', async () => {
    const channel = createRecordingChannel();
    const publisher = createPublisher({ channel });

    await publisher.publishDelivery({ deliveryId, attempt: 3 });

    expect(lastMessage(channel).body).toEqual({ deliveryId, attempt: 3 });
  });

  it('routes a retry to its level queue with a jittered expiration below the queue ttl', async () => {
    const channel = createRecordingChannel();
    const publisher = createPublisher({ channel, random: () => 1 });

    await publisher.publishRetry({ deliveryId, attempt: 2, level: '5m' });

    const message = lastMessage(channel);

    expect(message.exchange).toBe('webhook.retry');
    expect(message.routingKey).toBe('retry.5m');
    expect(Number(message.options.expiration)).toBe(270_000);
    expect(Number(message.options.expiration)).toBeLessThanOrEqual(300_000);
  });

  it('parks a throttled delivery without an expiration, leaving the queue ttl in charge', async () => {
    const channel = createRecordingChannel();
    const publisher = createPublisher({ channel });

    await publisher.publishThrottle({ deliveryId, attempt: 2 });

    const message = lastMessage(channel);

    expect(message.routingKey).toBe('throttle.10s');
    expect(message.options.expiration).toBeUndefined();
  });

  it('sends a terminal failure to the dead letter exchange', async () => {
    const channel = createRecordingChannel();
    const publisher = createPublisher({ channel });

    await publisher.publishDeadLetter({ deliveryId, attempt: 6 });

    expect(lastMessage(channel).exchange).toBe('webhook.dlx');
  });

  it('rejects an id from another entity and a malformed attempt', async () => {
    const channel = createRecordingChannel();
    const publisher = createPublisher({ channel });

    await expect(
      publisher.publishDelivery({ deliveryId: newId('event'), attempt: 1 }),
    ).rejects.toThrow(/Expected a dlv_ id/);

    await expect(publisher.publishDelivery({ deliveryId, attempt: 0 })).rejects.toThrow(
      /1-based attempt number/,
    );
  });

  it('rejects an unknown retry level', async () => {
    const channel = createRecordingChannel();
    const publisher = createPublisher({ channel, topology: createTopology() });

    await expect(publisher.publishRetry({ deliveryId, attempt: 1, level: '3m' })).rejects.toThrow(
      /Unknown retry level/,
    );
  });
});
