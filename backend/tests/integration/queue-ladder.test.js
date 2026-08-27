import { GenericContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/shared/ids.js';
import {
  closeQuietly,
  connectWithRetry,
  createConfirmChannel,
} from '../../src/shared/queue/connection.js';
import { createPublisher } from '../../src/shared/queue/publisher.js';
import { allQueueNames, assertTopology, createTopology } from '../../src/shared/queue/topology.js';

const RETRY_DELAY_MS = 400;
const THROTTLE_DELAY_MS = 300;

// The real ladder starts at one minute. The schedule is injected so the same
// code path can be observed in milliseconds, and the namespace keeps these
// queues away from the ones a developer's stack already declared.
const topology = createTopology({
  namespace: 'itest',
  schedule: [{ level: '1m', delayMs: RETRY_DELAY_MS }],
  throttleDelayMs: THROTTLE_DELAY_MS,
});

let container;
let connection;
let channel;

// Each waiter cancels its consumer once it has its message. Leaving consumers
// attached would let an earlier test's consumer win the round-robin and take a
// later test's message.
async function startWaiting(queue) {
  let resolveMessage;

  const message = new Promise((resolve) => {
    resolveMessage = resolve;
  });

  const { consumerTag } = await channel.consume(
    queue,
    (delivered) => {
      if (!delivered) {
        return;
      }

      channel.ack(delivered);
      resolveMessage({ body: JSON.parse(delivered.content.toString('utf8')), at: Date.now() });
    },
    { noAck: false },
  );

  return {
    async received() {
      const result = await message;

      await channel.cancel(consumerTag);

      return result;
    },
  };
}

beforeAll(async () => {
  container = await new GenericContainer('rabbitmq:4-management-alpine')
    .withExposedPorts(5672)
    .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
    .withStartupTimeout(180_000)
    .start();

  const url = `amqp://guest:guest@${container.getHost()}:${container.getMappedPort(5672)}`;

  connection = await connectWithRetry({ url, attempts: 10, baseDelayMs: 250 });
  channel = await createConfirmChannel(connection);

  await assertTopology(channel, topology);
});

afterAll(async () => {
  await closeQuietly(channel);
  await closeQuietly(connection);
  await container?.stop();
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
    const waiter = await startWaiting(topology.deliveryQueue);
    const publishedAt = Date.now();

    await publisher.publishRetry({ deliveryId, attempt: 2, level: '1m' });

    const received = await waiter.received();

    expect(received.body).toEqual({ deliveryId, attempt: 2 });
    expect(received.at - publishedAt).toBeGreaterThanOrEqual(RETRY_DELAY_MS * 0.8);
  });

  it('returns a throttled message to the delivery queue without changing its attempt number', async () => {
    const publisher = createPublisher({ channel, topology });
    const deliveryId = newId('delivery');
    const waiter = await startWaiting(topology.deliveryQueue);

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
  });
});
