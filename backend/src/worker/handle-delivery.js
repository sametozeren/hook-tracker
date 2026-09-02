import { ALERT_REASON } from '../shared/alerts.js';
import { sendWebhook } from '../shared/http-client.js';
import { newId } from '../shared/ids.js';
import {
  FAILURE,
  RETRY_SCHEDULE,
  classifyFailure,
  selectRetryLevel,
  shouldRetry,
} from '../shared/retry.js';
import {
  DELIVERY_FAILURE_REASON,
  DELIVERY_STATUS,
  ENDPOINT_STATUS,
  TERMINAL_STATUSES,
} from '../shared/delivery-status.js';
import { SSRF_ERROR_CODE, resolveSafeTarget } from '../shared/ssrf.js';
import { deliveryHeaders } from './signing.js';

export function retryAfterSeconds(responseHeaders) {
  const value = responseHeaders?.['retry-after'];

  if (!value) {
    return undefined;
  }

  const numeric = Number(value);

  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return Math.max(0, Math.round((parsed - Date.now()) / 1000));
}

export function isSuccess(responseStatus) {
  return responseStatus >= 200 && responseStatus < 300;
}

function attemptRow(deliveryId, attempt, result) {
  return {
    id: newId('attempt'),
    deliveryId,
    attemptNumber: attempt,
    responseStatus: result.responseStatus ?? null,
    responseHeaders: result.responseHeaders ?? undefined,
    responseBodySnippet: result.responseBodySnippet ?? null,
    durationMs: result.durationMs ?? null,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage ?? null,
  };
}

function describe(result) {
  if (result.errorCode) {
    return `${result.errorCode}: ${result.errorMessage}`;
  }

  return `HTTP ${result.responseStatus}`;
}

const NO_ALERTS = { notify: async () => ({ sent: false, skipped: 'not_configured' }) };

// ssrf.js reports a name it could not resolve as `dns_failure`. A resolver that
// is briefly unreachable says nothing about the endpoint, so the delivery walks
// the ladder; every other reason is a property of the URL itself and stays
// permanent.
const RETRYABLE_TARGET_REASONS = new Set(['dns_failure']);

export function createDeliveryHandler({
  prisma,
  publisher,
  realtime,
  tokenBucket,
  alerts = NO_ALERTS,
  config,
  logger,
  schedule = RETRY_SCHEDULE,
  send = sendWebhook,
  resolveTarget = resolveSafeTarget,
  now = () => new Date(),
  buildHeaders = deliveryHeaders,
}) {
  function commit(operations) {
    return prisma.$transaction(operations);
  }

  function nextRetryLevel({ classification, attempt, retryAfter }) {
    if (!shouldRetry({ classification, attempt, maxAttempts: config.MAX_ATTEMPTS })) {
      return null;
    }

    return selectRetryLevel({
      attempt,
      maxAttempts: config.MAX_ATTEMPTS,
      schedule,
      retryAfterSeconds: retryAfter,
    });
  }

  function failureReason(classification) {
    return classification === FAILURE.PERMANENT
      ? DELIVERY_FAILURE_REASON.PERMANENT
      : DELIVERY_FAILURE_REASON.EXHAUSTED;
  }

  async function finaliseSuccess({ delivery, attempt, result, completedAt }) {
    await commit([
      prisma.deliveryAttempt.create({ data: attemptRow(delivery.id, attempt, result) }),
      prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: DELIVERY_STATUS.SUCCEEDED,
          attemptCount: attempt,
          lastError: null,
          nextAttemptAt: null,
          completedAt,
        },
      }),
      prisma.endpoint.update({
        where: { id: delivery.endpointId },
        data: { consecutiveFailures: 0 },
      }),
    ]);

    await realtime.emit({
      projectId: delivery.event.projectId,
      event: 'delivery.succeeded',
      payload: {
        deliveryId: delivery.id,
        attempt,
        responseStatus: result.responseStatus,
        durationMs: result.durationMs,
        completedAt,
      },
    });
  }

  async function finaliseRetry({ delivery, attempt, result, level, at }) {
    const nextAttemptAt = new Date(at.getTime() + level.delayMs);

    await commit([
      prisma.deliveryAttempt.create({ data: attemptRow(delivery.id, attempt, result) }),
      prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: DELIVERY_STATUS.RETRYING,
          attemptCount: attempt,
          lastError: describe(result),
          nextAttemptAt,
        },
      }),
    ]);

    // Published before the ack: if the process dies here the message is
    // redelivered and the attempt repeats, which is the at-least-once contract.
    // Acking first could drop the chain entirely.
    await publisher.publishRetry({
      deliveryId: delivery.id,
      attempt: attempt + 1,
      level: level.level,
    });

    await realtime.emit({
      projectId: delivery.event.projectId,
      event: 'delivery.attempted',
      payload: {
        deliveryId: delivery.id,
        attempt,
        responseStatus: result.responseStatus ?? null,
        durationMs: result.durationMs ?? null,
        nextAttemptAt,
      },
    });
  }

  async function finaliseFailure({ delivery, attempt, result, reason, completedAt }) {
    const { endpoint } = delivery;

    // The increment is computed by the database, not from the value this worker
    // read when it picked the delivery up: workers failing against the same
    // endpoint at the same moment would otherwise overwrite each other and the
    // counter would climb slower than the failures it counts.
    const [, , counted] = await commit([
      prisma.deliveryAttempt.create({ data: attemptRow(delivery.id, attempt, result) }),
      prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: DELIVERY_STATUS.FAILED_PERMANENTLY,
          attemptCount: attempt,
          lastError: describe(result),
          nextAttemptAt: null,
          completedAt,
        },
      }),
      prisma.endpoint.update({
        where: { id: endpoint.id },
        data: { consecutiveFailures: { increment: 1 } },
      }),
    ]);

    const failures = counted.consecutiveFailures;

    // Only the update that actually flips the row matches, so concurrent
    // workers crossing the threshold together announce the disable once.
    const { count } = await prisma.endpoint.updateMany({
      where: {
        id: endpoint.id,
        status: ENDPOINT_STATUS.ACTIVE,
        consecutiveFailures: { gte: config.ENDPOINT_AUTO_DISABLE_THRESHOLD },
      },
      data: { status: ENDPOINT_STATUS.DISABLED },
    });

    const disable = count > 0;

    await publisher.publishDeadLetter({ deliveryId: delivery.id, attempt });

    await realtime.emit({
      projectId: delivery.event.projectId,
      event: 'delivery.failed',
      payload: {
        deliveryId: delivery.id,
        attempt,
        reason,
        errorCode: result.errorCode ?? null,
        responseStatus: result.responseStatus ?? null,
        completedAt,
      },
    });

    if (disable) {
      await realtime.emit({
        projectId: delivery.event.projectId,
        event: 'endpoint.disabled',
        payload: {
          endpointId: endpoint.id,
          consecutiveFailures: failures,
          disabledAt: completedAt,
        },
      });

      await alerts.notify({
        projectId: delivery.event.projectId,
        reason: ALERT_REASON.ENDPOINT_DISABLED,
        scope: endpoint.id,
        detail: {
          endpointId: endpoint.id,
          consecutiveFailures: failures,
          threshold: config.ENDPOINT_AUTO_DISABLE_THRESHOLD,
        },
      });
    }
  }

  return async function handleDelivery({ deliveryId, attempt }) {
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { event: true, endpoint: true },
    });

    if (!delivery) {
      return { outcome: 'unknown_delivery' };
    }

    if (TERMINAL_STATUSES.has(delivery.status)) {
      return { outcome: 'already_finalised' };
    }

    const { endpoint, event } = delivery;

    if (endpoint.status === ENDPOINT_STATUS.DISABLED) {
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: DELIVERY_STATUS.SKIPPED,
          completedAt: now(),
          lastError: 'endpoint is disabled',
        },
      });

      return { outcome: 'endpoint_disabled' };
    }

    // Parking does not count as an attempt: no attempt row, no attemptCount
    // change, so a throttled endpoint cannot burn through the retry ladder.
    const allowed = await tokenBucket.take({
      endpointId: endpoint.id,
      ratePerMinute: endpoint.rateLimitPerMinute,
    });

    if (!allowed) {
      await publisher.publishThrottle({ deliveryId: delivery.id, attempt });

      return { outcome: 'throttled' };
    }

    await prisma.delivery.update({
      where: { id: delivery.id },
      data: { status: DELIVERY_STATUS.IN_FLIGHT },
    });

    const startedAt = now();
    const rawBody = JSON.stringify(event.payload);

    let target;

    try {
      target = await resolveTarget(endpoint.url, {
        allowPrivate: config.SSRF_ALLOW_PRIVATE,
        allowlistHosts: config.SSRF_ALLOWLIST_HOSTS,
        blockedPorts: config.SSRF_BLOCKED_PORTS,
      });
    } catch (error) {
      const result = {
        errorCode: error.code ?? SSRF_ERROR_CODE,
        errorMessage: error.message,
        durationMs: 0,
      };

      const classification = RETRYABLE_TARGET_REASONS.has(error.reason)
        ? FAILURE.RETRYABLE
        : FAILURE.PERMANENT;

      const level = nextRetryLevel({ classification, attempt });

      logger?.warn({ deliveryId: delivery.id, attempt, reason: error.reason }, 'target rejected');

      if (level) {
        await finaliseRetry({ delivery, attempt, result, level, at: now() });

        return { outcome: 'retrying', level: level.level };
      }

      await finaliseFailure({
        delivery,
        attempt,
        result,
        reason: failureReason(classification),
        completedAt: now(),
      });

      return {
        outcome: classification === FAILURE.PERMANENT ? 'ssrf_blocked' : 'failed_permanently',
      };
    }

    const headers = buildHeaders({
      delivery,
      event,
      endpoint,
      attempt,
      rawBody,
      graceHours: config.SECRET_ROTATION_GRACE_HOURS,
      now: startedAt,
    });

    const result = await send({
      target,
      headers,
      body: rawBody,
      connectTimeoutMs: config.DELIVERY_CONNECT_TIMEOUT_MS,
      totalTimeoutMs: config.DELIVERY_TIMEOUT_MS,
      snippetBytes: config.RESPONSE_SNIPPET_BYTES,
    });

    if (isSuccess(result.responseStatus)) {
      await finaliseSuccess({ delivery, attempt, result, completedAt: now() });

      return { outcome: 'succeeded' };
    }

    const classification = classifyFailure({ responseStatus: result.responseStatus });

    const level = nextRetryLevel({
      classification,
      attempt,
      retryAfter: retryAfterSeconds(result.responseHeaders),
    });

    if (level) {
      await finaliseRetry({ delivery, attempt, result, level, at: now() });

      return { outcome: 'retrying', level: level.level };
    }

    await finaliseFailure({
      delivery,
      attempt,
      result,
      reason: failureReason(classification),
      completedAt: now(),
    });

    return { outcome: 'failed_permanently' };
  };
}
