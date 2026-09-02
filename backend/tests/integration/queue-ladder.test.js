import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/shared/ids.js';
import { DEFAULT_DEAD_LETTER_TTL_MS, createPublisher } from '../../src/shared/queue/publisher.js';
import { allQueueNames, assertTopology, createTopology } from '../../src/shared/queue/topology.js';
import { waitForMessage } from '../support/consume.js';
import { waitFor } from '../support/poll.js';
import { closeClients, openClients } from '../support/stack.js';

const RETRY_DELAY_MS = 400;
const THROTTLE_DELAY_MS = 300;

// The real dead-letter expiry is a day. It is injected here so the same code
// path is observable in milliseconds.
const DEAD_LETTER_TTL_MS = 400;

// The real ladder starts at one minute. The schedule is injected so the same
// code path can be observed in milliseconds, and the namespace keeps these
// queues away from the ones a developer's stack already declared.
const topology = createTopology({
  namespace: 'itest',
  schedule: [{ level: '1m', delayMs: RETRY_DELAY_MS }],
  throttleDelayMs: THROTTLE_DELAY_MS,
});

let clients;
let channel;

beforeAll(async () => {
  clients = await openClients();
  channel = clients.queue.channel;

  await assertTopology(channel, topology);
});

afterAll(async () => {
  await closeClients(clients);
});

describe('queue topology', () => {
  it('declares every object and asserts the same topology again on a second startup', async () => {
    await assertTopology(channel, topology);

    for (const queue of allQueueNames(topology)) {
      const info = await channel.checkQueue(queue);

      expect(info.queue).toBe(queue);
    }
  });
});

describe('retry ladder', () => {
  it('returns a message from a retry queue to the delivery queue once its ttl expires', async () => {
    const publisher = createPublisher({ channel, topology, random: () => 0 });
    const deliveryId = newId('delivery');
    const waiter = await waitForMessage(channel, topology.deliveryQueue);
    const publishedAt = Date.now();

    await publisher.publishRetry({ deliveryId, attempt: 2, level: '1m' });

    const received = await waiter.received();

    expect(received.body).toEqual({ deliveryId, attempt: 2 });
    expect(received.at - publishedAt).toBeGreaterThanOrEqual(RETRY_DELAY_MS * 0.8);
  });

  it('returns a throttled message to the delivery queue without changing its attempt number', async () => {
    const publisher = createPublisher({ channel, topology });
    const deliveryId = newId('delivery');
    const waiter = await waitForMessage(channel, topology.deliveryQueue);

    await publisher.publishThrottle({ deliveryId, attempt: 4 });

    const received = await waiter.received();

    expect(received.body).toEqual({ deliveryId, attempt: 4 });
  });

  it('leaves a terminal failure sitting in the dlq, where nothing consumes it', async () => {
    const publisher = createPublisher({ channel, topology });
    const deliveryId = newId('delivery');

    await publisher.publishDeadLetter({ deliveryId, attempt: 6 });

    const message = await channel.get(topology.deadLetterQueue, { noAck: true });

    expect(JSON.parse(message.content.toString('utf8'))).toEqual({ deliveryId, attempt: 6 });
    expect(message.properties.expiration).toBe(String(DEFAULT_DEAD_LETTER_TTL_MS));
  });

  it('drops a dead-lettered message once its expiry elapses, with nothing consuming the queue', async () => {
    const publisher = createPublisher({ channel, topology, deadLetterTtlMs: DEAD_LETTER_TTL_MS });
    const deliveryId = newId('delivery');

    await publisher.publishDeadLetter({ deliveryId, attempt: 6 });

    await waitFor(async () => {
      const message = await channel.get(topology.deadLetterQueue, { noAck: true });

      return message === false;
    });
  });
});
