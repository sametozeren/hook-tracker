export const RETRY_SCHEDULE = Object.freeze([
  Object.freeze({ level: '1m', delayMs: 60_000, queue: 'webhook.retry.1m' }),
  Object.freeze({ level: '5m', delayMs: 300_000, queue: 'webhook.retry.5m' }),
  Object.freeze({ level: '30m', delayMs: 1_800_000, queue: 'webhook.retry.30m' }),
  Object.freeze({ level: '2h', delayMs: 7_200_000, queue: 'webhook.retry.2h' }),
  Object.freeze({ level: '6h', delayMs: 21_600_000, queue: 'webhook.retry.6h' }),
]);

export const MAX_SUPPORTED_ATTEMPTS = RETRY_SCHEDULE.length + 1;
