import { decryptSecret } from '../shared/crypto.js';
import { WEBHOOK_HEADERS, WEBHOOK_USER_AGENT, buildSignatureHeader } from '../shared/hmac.js';

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
    'user-agent': WEBHOOK_USER_AGENT,
    [WEBHOOK_HEADERS.id]: delivery.id,
    [WEBHOOK_HEADERS.event]: event.eventType,
    [WEBHOOK_HEADERS.attempt]: String(attempt),
    [WEBHOOK_HEADERS.timestamp]: String(timestamp),
    [WEBHOOK_HEADERS.signature]: buildSignatureHeader({
      secrets: activeSecrets(endpoint, { graceHours, now }),
      timestamp,
      rawBody,
    }),
  };
}
