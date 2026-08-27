import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildSignatureHeader,
  parseSignatureHeader,
  signPayload,
  verifySignature,
} from '../../src/shared/hmac.js';

const secret = 'whsec_primary';
const rawBody = JSON.stringify({ orderId: 1234 });
const timestamp = 1_800_000_000;

describe('signPayload', () => {
  it('matches an independent implementation of <timestamp>.<rawBody>', () => {
    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

    expect(signPayload({ secret, timestamp, rawBody })).toBe(expected);
  });

  it('signs the exact bytes sent, not a re-serialisation', () => {
    const spaced = '{ "orderId": 1234 }';

    expect(signPayload({ secret, timestamp, rawBody: spaced })).not.toBe(
      signPayload({ secret, timestamp, rawBody }),
    );
  });
});

describe('buildSignatureHeader', () => {
  it('emits one v1 entry per active secret during rotation', () => {
    const header = buildSignatureHeader({
      secrets: [secret, 'whsec_previous'],
      timestamp,
      rawBody,
    });

    expect(parseSignatureHeader(header)).toEqual([
      signPayload({ secret, timestamp, rawBody }),
      signPayload({ secret: 'whsec_previous', timestamp, rawBody }),
    ]);
  });

  it('skips an absent previous secret', () => {
    const header = buildSignatureHeader({ secrets: [secret, null], timestamp, rawBody });

    expect(parseSignatureHeader(header)).toHaveLength(1);
  });
});

describe('verifySignature', () => {
  const header = buildSignatureHeader({ secrets: [secret], timestamp, rawBody });

  it('accepts a signature within the tolerance window', () => {
    expect(
      verifySignature({ header, secret, timestamp, rawBody, nowSeconds: timestamp + 299 }),
    ).toEqual({ valid: true });
  });

  it('rejects a timestamp beyond the tolerance window', () => {
    expect(
      verifySignature({ header, secret, timestamp, rawBody, nowSeconds: timestamp + 301 }),
    ).toEqual({ valid: false, reason: 'timestamp_skew' });
  });

  it('rejects a body edited after signing', () => {
    expect(
      verifySignature({
        header,
        secret,
        timestamp,
        rawBody: JSON.stringify({ orderId: 9999 }),
        nowSeconds: timestamp,
      }),
    ).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('accepts either signature while both secrets are active', () => {
    const rotated = buildSignatureHeader({
      secrets: ['whsec_new', secret],
      timestamp,
      rawBody,
    });

    expect(
      verifySignature({ header: rotated, secret, timestamp, rawBody, nowSeconds: timestamp }),
    ).toEqual({ valid: true });
  });

  it('reports missing headers instead of throwing', () => {
    expect(
      verifySignature({ header: undefined, secret, timestamp, rawBody, nowSeconds: timestamp }),
    ).toEqual({ valid: false, reason: 'missing_signature' });
    expect(
      verifySignature({ header, secret, timestamp: undefined, rawBody, nowSeconds: timestamp }),
    ).toEqual({ valid: false, reason: 'missing_timestamp' });
  });
});
