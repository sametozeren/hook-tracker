import { decryptSecret } from '../shared/crypto.js';
import { buildSignatureHeader } from '../shared/hmac.js';

const HOUR_MS = 3_600_000;

// During a rotation both signatures travel, so a receiver that still holds the
// old secret keeps working until the grace window closes.
export function activeSecrets(endpoint, { graceHours, now }) {
  const secrets = [decryptSecret(endpoint.secret)];

  if (!endpoint.previousSecret || !endpoint.secretRotatedAt) {
    return secrets;
  }

  const expiresAt = endpoint.secretRotatedAt.getTime() + graceHours * HOUR_MS;

  if (now.getTime() < expiresAt) {
    secrets.push(decryptSecret(endpoint.previousSecret));
  }

  return secrets;
}

export function deliveryHeaders({ delivery, event, endpoint, attempt, rawBody, graceHours, now }) {
  const timestamp = Math.floor(now.getTime() / 1000);

  return {
    'content-type': 'application/json',
    'user-agent': 'HookTracker/1.0',
    'x-webhook-id': delivery.id,
    'x-webhook-event': event.eventType,
    'x-webhook-attempt': String(attempt),
    'x-webhook-timestamp': String(timestamp),
    'x-webhook-signature': buildSignatureHeader({
      secrets: activeSecrets(endpoint, { graceHours, now }),
      timestamp,
      rawBody,
    }),
  };
}
