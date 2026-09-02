import { sendWebhook } from './http-client.js';
import { resolveSafeTarget } from './ssrf.js';

const SNIPPET_BYTES = 256;

export const ALERT_REASON = Object.freeze({
  ENDPOINT_DISABLED: 'endpoint_disabled',
  DEAD_LETTER_BACKLOG: 'dead_letter_backlog',
  DEPENDENCY_UNREACHABLE: 'dependency_unreachable',
});

function suppressionKey(projectId, reason, scope) {
  return `alert:${projectId}:${reason}:${scope}`;
}

export function createAlertDispatcher({
  prisma,
  redis,
  config,
  logger,
  send = sendWebhook,
  resolveTarget = resolveSafeTarget,
  now = () => new Date(),
}) {
  // The window is claimed with NX rather than read and written, so two workers
  // failing the same endpoint at the same moment send one alert between them.
  async function claim(projectId, reason, scope) {
    const claimed = await redis.set(
      suppressionKey(projectId, reason, scope),
      String(now().getTime()),
      'EX',
      config.ALERT_SUPPRESSION_MINUTES * 60,
      'NX',
    );

    return claimed === 'OK';
  }

  async function post(url, body) {
    const target = await resolveTarget(url, {
      allowPrivate: config.SSRF_ALLOW_PRIVATE,
      allowlistHosts: config.SSRF_ALLOWLIST_HOSTS,
      blockedPorts: config.SSRF_BLOCKED_PORTS,
    });

    return send({
      target,
      headers: { 'content-type': 'application/json', 'user-agent': 'hook-tracker/alerts' },
      body: JSON.stringify(body),
      connectTimeoutMs: config.ALERT_TIMEOUT_MS,
      totalTimeoutMs: config.ALERT_TIMEOUT_MS,
      snippetBytes: SNIPPET_BYTES,
    });
  }

  // An alert never carries a payload, a secret or an API key: it travels to an
  // address whose only promise is that an owner typed it, and it exists to say
  // that something needs attention, not to describe what was being delivered.
  function alertBody({ projectId, reason, detail, occurredAt }) {
    return { source: 'hook-tracker', reason, projectId, occurredAt, detail };
  }

  async function notifyProject({ project, reason, scope, detail }) {
    if (!project.alertWebhookUrl) {
      return { sent: false, skipped: 'not_configured' };
    }

    if (!(await claim(project.id, reason, scope))) {
      return { sent: false, skipped: 'suppressed' };
    }

    const occurredAt = now().toISOString();
    const result = await post(
      project.alertWebhookUrl,
      alertBody({ projectId: project.id, reason, detail, occurredAt }),
    );

    if (result.errorCode || result.responseStatus >= 400) {
      logger?.warn(
        {
          projectId: project.id,
          reason,
          responseStatus: result.responseStatus ?? null,
          errorCode: result.errorCode ?? null,
        },
        'alert delivery failed',
      );

      return { sent: false, skipped: 'failed' };
    }

    return { sent: true };
  }

  // Failure is swallowed on purpose: an alert is a side channel, and a channel
  // that cannot be reached must not take down the delivery or the job that
  // noticed the problem.
  async function guard(work) {
    try {
      return await work();
    } catch (error) {
      logger?.warn({ reason: error.message }, 'alert dispatch failed');

      return { sent: false, skipped: 'failed' };
    }
  }

  return {
    async notify({ projectId, reason, scope = reason, detail = {} }) {
      return guard(async () => {
        const project = await prisma.project.findUnique({ where: { id: projectId } });

        if (!project) {
          return { sent: false, skipped: 'unknown_project' };
        }

        return notifyProject({ project, reason, scope, detail });
      });
    },

    // A stalled broker or a growing dead-letter queue belongs to the instance,
    // not to one project, so every project that asked to be told is told.
    async notifyConfiguredProjects({ reason, scope = reason, detail = {} }) {
      return guard(async () => {
        const projects = await prisma.project.findMany({
          where: { alertWebhookUrl: { not: null } },
        });

        const results = await Promise.all(
          projects.map((project) => guard(() => notifyProject({ project, reason, scope, detail }))),
        );

        return { sent: results.filter((result) => result.sent).length, projects: projects.length };
      });
    },
  };
}
