import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_VERSION = 'v1';
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

// The wire contract, named once: the worker writes these and the receiving side
// reads them back. Renaming one here renames it on both sides at the same time.
export const WEBHOOK_HEADERS = Object.freeze({
  id: 'x-webhook-id',
  event: 'x-webhook-event',
  attempt: 'x-webhook-attempt',
  timestamp: 'x-webhook-timestamp',
  signature: 'x-webhook-signature',
});

export const WEBHOOK_USER_AGENT = 'HookTracker/1.0';

const HOUR_MS = 3_600_000;

// Architecture §7 states one rotation deadline. The API promises this instant to
// the integrator and the worker decides against it whether the old signature
// still travels, so both have to read it from the same place.
export function previousSecretExpiresAt(secretRotatedAt, graceHours) {
  return new Date(secretRotatedAt.getTime() + graceHours * HOUR_MS);
}

function bodyBuffer(rawBody) {
  return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
}

export function signPayload({ secret, timestamp, rawBody }) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(bodyBuffer(rawBody))
    .digest('hex');
}

export function buildSignatureHeader({ secrets, timestamp, rawBody }) {
  return secrets
    .filter(Boolean)
    .map((secret) => `${SIGNATURE_VERSION}=${signPayload({ secret, timestamp, rawBody })}`)
    .join(',');
}

export function parseSignatureHeader(header) {
  if (typeof header !== 'string') return [];

  return header
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${SIGNATURE_VERSION}=`))
    .map((entry) => entry.slice(SIGNATURE_VERSION.length + 1));
}

function signaturesMatch(expected, candidate) {
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(candidate, 'hex');

  if (left.length === 0 || left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

export function verifySignature({
  header,
  secret,
  timestamp,
  rawBody,
  toleranceSeconds = TIMESTAMP_TOLERANCE_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const sentAt = Number(timestamp);

  if (!Number.isFinite(sentAt)) {
    return { valid: false, reason: 'missing_timestamp' };
  }

  if (Math.abs(nowSeconds - sentAt) > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_skew' };
  }

  const candidates = parseSignatureHeader(header);

  if (candidates.length === 0) {
    return { valid: false, reason: 'missing_signature' };
  }

  const expected = signPayload({ secret, timestamp, rawBody });
  const matched = candidates.some((candidate) => signaturesMatch(expected, candidate));

  return matched ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
}
