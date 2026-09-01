import { describe, expect, it } from 'vitest';
import { attemptOutcome, publishResult, responseClass } from '../../src/api/metrics/labels.js';

describe('responseClass', () => {
  it('buckets a status code by its hundreds digit', () => {
    expect(responseClass(200)).toBe('2xx');
    expect(responseClass(204)).toBe('2xx');
    expect(responseClass(301)).toBe('3xx');
    expect(responseClass(404)).toBe('4xx');
    expect(responseClass(503)).toBe('5xx');
  });

  it('reports an attempt that never got a response as none', () => {
    expect(responseClass(null)).toBe('none');
    expect(responseClass(undefined)).toBe('none');
    expect(responseClass(Number.NaN)).toBe('none');
  });

  it('does not invent a class for a code outside 1xx to 5xx', () => {
    expect(responseClass(99)).toBe('other');
    expect(responseClass(600)).toBe('other');
  });
});

describe('attemptOutcome', () => {
  it('counts only a 2xx as a success', () => {
    expect(attemptOutcome(200)).toBe('success');
    expect(attemptOutcome(299)).toBe('success');
    expect(attemptOutcome(300)).toBe('failure');
    expect(attemptOutcome(199)).toBe('failure');
  });

  it('counts a transport error as a failure', () => {
    expect(attemptOutcome(null)).toBe('failure');
  });
});

describe('publishResult', () => {
  it('separates an accepted publish from a rejected one and from a fault', () => {
    expect(publishResult(202)).toBe('accepted');
    expect(publishResult(401)).toBe('rejected');
    expect(publishResult(413)).toBe('rejected');
    expect(publishResult(429)).toBe('rejected');
    expect(publishResult(500)).toBe('error');
    expect(publishResult(503)).toBe('error');
  });
});
