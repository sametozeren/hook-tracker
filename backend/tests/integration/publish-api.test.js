import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/api/app.js';
import { generateApiKey } from '../../src/shared/crypto.js';
import { newId } from '../../src/shared/ids.js';
import { createPublisher } from '../../src/shared/queue/publisher.js';
import { assertTopology, createTopology } from '../../src/shared/queue/topology.js';
import { recordInto } from '../support/consume.js';
import { createEndpoint, createProject } from '../support/fixtures.js';
import { waitFor } from '../support/poll.js';
import { closeClients, openClients, silentLogger, testConfig } from '../support/stack.js';

const RATE_LIMIT = 5;
const MAX_PAYLOAD_BYTES = 4096;

const topology = createTopology({ namespace: 'itest-api' });

let clients;
let prisma;
let server;
let baseUrl;
let project;
let activeEndpoint;
let disabledEndpoint;
let foreignEndpoint;
let apiKey;

const queued = [];

async function publish(body, { key = apiKey, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}/v1/publish`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  const text = await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: text.length > 0 ? JSON.parse(text) : null,
  };
}

async function createApiKeyRow(name) {
  const { plaintext, keyPrefix, keyHash } = generateApiKey();

  await prisma.apiKey.create({
    data: { id: newId('apiKey'), projectId: project.id, name, keyPrefix, keyHash },
  });

  return plaintext;
}

beforeAll(async () => {
  clients = await openClients();
  prisma = clients.prisma;

  await assertTopology(clients.queue.channel, topology);
  await recordInto(clients.queue.channel, topology.deliveryQueue, queued);

  project = await createProject(prisma, 'itest-api');

  const otherProject = await createProject(prisma, 'itest-api-other');

  activeEndpoint = await createEndpoint(prisma, {
    projectId: project.id,
    url: 'http://receiver:4000/ok',
    eventTypes: ['order.*'],
  });

  disabledEndpoint = await createEndpoint(prisma, {
    projectId: project.id,
    url: 'http://receiver:4000/fail-500',
    eventTypes: ['order.*'],
    status: 'DISABLED',
  });

  foreignEndpoint = await createEndpoint(prisma, {
    projectId: otherProject.id,
    url: 'http://receiver:4000/ok',
  });

  const app = createApp({
    prisma,
    redis: clients.redis,
    publisher: createPublisher({ channel: clients.queue.channel, topology }),
    connection: clients.queue.connection,
    logger: silentLogger(),
    config: testConfig({
      RATE_LIMIT_PUBLISH_PER_MINUTE: RATE_LIMIT,
      MAX_PAYLOAD_BYTES,
    }),
  });

  server = app.listen(0);

  await new Promise((resolve) => {
    server.once('listening', resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

// The limiter counts per API key, so every test gets its own and one test's
// traffic cannot push another test over the threshold.
beforeEach(async () => {
  apiKey = await createApiKeyRow('per-test');
});

afterAll(async () => {
  server?.close();

  await closeClients(clients);
});

describe('POST /v1/publish', () => {
  it('accepts an event, writes the rows and queues one message per active endpoint', async () => {
    const response = await publish({
      eventType: 'order.created',
      payload: { orderId: 1234, total: 99.9 },
    });

    expect(response.status).toBe(202);
    expect(response.body.eventId).toMatch(/^evt_/);

    const byEndpoint = Object.fromEntries(
      response.body.deliveries.map((delivery) => [delivery.endpointId, delivery]),
    );

    expect(byEndpoint[activeEndpoint.id].status).toBe('PENDING');
    expect(byEndpoint[disabledEndpoint.id].status).toBe('SKIPPED');

    const event = await prisma.webhookEvent.findUnique({
      where: { id: response.body.eventId },
      include: { deliveries: true },
    });

    expect(event.eventType).toBe('order.created');
    expect(event.payload).toEqual({ orderId: 1234, total: 99.9 });
    expect(event.deliveries).toHaveLength(2);

    const pending = byEndpoint[activeEndpoint.id];
    const message = await waitFor(() => queued.find((entry) => entry.deliveryId === pending.id));

    expect(message).toEqual({ deliveryId: pending.id, attempt: 1 });
    expect(queued.some((entry) => entry.deliveryId === byEndpoint[disabledEndpoint.id].id)).toBe(
      false,
    );
  });

  it('replays the original response for a repeated Idempotency-Key without creating deliveries', async () => {
    const request = { eventType: 'order.paid', payload: { orderId: 7 } };
    const headers = { 'idempotency-key': `key-${Date.now()}` };

    const first = await publish(request, { headers });
    const before = await prisma.delivery.count({ where: { event: { projectId: project.id } } });
    const second = await publish(request, { headers });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body).toEqual(first.body);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(await prisma.delivery.count({ where: { event: { projectId: project.id } } })).toBe(
      before,
    );
  });

  it('refuses an event type that nothing subscribes to', async () => {
    const response = await publish({ eventType: 'invoice.paid', payload: {} });

    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(response.body.type).toBe('urn:hook-tracker:error:unprocessable');
    expect(response.body.requestId).toBeTruthy();
  });

  it('refuses an endpoint id from another project without revealing that it exists', async () => {
    const response = await publish({
      eventType: 'order.created',
      payload: {},
      endpointIds: [foreignEndpoint.id],
    });

    expect(response.status).toBe(422);
    expect(response.body.detail).not.toContain(foreignEndpoint.id);
  });

  it('rejects a malformed body with the zod issue list', async () => {
    const response = await publish({ eventType: 'Order.Created', payload: {} });

    expect(response.status).toBe(400);
    expect(response.body.errors[0].path).toBe('eventType');
  });

  it('rejects an unknown api key', async () => {
    const response = await publish(
      { eventType: 'order.created', payload: {} },
      { key: 'ht_not_a_real_key_value_here' },
    );

    expect(response.status).toBe(401);
    expect(response.body.type).toBe('urn:hook-tracker:error:unauthorized');
  });

  it('rejects a payload above MAX_PAYLOAD_BYTES', async () => {
    const response = await publish({
      eventType: 'order.created',
      payload: { blob: 'x'.repeat(MAX_PAYLOAD_BYTES) },
    });

    expect(response.status).toBe(413);
    expect(response.body.type).toBe('urn:hook-tracker:error:payload-too-large');
  });

  it('rate limits past the configured threshold and reports when to retry', async () => {
    const responses = [];

    for (let attempt = 1; attempt <= RATE_LIMIT + 1; attempt += 1) {
      responses.push(
        await publish(
          { eventType: 'order.created', payload: { attempt } },
          { headers: { 'idempotency-key': `rate-${attempt}-${Date.now()}` } },
        ),
      );
    }

    const accepted = responses.slice(0, RATE_LIMIT);
    const limited = responses.at(-1);

    expect(accepted.every((response) => response.status === 202)).toBe(true);
    expect(limited.status).toBe(429);
    expect(limited.body.type).toBe('urn:hook-tracker:error:rate-limited');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(limited.headers.get('ratelimit-limit')).toBe(String(RATE_LIMIT));
    expect(limited.headers.get('ratelimit-remaining')).toBe('0');
    expect(accepted[0].headers.get('ratelimit-remaining')).toBe(String(RATE_LIMIT - 1));
  });
});

describe('GET /ready', () => {
  it('reports every dependency it needs', async () => {
    const response = await fetch(`${baseUrl}/ready`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.checks.map((check) => check.name).sort()).toEqual([
      'postgres',
      'rabbitmq',
      'redis',
    ]);
  });
});
