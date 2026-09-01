import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectMetrics } from '../../src/api/metrics/collect.js';
import { createPublishCounter } from '../../src/api/metrics/publish-counter.js';
import { DELIVERY_STATUS } from '../../src/shared/delivery-status.js';
import { newId } from '../../src/shared/ids.js';
import { assertTopology, createTopology } from '../../src/shared/queue/topology.js';
import { createDelivery, createEndpoint, createProject } from '../support/fixtures.js';
import { closeClients, openClients, silentLogger, startApi, testConfig } from '../support/stack.js';

const MAX_ATTEMPTS = 6;
const MAX_PAYLOAD_BYTES = 512;

const DOCUMENTED_METRICS = [
  'hooktracker_publish_requests_total',
  'hooktracker_deliveries_total',
  'hooktracker_delivery_attempts_total',
  'hooktracker_delivery_duration_seconds',
  'hooktracker_delivery_attempt_number',
  'hooktracker_queue_depth',
  'hooktracker_dlq_size',
  'hooktracker_endpoints_disabled_total',
];

const topology = createTopology({ namespace: 'itest-obs' });

let clients;
let prisma;
let server;
let baseUrl;
let project;
let endpoint;
let disabledEndpoint;

function parseSamples(text) {
  const samples = new Map();

  for (const line of text.split('\n')) {
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const boundary = line.lastIndexOf(' ');

    samples.set(line.slice(0, boundary), Number(line.slice(boundary + 1)));
  }

  return samples;
}

async function scrape() {
  const response = await fetch(`${baseUrl}/metrics`);
  const text = await response.text();

  return { response, text, samples: parseSamples(text) };
}

beforeAll(async () => {
  clients = await openClients();
  prisma = clients.prisma;

  await assertTopology(clients.queue.channel, topology);

  project = await createProject(prisma, 'itest-obs');

  endpoint = await createEndpoint(prisma, {
    projectId: project.id,
    url: 'http://receiver:4000/ok',
  });

  disabledEndpoint = await createEndpoint(prisma, {
    projectId: project.id,
    url: 'http://receiver:4000/fail-500',
    status: 'DISABLED',
  });

  const delivery = await createDelivery(prisma, {
    projectId: project.id,
    endpointId: endpoint.id,
    status: DELIVERY_STATUS.SUCCEEDED,
    attemptCount: 2,
  });

  await prisma.deliveryAttempt.createMany({
    data: [
      {
        id: newId('attempt'),
        deliveryId: delivery.id,
        attemptNumber: 1,
        responseStatus: 500,
        durationMs: 1200,
      },
      {
        id: newId('attempt'),
        deliveryId: delivery.id,
        attemptNumber: 2,
        responseStatus: 200,
        durationMs: 40,
      },
    ],
  });

  ({ server, baseUrl } = await startApi({
    clients,
    topology,
    config: testConfig({ MAX_ATTEMPTS, MAX_PAYLOAD_BYTES }),
    logger: silentLogger(),
  }));
});

afterAll(async () => {
  server?.close();

  await closeClients(clients);
});

describe('GET /metrics', () => {
  it('answers in the Prometheus exposition format with every documented family', async () => {
    const { response, text } = await scrape();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/);

    for (const name of DOCUMENTED_METRICS) {
      expect(text).toContain(`# HELP ${name} `);
      expect(text).toContain(`# TYPE ${name} `);
    }
  });

  it('reads the delivery figures the worker produced back out of Postgres', async () => {
    const { samples } = await scrape();

    expect(
      samples.get(`hooktracker_deliveries_total{status="${DELIVERY_STATUS.SUCCEEDED}"}`),
    ).toBeGreaterThanOrEqual(1);

    expect(
      samples.get('hooktracker_delivery_attempts_total{outcome="success",response_class="2xx"}'),
    ).toBeGreaterThanOrEqual(1);

    expect(
      samples.get('hooktracker_delivery_attempts_total{outcome="failure",response_class="5xx"}'),
    ).toBeGreaterThanOrEqual(1);

    expect(samples.get('hooktracker_endpoints_disabled_total')).toBeGreaterThanOrEqual(1);
  });

  it('closes each histogram with a +Inf bucket that matches its count', async () => {
    const { samples } = await scrape();

    for (const name of [
      'hooktracker_delivery_duration_seconds',
      'hooktracker_delivery_attempt_number',
    ]) {
      expect(samples.get(`${name}_count`)).toBeGreaterThanOrEqual(2);
      expect(samples.get(`${name}_bucket{le="+Inf"}`)).toBe(samples.get(`${name}_count`));
    }

    expect(samples.get('hooktracker_delivery_duration_seconds_sum')).toBeGreaterThan(0);
    expect(
      samples.get('hooktracker_delivery_attempt_number_bucket{le="1"}'),
    ).toBeGreaterThanOrEqual(1);
  });

  it('reads the queue depths from the broker under the names the topology declares', async () => {
    const { samples } = await scrape();

    expect(samples.has(`hooktracker_queue_depth{queue="${topology.deliveryQueue}"}`)).toBe(true);
    expect(samples.has(`hooktracker_queue_depth{queue="${topology.deadLetterQueue}"}`)).toBe(true);
    expect(samples.get('hooktracker_dlq_size')).toBeGreaterThanOrEqual(0);
  });

  it('counts publish requests that never reached the router, and keeps the ids out', async () => {
    await fetch(`${baseUrl}/v1/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventType: 'order.created', payload: { note: 'x'.repeat(1000) } }),
    });

    const { samples, text } = await scrape();

    expect(samples.get('hooktracker_publish_requests_total{result="rejected"}')).toBe(1);
    expect(samples.get('hooktracker_publish_requests_total{result="accepted"}')).toBe(0);
    expect(text).not.toContain(project.id);
    expect(text).not.toContain(endpoint.id);
    expect(text).not.toContain(disabledEndpoint.url);
  });

  it('omits the broker families rather than failing the scrape when the broker is unreachable', async () => {
    const families = await collectMetrics({
      prisma,
      connection: {
        createChannel() {
          throw new Error('broker unreachable');
        },
      },
      topology,
      publishCounter: createPublishCounter(),
      maxAttempts: MAX_ATTEMPTS,
    });

    const names = families.map((family) => family.name);

    expect(names).not.toContain('hooktracker_queue_depth');
    expect(names).toContain('hooktracker_deliveries_total');
  });
});

describe('GET /openapi.json and /docs', () => {
  it('serves a document that parses and carries the documented paths', async () => {
    const response = await fetch(`${baseUrl}/openapi.json`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);

    const document = JSON.parse(await response.text());

    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/v1/publish',
        '/v1/auth/login',
        '/v1/projects/{projectId}/deliveries',
        '/v1/deliveries/{deliveryId}/replay',
        '/metrics',
      ]),
    );

    expect(Object.keys(document.components.securitySchemes)).toEqual(['apiKey', 'userJwt']);
  });

  it('serves the UI and its assets from the installed package, with no external host', async () => {
    const page = await fetch(`${baseUrl}/docs`);
    const html = await page.text();

    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(html).toContain('swagger-ui-bundle.js');
    expect(html).not.toMatch(/https?:\/\//);

    const bundle = await fetch(`${baseUrl}/docs/swagger-ui-bundle.js`);

    expect(bundle.status).toBe(200);
    expect((await bundle.text()).length).toBeGreaterThan(0);
  });
});
