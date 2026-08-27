import { describe, expect, it } from 'vitest';
import { encryptSecret } from '../../src/shared/crypto.js';
import { parseSignatureHeader, signPayload, verifySignature } from '../../src/shared/hmac.js';
import { activeSecrets, deliveryHeaders } from '../../src/worker/signing.js';

const now = new Date('2026-08-27T10:00:00.000Z');

function endpointWithRotation(rotatedAt) {
  return {
    secret: encryptSecret('whsec_current'),
    previousSecret: encryptSecret('whsec_previous'),
    secretRotatedAt: rotatedAt,
  };
}

describe('activeSecrets', () => {
  it('uses the current secret alone when nothing was rotated', () => {
    const endpoint = { secret: encryptSecret('whsec_current'), previousSecret: null };

    expect(activeSecrets(endpoint, { graceHours: 24, now })).toEqual(['whsec_current']);
  });

  it('keeps the previous secret alive inside the grace window', () => {
    const endpoint = endpointWithRotation(new Date(now.getTime() - 60_000));

    expect(activeSecrets(endpoint, { graceHours: 24, now })).toEqual([
      'whsec_current',
      'whsec_previous',
    ]);
  });

  it('drops the previous secret once the grace window has passed', () => {
    const endpoint = endpointWithRotation(new Date(now.getTime() - 25 * 3_600_000));

    expect(activeSecrets(endpoint, { graceHours: 24, now })).toEqual(['whsec_current']);
  });
});

describe('deliveryHeaders', () => {
  const delivery = { id: 'dlv_abcdefghijklmnopqrstuvwx' };
  const event = { eventType: 'order.created' };
  const rawBody = JSON.stringify({ orderId: 1234 });

  it('carries the documented header set', () => {
    const headers = deliveryHeaders({
      delivery,
      event,
      endpoint: { secret: encryptSecret('whsec_current'), previousSecret: null },
      attempt: 3,
      rawBody,
      graceHours: 24,
      now,
    });

    expect(headers['x-webhook-id']).toBe(delivery.id);
    expect(headers['x-webhook-event']).toBe('order.created');
    expect(headers['x-webhook-attempt']).toBe('3');
    expect(headers['x-webhook-timestamp']).toBe(String(Math.floor(now.getTime() / 1000)));
    expect(headers['content-type']).toBe('application/json');
    expect(headers['user-agent']).toBe('HookTracker/1.0');
  });

  it('signs the exact body bytes with the current secret', () => {
    const headers = deliveryHeaders({
      delivery,
      event,
      endpoint: { secret: encryptSecret('whsec_current'), previousSecret: null },
      attempt: 1,
      rawBody,
      graceHours: 24,
      now,
    });

    const timestamp = headers['x-webhook-timestamp'];

    expect(parseSignatureHeader(headers['x-webhook-signature'])).toEqual([
      signPayload({ secret: 'whsec_current', timestamp, rawBody }),
    ]);
  });

  it('sends both signatures during a rotation, so either secret verifies', () => {
    const headers = deliveryHeaders({
      delivery,
      event,
      endpoint: endpointWithRotation(new Date(now.getTime() - 60_000)),
      attempt: 1,
      rawBody,
      graceHours: 24,
      now,
    });

    const timestamp = headers['x-webhook-timestamp'];
    const nowSeconds = Number(timestamp);

    for (const secret of ['whsec_current', 'whsec_previous']) {
      expect(
        verifySignature({
          header: headers['x-webhook-signature'],
          secret,
          timestamp,
          rawBody,
          nowSeconds,
        }),
      ).toEqual({ valid: true });
    }
  });
});
