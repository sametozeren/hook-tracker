import { describe, expect, it } from 'vitest';
import { ALERT_REASON, createAlertDispatcher } from '../../src/shared/alerts.js';

const config = {
  ALERT_SUPPRESSION_MINUTES: 60,
  ALERT_TIMEOUT_MS: 5000,
  SSRF_ALLOW_PRIVATE: false,
  SSRF_ALLOWLIST_HOSTS: [],
  SSRF_BLOCKED_PORTS: [],
};

function createRedis({ claims = true } = {}) {
  const keys = new Set();

  return {
    keys,
    set: async (key) => {
      if (!claims || keys.has(key)) {
        return null;
      }

      keys.add(key);

      return 'OK';
    },
  };
}

function createPrisma(projects) {
  return {
    project: {
      findUnique: async ({ where }) => projects.find((project) => project.id === where.id) ?? null,
      findMany: async () => projects.filter((project) => project.alertWebhookUrl),
    },
  };
}

function createSend(result = { responseStatus: 204 }) {
  const calls = [];

  return {
    calls,
    send: async (options) => {
      calls.push(options);

      return result;
    },
  };
}

const resolveTarget = async (url) => ({ url, address: '203.0.113.10', family: 4 });

const configured = { id: 'prj_1', alertWebhookUrl: 'https://alerts.example.com/hook' };

describe('createAlertDispatcher', () => {
  it('posts the reason and its detail, and nothing about the payload being delivered', async () => {
    const { calls, send } = createSend();
    const dispatcher = createAlertDispatcher({
      prisma: createPrisma([configured]),
      redis: createRedis(),
      config,
      send,
      resolveTarget,
      now: () => new Date('2026-09-02T10:00:00.000Z'),
    });

    const result = await dispatcher.notify({
      projectId: 'prj_1',
      reason: ALERT_REASON.ENDPOINT_DISABLED,
      scope: 'ep_1',
      detail: { endpointId: 'ep_1', consecutiveFailures: 20 },
    });

    expect(result).toEqual({ sent: true });
    expect(JSON.parse(calls[0].body)).toEqual({
      source: 'hook-tracker',
      reason: 'endpoint_disabled',
      projectId: 'prj_1',
      occurredAt: '2026-09-02T10:00:00.000Z',
      detail: { endpointId: 'ep_1', consecutiveFailures: 20 },
    });
  });

  it('sends nothing for a project that configured no address', async () => {
    const { calls, send } = createSend();
    const dispatcher = createAlertDispatcher({
      prisma: createPrisma([{ id: 'prj_1', alertWebhookUrl: null }]),
      redis: createRedis(),
      config,
      send,
      resolveTarget,
    });

    expect(
      await dispatcher.notify({ projectId: 'prj_1', reason: ALERT_REASON.ENDPOINT_DISABLED }),
    ).toEqual({ sent: false, skipped: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('sends once per suppression window for the same project, reason and scope', async () => {
    const { calls, send } = createSend();
    const dispatcher = createAlertDispatcher({
      prisma: createPrisma([configured]),
      redis: createRedis(),
      config,
      send,
      resolveTarget,
    });

    const alert = { projectId: 'prj_1', reason: ALERT_REASON.ENDPOINT_DISABLED, scope: 'ep_1' };

    await dispatcher.notify(alert);

    const second = await dispatcher.notify(alert);

    await dispatcher.notify({ ...alert, scope: 'ep_2' });

    expect(second).toEqual({ sent: false, skipped: 'suppressed' });
    expect(calls).toHaveLength(2);
  });

  it('swallows a failing alert channel instead of propagating it', async () => {
    const dispatcher = createAlertDispatcher({
      prisma: createPrisma([configured]),
      redis: createRedis(),
      config,
      send: async () => {
        throw new Error('connection refused');
      },
      resolveTarget,
    });

    expect(
      await dispatcher.notify({ projectId: 'prj_1', reason: ALERT_REASON.ENDPOINT_DISABLED }),
    ).toEqual({ sent: false, skipped: 'failed' });
  });

  it('reports a rejected response as a failure rather than a send', async () => {
    const { send } = createSend({ responseStatus: 500 });
    const dispatcher = createAlertDispatcher({
      prisma: createPrisma([configured]),
      redis: createRedis(),
      config,
      send,
      resolveTarget,
    });

    expect(
      await dispatcher.notify({ projectId: 'prj_1', reason: ALERT_REASON.ENDPOINT_DISABLED }),
    ).toEqual({ sent: false, skipped: 'failed' });
  });

  it('tells every project that configured an address about an instance-wide condition', async () => {
    const { calls, send } = createSend();
    const dispatcher = createAlertDispatcher({
      prisma: createPrisma([
        configured,
        { id: 'prj_2', alertWebhookUrl: 'https://second.example.com/hook' },
        { id: 'prj_3', alertWebhookUrl: null },
      ]),
      redis: createRedis(),
      config,
      send,
      resolveTarget,
    });

    const result = await dispatcher.notifyConfiguredProjects({
      reason: ALERT_REASON.DEAD_LETTER_BACKLOG,
      detail: { depth: 120 },
    });

    expect(result).toEqual({ sent: 2, projects: 2 });
    expect(calls.map((call) => call.target.url)).toEqual([
      'https://alerts.example.com/hook',
      'https://second.example.com/hook',
    ]);
  });
});
