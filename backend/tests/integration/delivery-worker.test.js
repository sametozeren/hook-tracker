import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { GenericContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../../src/shared/config.js';
import { encryptSecret } from '../../src/shared/crypto.js';
import { createPrismaClient } from '../../src/shared/db.js';
import { newId } from '../../src/shared/ids.js';
import { closeQuietly, createQueueConnection } from '../../src/shared/queue/connection.js';
import { createPublisher } from '../../src/shared/queue/publisher.js';
import { assertTopology, createTopology } from '../../src/shared/queue/topology.js';
import { createRealtimePublisher } from '../../src/shared/realtime.js';
import { createRedisClient } from '../../src/shared/redis.js';
import { createTokenBucket } from '../../src/shared/token-bucket.js';
import { createDeliveryHandler } from '../../src/worker/handle-delivery.js';

const run = promisify(execFile);

const RECEIVER_PORT = 4000;
const RECEIVER_URL = `http://localhost:${RECEIVER_PORT}`;
const RECEIVER_SECRET = 'whsec_test_receiver_secret';
const RETRY_DELAY_MS = 120;
const THROTTLE_DELAY_MS = 250;

// Five levels, milliseconds apart: the same ladder the production schedule
// describes, collapsed so a full run to the DLQ finishes inside a test.
const schedule = ['1m', '5m', '30m', '2h', '6h'].map((level) => ({
  level,
  delayMs: RETRY_DELAY_MS,
}));

const topology = createTopology({
  namespace: 'itest-worker',
  schedule,
  throttleDelayMs: THROTTLE_DELAY_MS,
});

const handlerConfig = {
  ...config,
  MAX_ATTEMPTS: 6,
  DELIVERY_CONNECT_TIMEOUT_MS: 200,
  DELIVERY_TIMEOUT_MS: 250,
  RESPONSE_SNIPPET_BYTES: 8192,
  SSRF_ALLOW_PRIVATE: false,
  SSRF_ALLOWLIST_HOSTS: ['localhost'],
  SSRF_BLOCKED_PORTS: [22, 5432],
  ENDPOINT_AUTO_DISABLE_THRESHOLD: 20,
  SECRET_ROTATION_GRACE_HOURS: 24,
};

let containers = [];
let receiver;
let prisma;
let redis;
let subscriber;
let queue;
let publisher;
let handler;
let project;
let consumerTag;

const deadLettered = [];
const realtimeEvents = [];

async function wait(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(probe, { timeoutMs = 15_000, intervalMs = 30 } = {}) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await probe();

    if (result) {
      return result;
    }

    if (Date.now() > deadline) {
      throw new Error('condition was not met before the timeout');
    }

    await wait(intervalMs);
  }
}

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

async function createEndpoint({ url, rateLimitPerMinute = 600, status = 'ACTIVE' }) {
  return prisma.endpoint.create({
    data: {
      id: newId('endpoint'),
      projectId: project.id,
      url,
      status,
      rateLimitPerMinute,
      secret: encryptSecret(RECEIVER_SECRET),
      eventTypes: [],
    },
  });
}

async function createDelivery(endpoint, payload = { orderId: 1234 }) {
  const event = await prisma.webhookEvent.create({
    data: {
      id: newId('event'),
      projectId: project.id,
      eventType: 'order.created',
      payload,
      idempotencyKey: newId('event'),
    },
  });

  return prisma.delivery.create({
    data: { id: newId('delivery'), eventId: event.id, endpointId: endpoint.id },
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
  const [postgres, redisContainer, rabbitmq] = await Promise.all([
    new GenericContainer('postgres:17-alpine')
      .withEnvironment({
        POSTGRES_USER: 'hooktracker',
        POSTGRES_PASSWORD: 'hooktracker',
        POSTGRES_DB: 'hooktracker',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(180_000)
      .start(),
    new GenericContainer('redis:8-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .withStartupTimeout(180_000)
      .start(),
    new GenericContainer('rabbitmq:4-management-alpine')
      .withExposedPorts(5672)
      .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
      .withStartupTimeout(180_000)
      .start(),
  ]);

  containers = [postgres, redisContainer, rabbitmq];

  const databaseUrl = `postgresql://hooktracker:hooktracker@${postgres.getHost()}:${postgres.getMappedPort(5432)}/hooktracker?schema=public`;

  await run('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: true,
  });

  prisma = createPrismaClient({ connectionString: databaseUrl });

  const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

  redis = createRedisClient({ url: redisUrl });
  subscriber = createRedisClient({ url: redisUrl });

  await subscriber.psubscribe('realtime:*');
  subscriber.on('pmessage', (_pattern, channel, payload) => {
    realtimeEvents.push({ channel, ...JSON.parse(payload) });
  });

  queue = await createQueueConnection({
    url: `amqp://guest:guest@${rabbitmq.getHost()}:${rabbitmq.getMappedPort(5672)}`,
    attempts: 10,
    baseDelayMs: 250,
  });

  await assertTopology(queue.channel, topology);
  await queue.channel.consume(topology.deadLetterQueue, (message) => {
    if (!message) {
      return;
    }

    queue.channel.ack(message);
    deadLettered.push(JSON.parse(message.content.toString('utf8')));
  });

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

  project = await prisma.project.create({
    data: { id: newId('project'), name: 'Worker Project', slug: `worker-${Date.now()}` },
  });

  publisher = createPublisher({ channel: queue.channel, topology });

  handler = createDeliveryHandler({
    prisma,
    publisher,
    realtime: createRealtimePublisher({ redis }),
    tokenBucket: createTokenBucket({ redis }),
    config: handlerConfig,
    schedule,
  });

  await startConsumer();
});

afterAll(async () => {
  await stopConsumer();

  receiver?.kill();

  await closeQuietly(queue?.channel);
  await closeQuietly(queue?.connection);
  await subscriber?.quit();
  await redis?.quit();
  await prisma?.$disconnect();
  await Promise.all(containers.map((container) => container.stop()));
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
    const endpoint = await createEndpoint({ url: `${RECEIVER_URL}/slow?ms=800` });
    const created = await createDelivery(endpoint);

    await publisher.publishDelivery({ deliveryId: created.id, attempt: 1 });

    const delivery = await waitForStatus(created.id, 'FAILED_PERMANENTLY');

    expect(delivery.attempts).toHaveLength(6);
    expect(delivery.attempts.every((attempt) => attempt.errorCode === 'TIMEOUT')).toBe(true);
    expect(delivery.attempts[0].responseStatus).toBeNull();
    expect(delivery.attempts[0].durationMs).toBeGreaterThanOrEqual(200);
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
