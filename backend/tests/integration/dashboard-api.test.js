import jwt from 'jsonwebtoken';
import { io as connectSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachRealtime } from '../../src/api/realtime/socket.js';
import { REFRESH_COOKIE } from '../../src/api/routes/auth.js';
import { assertTopology, createTopology } from '../../src/shared/queue/topology.js';
import { createRealtimePublisher } from '../../src/shared/realtime.js';
import { newId } from '../../src/shared/ids.js';
import { createEvent } from '../support/fixtures.js';
import { wait } from '../support/poll.js';
import {
  closeClients,
  openClients,
  readJson,
  silentLogger,
  startApi,
  testConfig,
} from '../support/stack.js';

const topology = createTopology({ namespace: 'itest-dashboard' });

const logger = silentLogger();

let clients;
let prisma;
let queue;
let realtime;
let server;
let baseUrl;
let alice;
let bob;
let endpoint;

const appConfig = testConfig({
  SSRF_ALLOWLIST_HOSTS: ['localhost'],
  REALTIME_MAX_EVENTS_PER_SECOND: 50,
});

async function call(method, path, { token, body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    status: response.status,
    headers: response.headers,
    cookies: response.headers.getSetCookie(),
    body: await readJson(response),
  };
}

function refreshCookieOf(response) {
  const raw = response.cookies.find((value) => value.startsWith(`${REFRESH_COOKIE}=`));

  return raw ? raw.split(';')[0] : undefined;
}

async function register(email, projectName) {
  const response = await call('POST', '/v1/auth/register', {
    body: { email, password: 'a-long-enough-password', name: email.split('@')[0], projectName },
  });

  return {
    ...response.body,
    token: response.body.accessToken,
    cookie: refreshCookieOf(response),
    raw: response,
  };
}

async function openSocket(token) {
  const socket = connectSocket(`${baseUrl}/realtime`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });

  const received = [];

  socket.onAny((event, payload) => received.push({ event, payload }));

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

  return { socket, received };
}

beforeAll(async () => {
  clients = await openClients();
  prisma = clients.prisma;
  queue = clients.queue;

  await assertTopology(queue.channel, topology);

  ({ server, baseUrl } = await startApi({
    clients,
    topology,
    config: appConfig,
    logger,
  }));

  realtime = attachRealtime({ server, prisma, redis: clients.redis, config: appConfig, logger });

  alice = await register('alice@hook-tracker.test', 'Alice Project');
  bob = await register('bob@hook-tracker.test', 'Bob Project');
});

afterAll(async () => {
  await realtime?.close();

  server?.close();

  await closeClients(clients);
});

describe('authentication', () => {
  it('registers a user with a project and makes them its owner', async () => {
    expect(alice.raw.status).toBe(201);
    expect(alice.accessToken).toBeTruthy();
    expect(alice.project.id).toMatch(/^prj_/);

    const cookie = alice.raw.cookies.find((value) => value.startsWith(`${REFRESH_COOKIE}=`));

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/v1/auth');

    const me = await call('GET', '/v1/auth/me', { token: alice.token });

    expect(me.body.email).toBe('alice@hook-tracker.test');
    expect(me.body.memberships).toEqual([
      expect.objectContaining({
        role: 'OWNER',
        project: expect.objectContaining({ id: alice.project.id }),
      }),
    ]);
  });

  it('refuses a second account with the same email', async () => {
    const response = await call('POST', '/v1/auth/register', {
      body: {
        email: 'alice@hook-tracker.test',
        password: 'a-long-enough-password',
        name: 'Alice',
        projectName: 'Another',
      },
    });

    expect(response.status).toBe(409);
  });

  it('answers a wrong password and an unknown account identically', async () => {
    const wrongPassword = await call('POST', '/v1/auth/login', {
      body: { email: 'alice@hook-tracker.test', password: 'not-the-password' },
    });

    const unknownAccount = await call('POST', '/v1/auth/login', {
      body: { email: 'nobody@hook-tracker.test', password: 'not-the-password' },
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(wrongPassword.body.detail).toBe(unknownAccount.body.detail);
  });

  it('rotates the refresh token and refuses the one that was just used', async () => {
    const login = await call('POST', '/v1/auth/login', {
      body: { email: 'bob@hook-tracker.test', password: 'a-long-enough-password' },
    });

    const first = refreshCookieOf(login);
    const refreshed = await call('POST', '/v1/auth/refresh', { cookie: first });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();

    const replayed = await call('POST', '/v1/auth/refresh', { cookie: first });

    expect(replayed.status).toBe(401);

    const second = refreshCookieOf(refreshed);
    const loggedOut = await call('POST', '/v1/auth/logout', { cookie: second });

    expect(loggedOut.status).toBe(204);
    expect((await call('POST', '/v1/auth/refresh', { cookie: second })).status).toBe(401);
  });

  it('rejects a request with no access token', async () => {
    expect((await call('GET', '/v1/auth/me')).status).toBe(401);
  });
});

describe('project settings', () => {
  it('stores an alert address and clears it again', async () => {
    const saved = await call('PATCH', `/v1/projects/${alice.project.id}`, {
      token: alice.token,
      body: { alertWebhookUrl: 'http://localhost:4000/ok' },
    });

    expect(saved.status).toBe(200);
    expect(saved.body.alertWebhookUrl).toBe('http://localhost:4000/ok');
    expect(saved.body.name).toBe(alice.project.name);

    const cleared = await call('PATCH', `/v1/projects/${alice.project.id}`, {
      token: alice.token,
      body: { alertWebhookUrl: null },
    });

    expect(cleared.body.alertWebhookUrl).toBeNull();
  });

  it('refuses an alert address the delivery pipeline would refuse', async () => {
    const response = await call('PATCH', `/v1/projects/${alice.project.id}`, {
      token: alice.token,
      body: { alertWebhookUrl: 'http://127.0.0.1:9/hook' },
    });

    expect(response.status).toBe(422);
    expect(response.body.detail).toContain('not an allowed alert target');
  });
});

describe('endpoints', () => {
  it('creates an endpoint and returns its signing secret exactly once', async () => {
    const response = await call('POST', `/v1/projects/${alice.project.id}/endpoints`, {
      token: alice.token,
      body: { url: 'http://localhost:4000/ok', description: 'demo receiver', eventTypes: [] },
    });

    expect(response.status).toBe(201);
    expect(response.body.secret).toMatch(/^whsec_/);

    endpoint = response.body;

    const list = await call('GET', `/v1/projects/${alice.project.id}/endpoints`, {
      token: alice.token,
    });

    expect(list.body.endpoints[0].id).toBe(endpoint.id);
    expect(list.body.endpoints[0].secret).toBeUndefined();
  });

  // An empty eventTypes list subscribes to every event, so this endpoint is
  // removed again: left behind, it would join the fan-out of every later test.
  it('leaves eventTypes alone when an update does not mention it', async () => {
    const created = await call('POST', `/v1/projects/${alice.project.id}/endpoints`, {
      token: alice.token,
      body: { url: 'http://localhost:4000/ok', eventTypes: ['refactor.probe'] },
    });

    const updated = await call('PATCH', `/v1/endpoints/${created.body.id}`, {
      token: alice.token,
      body: { description: 'renamed, subscriptions untouched' },
    });

    expect(updated.status).toBe(200);
    expect(updated.body.eventTypes).toEqual(['refactor.probe']);

    const cleared = await call('PATCH', `/v1/endpoints/${created.body.id}`, {
      token: alice.token,
      body: { eventTypes: [] },
    });

    expect(cleared.body.eventTypes).toEqual([]);

    const removed = await call('DELETE', `/v1/endpoints/${created.body.id}`, {
      token: alice.token,
    });

    expect(removed.status).toBe(204);
  });

  it('refuses a URL the SSRF guard would block, at configuration time', async () => {
    const response = await call('POST', `/v1/projects/${alice.project.id}/endpoints`, {
      token: alice.token,
      body: { url: 'http://10.0.0.5/hooks' },
    });

    expect(response.status).toBe(422);
    expect(response.body.detail).toContain('private');
  });

  it('rotates the secret and reports when the previous one stops being accepted', async () => {
    const response = await call('POST', `/v1/endpoints/${endpoint.id}/rotate-secret`, {
      token: alice.token,
    });

    expect(response.status).toBe(200);
    expect(response.body.secret).toMatch(/^whsec_/);
    expect(response.body.secret).not.toBe(endpoint.secret);
    expect(new Date(response.body.previousSecretExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const stored = await prisma.endpoint.findUnique({ where: { id: endpoint.id } });

    expect(stored.previousSecret).not.toBeNull();
    expect(stored.secret).not.toContain(response.body.secret);
  });

  it('disables and enables an endpoint, clearing the failure counter', async () => {
    await prisma.endpoint.update({
      where: { id: endpoint.id },
      data: { consecutiveFailures: 7 },
    });

    const disabled = await call('POST', `/v1/endpoints/${endpoint.id}/disable`, {
      token: alice.token,
    });

    expect(disabled.body.status).toBe('DISABLED');

    const enabled = await call('POST', `/v1/endpoints/${endpoint.id}/enable`, {
      token: alice.token,
    });

    expect(enabled.body.status).toBe('ACTIVE');
    expect(enabled.body.consecutiveFailures).toBe(0);
  });

  it('hides an endpoint of another project behind the same 404 as a missing one', async () => {
    const response = await call('PATCH', `/v1/endpoints/${endpoint.id}`, {
      token: bob.token,
      body: { description: 'stolen' },
    });

    expect(response.status).toBe(404);
  });
});

describe('api keys and ingestion', () => {
  it('issues a key that the ingestion route accepts', async () => {
    const created = await call('POST', `/v1/projects/${alice.project.id}/api-keys`, {
      token: alice.token,
      body: { name: 'dashboard-issued' },
    });

    expect(created.status).toBe(201);
    expect(created.body.key).toMatch(/^ht_/);

    const published = await fetch(`${baseUrl}/v1/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${created.body.key}` },
      body: JSON.stringify({ eventType: 'order.created', payload: { orderId: 1 } }),
    });

    expect(published.status).toBe(202);

    const listed = await call('GET', `/v1/projects/${alice.project.id}/api-keys`, {
      token: alice.token,
    });

    expect(listed.body.apiKeys[0].keyPrefix).toBe(created.body.keyPrefix);
    expect(listed.body.apiKeys[0].key).toBeUndefined();

    const revoked = await call(
      'DELETE',
      `/v1/projects/${alice.project.id}/api-keys/${created.body.id}`,
      { token: alice.token },
    );

    expect(revoked.body.revokedAt).not.toBeNull();

    const afterRevoke = await fetch(`${baseUrl}/v1/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${created.body.key}` },
      body: JSON.stringify({ eventType: 'order.created', payload: { orderId: 2 } }),
    });

    expect(afterRevoke.status).toBe(401);
  });
});

describe('deliveries', () => {
  let deliveries;

  beforeAll(async () => {
    const event = await createEvent(prisma, {
      projectId: alice.project.id,
      eventType: 'order.paid',
      payload: { orderId: 99 },
    });

    deliveries = [];

    for (const status of ['SUCCEEDED', 'FAILED_PERMANENTLY', 'RETRYING']) {
      deliveries.push(
        await prisma.delivery.create({
          data: {
            id: newId('delivery'),
            eventId: event.id,
            endpointId: endpoint.id,
            status,
            attemptCount: 1,
          },
        }),
      );
    }

    await prisma.deliveryAttempt.createMany({
      data: [
        {
          id: newId('attempt'),
          deliveryId: deliveries[2].id,
          attemptNumber: 1,
          responseStatus: 500,
          durationMs: 90,
        },
        {
          id: newId('attempt'),
          deliveryId: deliveries[2].id,
          attemptNumber: 2,
          responseStatus: 503,
          durationMs: 142,
        },
      ],
    });
  });

  it('pages with a keyset cursor instead of an offset', async () => {
    const first = await call('GET', `/v1/projects/${alice.project.id}/deliveries?limit=2`, {
      token: alice.token,
    });

    expect(first.status).toBe(200);
    expect(first.body.deliveries).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await call(
      'GET',
      `/v1/projects/${alice.project.id}/deliveries?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      { token: alice.token },
    );

    const firstIds = first.body.deliveries.map((delivery) => delivery.id);
    const secondIds = second.body.deliveries.map((delivery) => delivery.id);

    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
  });

  it('filters by status and event type', async () => {
    const byStatus = await call(
      'GET',
      `/v1/projects/${alice.project.id}/deliveries?status=FAILED_PERMANENTLY`,
      { token: alice.token },
    );

    expect(
      byStatus.body.deliveries.every((delivery) => delivery.status === 'FAILED_PERMANENTLY'),
    ).toBe(true);

    const byType = await call(
      'GET',
      `/v1/projects/${alice.project.id}/deliveries?eventType=order.paid`,
      { token: alice.token },
    );

    expect(byType.body.deliveries.every((delivery) => delivery.eventType === 'order.paid')).toBe(
      true,
    );
  });

  it('carries the newest attempt status and duration on every list row', async () => {
    const response = await call('GET', `/v1/projects/${alice.project.id}/deliveries`, {
      token: alice.token,
    });

    const rows = response.body.deliveries;
    const withAttempts = rows.find((delivery) => delivery.id === deliveries[2].id);
    const withoutAttempts = rows.find((delivery) => delivery.id === deliveries[0].id);

    expect(withAttempts.lastResponseStatus).toBe(503);
    expect(withAttempts.lastDurationMs).toBe(142);
    expect(withoutAttempts.lastResponseStatus).toBeNull();
    expect(withoutAttempts.lastDurationMs).toBeNull();
  });

  it('returns the delivery with its payload and attempt list', async () => {
    const response = await call('GET', `/v1/deliveries/${deliveries[0].id}`, {
      token: alice.token,
    });

    expect(response.status).toBe(200);
    expect(response.body.payload).toEqual({ orderId: 99 });
    expect(response.body.attempts).toEqual([]);
  });

  it('refuses to show a delivery of one project to a member of another', async () => {
    const byId = await call('GET', `/v1/deliveries/${deliveries[0].id}`, { token: bob.token });
    const byList = await call('GET', `/v1/projects/${alice.project.id}/deliveries`, {
      token: bob.token,
    });

    expect(byId.status).toBe(404);
    expect(byList.status).toBe(404);
  });

  it('replays a delivery into a new row that points back at the original', async () => {
    const response = await call('POST', `/v1/deliveries/${deliveries[1].id}/replay`, {
      token: alice.token,
    });

    expect(response.status).toBe(202);
    expect(response.body.replayedFromId).toBe(deliveries[1].id);
    expect(response.body.status).toBe('PENDING');
    expect(response.body.id).not.toBe(deliveries[1].id);

    const original = await prisma.delivery.findUnique({ where: { id: deliveries[1].id } });

    expect(original.status).toBe('FAILED_PERMANENTLY');
  });

  it('replays a filtered set in bulk, under the configured cap', async () => {
    const response = await call('POST', `/v1/projects/${alice.project.id}/deliveries/bulk-replay`, {
      token: alice.token,
      body: { status: 'FAILED_PERMANENTLY', limit: 10 },
    });

    expect(response.status).toBe(202);
    expect(response.body.replayed).toBeGreaterThan(0);
    expect(response.body.cappedAt).toBe(10);
  });

  it('reports per-project counts and latency', async () => {
    const response = await call('GET', `/v1/projects/${alice.project.id}/stats`, {
      token: alice.token,
    });

    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThan(0);
    expect(Object.keys(response.body.byStatus)).toContain('SUCCEEDED');
    expect(response.body.latency).toHaveProperty('averageMs');
  });
});

describe('realtime', () => {
  it('delivers a project event to that project only', async () => {
    const publisher = createRealtimePublisher({ redis: clients.redis });
    const aliceSocket = await openSocket(alice.token);
    const bobSocket = await openSocket(bob.token);

    try {
      await publisher.emit({
        projectId: alice.project.id,
        event: 'delivery.succeeded',
        payload: { deliveryId: 'dlv_realtime', attempt: 1 },
      });

      await wait(400);

      expect(aliceSocket.received).toEqual([
        { event: 'delivery.succeeded', payload: { deliveryId: 'dlv_realtime', attempt: 1 } },
      ]);
      expect(bobSocket.received).toEqual([]);
    } finally {
      aliceSocket.socket.disconnect();
      bobSocket.socket.disconnect();
    }
  });

  // The duplicate-broadcast trap only shows with more than one API instance:
  // every instance receives the worker's pub/sub message, so an emit through the
  // adapter would send one copy per instance.
  it('delivers exactly one copy while a second API instance is running', async () => {
    const { server: secondServer, baseUrl: secondUrl } = await startApi({
      clients,
      topology,
      config: appConfig,
      logger,
    });

    const secondRealtime = attachRealtime({
      server: secondServer,
      prisma,
      redis: clients.redis,
      config: appConfig,
      logger,
    });

    const socket = connectSocket(`${secondUrl}/realtime`, {
      auth: { token: alice.token },
      transports: ['websocket'],
      reconnection: false,
    });

    const received = [];

    socket.onAny((event, payload) => received.push({ event, payload }));

    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    try {
      await createRealtimePublisher({ redis: clients.redis }).emit({
        projectId: alice.project.id,
        event: 'delivery.succeeded',
        payload: { deliveryId: 'dlv_two_instances', attempt: 1 },
      });

      await wait(500);

      expect(received).toHaveLength(1);
    } finally {
      socket.disconnect();

      await secondRealtime.close();

      secondServer.close();
    }
  });

  it('refuses a handshake without a valid token', async () => {
    const socket = connectSocket(`${baseUrl}/realtime`, {
      auth: { token: 'not-a-token' },
      transports: ['websocket'],
      reconnection: false,
    });

    const error = await new Promise((resolve) => {
      socket.once('connect_error', resolve);
    });

    expect(error.message).toBe('unauthorized');

    socket.disconnect();
  });

  it('disconnects a socket when the access token it opened with expires', async () => {
    const shortLived = jwt.sign({ sub: alice.user.id }, appConfig.JWT_SECRET, { expiresIn: '2s' });
    const { socket } = await openSocket(shortLived);

    const reason = await new Promise((resolve) => {
      socket.once('token_expired', () => resolve('token_expired'));
      socket.once('disconnect', resolve);
    });

    expect(reason).toBe('token_expired');

    socket.disconnect();
  });
});
