import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/shared/json.js';
import { defaultIdempotencyKey } from '../../src/api/middleware/idempotency.js';

describe('canonicalJson', () => {
  it('serialises the same object identically regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('sorts nested keys too', () => {
    expect(canonicalJson({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('keeps array order, which is part of the value', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('handles null and undefined without throwing', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('defaultIdempotencyKey', () => {
  const payload = { orderId: 1234, total: 99.9 };

  it('derives a stable sha256 from the event type and the payload', () => {
    const key = defaultIdempotencyKey({ eventType: 'order.created', payload });

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(
      defaultIdempotencyKey({
        eventType: 'order.created',
        payload: { total: 99.9, orderId: 1234 },
      }),
    ).toBe(key);
  });

  it('changes when the event type or the payload changes', () => {
    const key = defaultIdempotencyKey({ eventType: 'order.created', payload });

    expect(defaultIdempotencyKey({ eventType: 'order.paid', payload })).not.toBe(key);
    expect(defaultIdempotencyKey({ eventType: 'order.created', payload: { orderId: 1 } })).not.toBe(
      key,
    );
  });
});
