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

export function createDeliveryHandler({
  prisma,
  publisher,
  realtime,
  tokenBucket,
  config,
  logger,
  schedule = RETRY_SCHEDULE,
  send = sendWebhook,
  resolveTarget = resolveSafeTarget,
  now = () => new Date(),
  buildHeaders = deliveryHeaders,
}) {
  async function commit(operations) {
    await prisma.$transaction(operations);
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
    const failures = endpoint.consecutiveFailures + 1;
    const disable =
      endpoint.status === ENDPOINT_STATUS.ACTIVE &&
      failures >= config.ENDPOINT_AUTO_DISABLE_THRESHOLD;

    await commit([
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
        data: {
          consecutiveFailures: failures,
          ...(disable ? { status: ENDPOINT_STATUS.DISABLED } : {}),
        },
      }),
    ]);

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

      await finaliseFailure({
        delivery,
        attempt,
        result,
        reason: DELIVERY_FAILURE_REASON.PERMANENT,
        completedAt: now(),
      });

      logger?.warn({ deliveryId: delivery.id, attempt, reason: error.reason }, 'target rejected');

      return { outcome: 'ssrf_blocked' };
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
    const retrying = shouldRetry({ classification, attempt, maxAttempts: config.MAX_ATTEMPTS });

    const level = retrying
      ? selectRetryLevel({
          attempt,
          maxAttempts: config.MAX_ATTEMPTS,
          schedule,
          retryAfterSeconds: retryAfterSeconds(result.responseHeaders),
        })
      : null;

    if (level) {
      await finaliseRetry({ delivery, attempt, result, level, at: now() });

      return { outcome: 'retrying', level: level.level };
    }

    await finaliseFailure({
      delivery,
      attempt,
      result,
      reason:
        classification === FAILURE.PERMANENT
          ? DELIVERY_FAILURE_REASON.PERMANENT
          : DELIVERY_FAILURE_REASON.EXHAUSTED,
      completedAt: now(),
    });

    return { outcome: 'failed_permanently' };
  };
}
