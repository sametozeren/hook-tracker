import { describe, expect, it } from 'vitest';
import {
  FAILURE,
  MAX_SUPPORTED_ATTEMPTS,
  RETRY_SCHEDULE,
  applyJitter,
  classifyFailure,
  selectRetryLevel,
  shouldRetry,
} from '../../src/shared/retry.js';

describe('classifyFailure', () => {
  it('treats transport failures as retryable', () => {
    expect(classifyFailure({})).toBe(FAILURE.RETRYABLE);
    expect(classifyFailure({ responseStatus: undefined })).toBe(FAILURE.RETRYABLE);
  });

  it('treats every 5xx and the documented 4xx set as retryable', () => {
    for (const status of [500, 502, 503, 504, 408, 425, 429]) {
      expect(classifyFailure({ responseStatus: status })).toBe(FAILURE.RETRYABLE);
    }
  });

  it('treats client errors and redirects as permanent', () => {
    for (const status of [400, 401, 403, 404, 410, 422, 405, 301, 302, 307]) {
      expect(classifyFailure({ responseStatus: status })).toBe(FAILURE.PERMANENT);
    }
  });
});

describe('shouldRetry', () => {
  it('stops at the attempt ceiling even for a retryable failure', () => {
    expect(shouldRetry({ classification: FAILURE.RETRYABLE, attempt: 5, maxAttempts: 6 })).toBe(
      true,
    );
    expect(shouldRetry({ classification: FAILURE.RETRYABLE, attempt: 6, maxAttempts: 6 })).toBe(
      false,
    );
  });

  it('never retries a permanent failure', () => {
    expect(shouldRetry({ classification: FAILURE.PERMANENT, attempt: 1, maxAttempts: 6 })).toBe(
      false,
    );
  });
});

describe('selectRetryLevel', () => {
  const maxAttempts = MAX_SUPPORTED_ATTEMPTS;

  it('walks the ladder in order', () => {
    const levels = [1, 2, 3, 4, 5].map(
      (attempt) => selectRetryLevel({ attempt, maxAttempts }).level,
    );

    expect(levels).toEqual(['1m', '5m', '30m', '2h', '6h']);
  });

  it('returns null once the attempts are exhausted', () => {
    expect(selectRetryLevel({ attempt: 6, maxAttempts })).toBeNull();
  });

  it('honours a lowered MAX_ATTEMPTS', () => {
    expect(selectRetryLevel({ attempt: 2, maxAttempts: 2 })).toBeNull();
  });

  it('ignores a Retry-After shorter than the scheduled delay', () => {
    expect(selectRetryLevel({ attempt: 1, maxAttempts, retryAfterSeconds: 30 }).level).toBe('1m');
  });

  it('escalates to the next level that covers a longer Retry-After', () => {
    expect(selectRetryLevel({ attempt: 1, maxAttempts, retryAfterSeconds: 600 }).level).toBe('30m');
  });

  it('clamps a Retry-After longer than the whole ladder to the last level', () => {
    expect(selectRetryLevel({ attempt: 1, maxAttempts, retryAfterSeconds: 86_400 }).level).toBe(
      '6h',
    );
  });

  it('accepts an injected schedule so tests do not wait on real delays', () => {
    const schedule = [{ level: 'fast', delayMs: 25 }];

    expect(selectRetryLevel({ attempt: 1, maxAttempts: 2, schedule }).delayMs).toBe(25);
  });
});

describe('applyJitter', () => {
  it('never exceeds the queue ttl and never drops more than 10 percent', () => {
    expect(applyJitter(60_000, () => 0)).toBe(60_000);
    expect(applyJitter(60_000, () => 1)).toBe(54_000);
  });

  it('stays inside the band for every level of the real schedule', () => {
    for (const level of RETRY_SCHEDULE) {
      for (const value of [0, 0.25, 0.5, 0.75, 1]) {
        const jittered = applyJitter(level.delayMs, () => value);

        expect(jittered).toBeLessThanOrEqual(level.delayMs);
        expect(jittered).toBeGreaterThanOrEqual(level.delayMs * 0.9);
      }
    }
  });
});
