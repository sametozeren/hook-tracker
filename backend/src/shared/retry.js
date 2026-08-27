export const RETRY_SCHEDULE = Object.freeze([
  Object.freeze({ level: '1m', delayMs: 60_000 }),
  Object.freeze({ level: '5m', delayMs: 300_000 }),
  Object.freeze({ level: '30m', delayMs: 1_800_000 }),
  Object.freeze({ level: '2h', delayMs: 7_200_000 }),
  Object.freeze({ level: '6h', delayMs: 21_600_000 }),
]);

export const MAX_SUPPORTED_ATTEMPTS = RETRY_SCHEDULE.length + 1;

export const THROTTLE_DELAY_MS = 10_000;

export const FAILURE = Object.freeze({
  RETRYABLE: 'RETRYABLE',
  PERMANENT: 'PERMANENT',
});

const JITTER_RATIO = 0.1;

const RETRYABLE_STATUSES = new Set([408, 425, 429]);

export function classifyFailure({ responseStatus } = {}) {
  if (!Number.isFinite(responseStatus)) {
    return FAILURE.RETRYABLE;
  }

  if (responseStatus >= 500) {
    return FAILURE.RETRYABLE;
  }

  if (RETRYABLE_STATUSES.has(responseStatus)) {
    return FAILURE.RETRYABLE;
  }

  return FAILURE.PERMANENT;
}

export function shouldRetry({ classification, attempt, maxAttempts }) {
  return classification === FAILURE.RETRYABLE && attempt < maxAttempts;
}

export function selectRetryLevel({
  attempt,
  maxAttempts,
  schedule = RETRY_SCHEDULE,
  retryAfterSeconds,
}) {
  if (attempt >= maxAttempts) {
    return null;
  }

  const scheduled = schedule[attempt - 1];

  if (!scheduled) {
    return null;
  }

  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds * 1000 <= scheduled.delayMs) {
    return scheduled;
  }

  const requestedMs = retryAfterSeconds * 1000;
  const larger = schedule.find((level) => level.delayMs >= requestedMs);

  return larger ?? schedule[schedule.length - 1];
}

// Jitter never lengthens the delay: RabbitMQ drops a per-message expiration that
// exceeds the queue TTL back to the queue value, so only the downward half of
// the ±10% band is actually expressible.
export function applyJitter(delayMs, random = Math.random) {
  return Math.round(delayMs * (1 - JITTER_RATIO * random()));
}
