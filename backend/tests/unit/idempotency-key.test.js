import { createHash } from 'node:crypto';
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

  // Keys already issued into a live idempotency window would stop matching if
  // the targetless form of the hash ever moved, so this digest is pinned to the
  // value it had before endpointIds joined the key.
  it('hashes a body without endpointIds exactly as it did before targets were folded in', () => {
    const legacyInput = `order.created${canonicalJson(payload)}`;
    const legacyDigest = createHash('sha256').update(legacyInput, 'utf8').digest('hex');

    expect(legacyDigest).toBe('77ef8c1573dc9dee4f224081536bdc1122542007c9901dada17a3b3d785b3aae');
    expect(defaultIdempotencyKey({ eventType: 'order.created', payload })).toBe(legacyDigest);
    expect(defaultIdempotencyKey({ eventType: 'order.created', payload, endpointIds: [] })).toBe(
      legacyDigest,
    );
    expect(
      defaultIdempotencyKey({ eventType: 'order.created', payload, endpointIds: undefined }),
    ).toBe(legacyDigest);
  });

  it('separates two publishes of the same body aimed at different endpoints', () => {
    const untargeted = defaultIdempotencyKey({ eventType: 'order.created', payload });
    const toA = defaultIdempotencyKey({
      eventType: 'order.created',
      payload,
      endpointIds: ['ep_A'],
    });
    const toB = defaultIdempotencyKey({
      eventType: 'order.created',
      payload,
      endpointIds: ['ep_B'],
    });
    const toBoth = defaultIdempotencyKey({
      eventType: 'order.created',
      payload,
      endpointIds: ['ep_A', 'ep_B'],
    });

    expect(new Set([untargeted, toA, toB, toBoth]).size).toBe(4);
  });

  it('treats the endpoint list as a set, so order and repeats do not matter', () => {
    const key = defaultIdempotencyKey({
      eventType: 'order.created',
      payload,
      endpointIds: ['ep_A', 'ep_B'],
    });

    expect(
      defaultIdempotencyKey({ eventType: 'order.created', payload, endpointIds: ['ep_B', 'ep_A'] }),
    ).toBe(key);
    expect(
      defaultIdempotencyKey({
        eventType: 'order.created',
        payload,
        endpointIds: ['ep_B', 'ep_A', 'ep_B'],
      }),
    ).toBe(key);
    expect(
      defaultIdempotencyKey({ eventType: 'order.created', payload, endpointIds: ['ep_A', 'ep_A'] }),
    ).toBe(defaultIdempotencyKey({ eventType: 'order.created', payload, endpointIds: ['ep_A'] }));
  });
});
