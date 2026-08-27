import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublisher } from '../../src/shared/queue/publisher.js';
import { RETRY_SCHEDULE } from '../../src/shared/retry.js';
import { assertTopology, createTopology } from '../../src/shared/queue/topology.js';
import { createRealtimePublisher } from '../../src/shared/realtime.js';
import { createTokenBucket } from '../../src/shared/token-bucket.js';
import { createDeliveryHandler } from '../../src/worker/handle-delivery.js';
import { recordInto } from '../support/consume.js';
import {
  createDelivery as createDeliveryRow,
  createEndpoint as createEndpointRow,
  createProject,
} from '../support/fixtures.js';
import { wait, waitFor } from '../support/poll.js';
import { closeClients, openClients, testConfig } from '../support/stack.js';

const RECEIVER_PORT = 4000;
const RECEIVER_URL = `http://localhost:${RECEIVER_PORT}`;
const RECEIVER_SECRET = 'whsec_test_receiver_secret';
const RETRY_DELAY_MS = 120;
const THROTTLE_DELAY_MS = 250;

// The real ladder's shape, collapsed to milliseconds. Deriving it from
// RETRY_SCHEDULE keeps the test exercising the levels the system actually has.
const schedule = RETRY_SCHEDULE.map((level) => ({ ...level, delayMs: RETRY_DELAY_MS }));

const topology = createTopology({
  namespace: 'itest-worker',
  schedule,
  throttleDelayMs: THROTTLE_DELAY_MS,
});

const handlerConfig = testConfig({
  MAX_ATTEMPTS: 6,
  DELIVERY_CONNECT_TIMEOUT_MS: 800,
  DELIVERY_TIMEOUT_MS: 1500,
  RESPONSE_SNIPPET_BYTES: 8192,
  SSRF_ALLOW_PRIVATE: false,
  SSRF_ALLOWLIST_HOSTS: ['localhost'],
  SSRF_BLOCKED_PORTS: [22, 5432],
  ENDPOINT_AUTO_DISABLE_THRESHOLD: 20,
  SECRET_ROTATION_GRACE_HOURS: 24,
});

let clients;
let receiver;
let prisma;
let queue;
let publisher;
let handler;
let project;
let consumerTag;

const deadLettered = [];
const realtimeEvents = [];

async function startConsumer() {
  const { consumerTag: tag } = await queue.channel.consume(
    topology.deliveryQueue,
    async (message) => {
      if (!message) {
        return;
      }

      try {
        await handler(JSON.parse(message.content.toString('utf8')));
      } finally {
        queue.channel.ack(message);
      }
    },
  );

  consumerTag = tag;
}

async function stopConsumer() {
  if (consumerTag) {
    await queue.channel.cancel(consumerTag);
    consumerTag = undefined;
  }
}

function createEndpoint({ url, rateLimitPerMinute = 600, status = 'ACTIVE' }) {
  return createEndpointRow(prisma, {
    projectId: project.id,
    url,
    status,
    rateLimitPerMinute,
    secret: RECEIVER_SECRET,
  });
}

function createDelivery(endpoint, payload = { orderId: 1234 }) {
  return createDeliveryRow(prisma, {
    projectId: project.id,
    endpointId: endpoint.id,
    payload,
  });
}

function loadDelivery(deliveryId) {
  return prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
  });
}

async function waitForStatus(deliveryId, status) {
  return waitFor(async () => {
    const delivery = await loadDelivery(deliveryId);

    return delivery.status === status ? delivery : null;
  });
}

async function receivedRequests() {
  const response = await fetch(`${RECEIVER_URL}/received`);

  return response.json();
}

beforeAll(async () => {
  clients = await openClients({ subscriber: true });
  prisma = clients.prisma;
  queue = clients.queue;

  await clients.subscriber.psubscribe('realtime:*');
  clients.subscriber.on('pmessage', (_pattern, channel, payload) => {
    realtimeEvents.push({ channel, ...JSON.parse(payload) });
  });

  await assertTopology(queue.channel, topology);
  await recordInto(queue.channel, topology.deadLetterQueue, deadLettered);

  // The real receiver, not a stand-in: the routes under test are the ones a
  // fresh clone gets, and it verifies the signature with the same secret.
  receiver = spawn(process.execPath, ['src/demo-receiver/server.js'], {
    env: { ...process.env, DEMO_ENDPOINT_SECRET: RECEIVER_SECRET, LOG_LEVEL: 'silent' },
    stdio: 'ignore',
  });

  await waitFor(async () => {
    try {
      const response = await fetch(`${RECEIVER_URL}/health`);

      return response.ok;
    } catch {
      return false;
    }
  });

  project = await createProject(prisma, 'itest-worker');

  publisher = createPublisher({ channel: queue.channel, topology });

  handler = createDeliveryHandler({
    prisma,
    publisher,
    realtime: createRealtimePublisher({ redis: clients.redis }),
    tokenBucket: createTokenBucket({ redis: clients.redis }),
    config: handlerConfig,
    schedule,
  });

  await startConsumer();
});

afterAll(async () => {
  await stopConsumer();

  receiver?.kill();

  await closeClients(clients);
});

describe('successful delivery', () => {
  it('succeeds on the first attempt and records one signed attempt', async () => {
    const endpoint = await createEndpoint({ url: `${RECEIVER_URL}/ok` });
    const created = await createDelivery(endpoint, { orderId: 4242 });

    await publisher.publishDelivery({ deliveryId: created.id, attempt: 1 });

    const delivery = await waitForStatus(created.id, 'SUCCEEDED');

    expect(delivery.attemptCount).toBe(1);
    expect(delivery.attempts).toHaveLength(1);
    expect(delivery.attempts[0].responseStatus).toBe(200);
    expect(delivery.attempts[0].responseHeaders['content-type']).toContain('application/json');
    expect(delivery.completedAt).not.toBeNull();

    const received = await receivedRequests();
    const request = received.requests.find((entry) => entry.webhookId === created.id);

    expect(request.signatureValid).toBe(true);
    expect(request.eventType).toBe('order.created');
    expect(request.attempt).toBe(1);
    expect(request.body).toEqual({ orderId: 4242 });

    const after = await prisma.endpoint.findUnique({ where: { id: endpoint.id } });

    expect(after.consecutiveFailures).toBe(0);

    expect(
      realtimeEvents.some(
        (entry) => entry.event === 'delivery.succeeded' && entry.payload.deliveryId === created.id,
      ),
    ).toBe(true);
  });
});

describe('retry ladder', () => {
  it('walks a 500 through every level and lands in the dlq with six attempts', async () => {
    const endpoint = await createEndpoint({ url: `${RECEIVER_URL}/fail-500` });
    const created = await createDelivery(endpoint);

    await publisher.publishDelivery({ deliveryId: created.id, attempt: 1 });

    const delivery = await waitForStatus(created.id, 'FAILED_PERMANENTLY');

    expect(delivery.attemptCount).toBe(6);
    expect(delivery.attempts).toHaveLength(6);
    expect(delivery.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(delivery.attempts.every((attempt) => attempt.responseStatus === 500)).toBe(true);
    expect(delivery.lastError).toBe('HTTP 500');

    await waitFor(() => deadLettered.some((entry) => entry.deliveryId === created.id));

    expect(
      realtimeEvents.some(
        (entry) =>
          entry.event === 'delivery.failed' &&
          entry.payload.deliveryId === created.id &&
          entry.payload.reason === 'EXHAUSTED',
      ),
    ).toBe(true);
  });

  it('times out a slow endpoint and retries it', async () => {
    // Only this test needs a budget shorter than the receiver's delay.
    handlerConfig.DELIVERY_TIMEOUT_MS = 300;

    try {
      const endpoint = await createEndpoint({ url: `${RECEIVER_URL}/slow?ms=800` });
      const created = await createDelivery(endpoint);

      await publisher.publishDelivery({ deliveryId: created.id, attempt: 1 });

      const delivery = await waitForStatus(created.id, 'FAILED_PERMANENTLY');

      expect(delivery.attempts).toHaveLength(6);
      expect(delivery.attempts.every((attempt) => attempt.errorCode === 'TIMEOUT')).toBe(true);
      expect(delivery.attempts[0].responseStatus).toBeNull();
      expect(delivery.attempts[0].durationMs).toBeGreaterThanOrEqual(200);
    } finally {
      handlerConfig.DELIVERY_TIMEOUT_MS = 1500;
    }
  });
});

describe('ssrf guard', () => {
  it('refuses a link-local target without issuing a request', async () => {
    const endpoint = await createEndpoint({ url: 'http://169.254.169.254/latest/meta-data' });
    const created = await createDelivery(endpoint);
    const before = (await receivedRequests()).count;

    await publisher.publishDelivery({ deliveryId: created.id, attempt: 1 });

    const delivery = await waitForStatus(created.id, 'FAILED_PERMANENTLY');

    expect(delivery.attempts).toHaveLength(1);
    expect(delivery.attempts[0].errorCode).toBe('SSRF_BLOCKED');
    expect(delivery.attempts[0].responseStatus).toBeNull();
    expect((await receivedRequests()).count).toBe(before);
  });
});

describe('at-least-once delivery', () => {
  it('redelivers a message the worker never acked, without losing or duplicating the audit row', async () => {
    await stopConsumer();

    const endpoint = await createEndpoint({ url: `${RECEIVER_URL}/ok` });
    const created = await createDelivery(endpoint);

    await publisher.publishDelivery({ deliveryId: created.id, attempt: 1 });

    // A worker that dies before acking: the message is taken, never acked, and
    // the broker hands it back when the channel goes away.
    const crashing = await queue.connection.createChannel();
    const taken = await waitFor(() => crashing.get(topology.deliveryQueue, { noAck: false }));

    expect(JSON.parse(taken.content.toString('utf8')).deliveryId).toBe(created.id);

    await crashing.close();
    await startConsumer();

    const delivery = await waitForStatus(created.id, 'SUCCEEDED');

    expect(delivery.attempts).toHaveLength(1);

    // The same message arriving a second time after the commit must not add a
    // second attempt row.
    await publisher.publishDelivery({ deliveryId: created.id, attempt: 1 });
    await wait(300);

    const afterDuplicate = await loadDelivery(created.id);

    expect(afterDuplicate.attempts).toHaveLength(1);
  });
});

describe('endpoint rate limit', () => {
  it('parks a delivery over the endpoint budget without counting it as an attempt', async () => {
    const endpoint = await createEndpoint({ url: `${RECEIVER_URL}/ok`, rateLimitPerMinute: 1 });
    const first = await createDelivery(endpoint);
    const second = await createDelivery(endpoint);

    await publisher.publishDelivery({ deliveryId: first.id, attempt: 1 });
    await publisher.publishDelivery({ deliveryId: second.id, attempt: 1 });

    const firstResult = await waitForStatus(first.id, 'SUCCEEDED');

    expect(firstResult.attempts).toHaveLength(1);

    // The endpoint's minute budget is spent, so the second delivery keeps
    // bouncing off the throttle queue. Several cycles later it still has no
    // attempt row and no raised attempt count.
    await wait(THROTTLE_DELAY_MS * 3);

    const parked = await loadDelivery(second.id);

    expect(parked.attempts).toHaveLength(0);
    expect(parked.attemptCount).toBe(0);
    expect(parked.status).toBe('PENDING');

    // Raising the endpoint's limit is the operator's fix, and the parked
    // delivery goes out on its next cycle without having burned an attempt.
    await prisma.endpoint.update({
      where: { id: endpoint.id },
      data: { rateLimitPerMinute: 600 },
    });

    const secondResult = await waitForStatus(second.id, 'SUCCEEDED');

    expect(secondResult.attempts).toHaveLength(1);
    expect(secondResult.attempts[0].attemptNumber).toBe(1);
  });
});

describe('endpoint health', () => {
  it('disables an endpoint that reaches the consecutive failure threshold', async () => {
    handlerConfig.ENDPOINT_AUTO_DISABLE_THRESHOLD = 1;

    try {
      const endpoint = await createEndpoint({ url: `${RECEIVER_URL}/unknown-route` });
      const created = await createDelivery(endpoint);

      await publisher.publishDelivery({ deliveryId: created.id, attempt: 1 });

      const delivery = await waitForStatus(created.id, 'FAILED_PERMANENTLY');

      expect(delivery.attempts).toHaveLength(1);
      expect(delivery.attempts[0].responseStatus).toBe(404);

      const after = await prisma.endpoint.findUnique({ where: { id: endpoint.id } });

      expect(after.status).toBe('DISABLED');
      expect(after.consecutiveFailures).toBe(1);

      expect(
        realtimeEvents.some(
          (entry) =>
            entry.event === 'endpoint.disabled' && entry.payload.endpointId === endpoint.id,
        ),
      ).toBe(true);
    } finally {
      handlerConfig.ENDPOINT_AUTO_DISABLE_THRESHOLD = 20;
    }
  });
});
