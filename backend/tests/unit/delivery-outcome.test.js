import { describe, expect, it } from 'vitest';
import { classifyTransportError } from '../../src/shared/http-client.js';
import { isSuccess, retryAfterSeconds } from '../../src/worker/handle-delivery.js';

describe('isSuccess', () => {
  it('accepts 2xx and nothing else', () => {
    expect(isSuccess(200)).toBe(true);
    expect(isSuccess(204)).toBe(true);
    expect(isSuccess(302)).toBe(false);
    expect(isSuccess(500)).toBe(false);
    expect(isSuccess(undefined)).toBe(false);
  });
});

describe('retryAfterSeconds', () => {
  it('reads a delay given in seconds', () => {
    expect(retryAfterSeconds({ 'retry-after': '120' })).toBe(120);
  });

  it('reads a delay given as an HTTP date', () => {
    const inTwoMinutes = new Date(Date.now() + 120_000).toUTCString();

    expect(retryAfterSeconds({ 'retry-after': inTwoMinutes })).toBeGreaterThan(100);
  });

  it('ignores a missing or unreadable value', () => {
    expect(retryAfterSeconds(undefined)).toBeUndefined();
    expect(retryAfterSeconds({})).toBeUndefined();
    expect(retryAfterSeconds({ 'retry-after': 'soon' })).toBeUndefined();
  });
});

describe('classifyTransportError', () => {
  it('maps the undici timeout codes onto one TIMEOUT code', () => {
    for (const code of [
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
    ]) {
      expect(classifyTransportError({ code })).toBe('TIMEOUT');
    }

    expect(classifyTransportError({ name: 'TimeoutError' })).toBe('TIMEOUT');
  });

  it('separates name resolution from connection failures', () => {
    expect(classifyTransportError({ code: 'ENOTFOUND' })).toBe('DNS');
    expect(classifyTransportError({ code: 'ECONNREFUSED' })).toBe('CONNECTION');
    expect(classifyTransportError({ cause: { code: 'ECONNRESET' } })).toBe('CONNECTION');
  });

  it('falls back to a generic code', () => {
    expect(classifyTransportError(new Error('something else'))).toBe('REQUEST_FAILED');
  });
});
