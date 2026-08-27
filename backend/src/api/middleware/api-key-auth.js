import { apiKeyPrefix, constantTimeEquals, hashApiKey } from '../../shared/crypto.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { bearerToken } from '../bearer.js';

const ABSENT_KEY_HASH = '0'.repeat(64);

const LAST_USED_THRESHOLD_MS = 60_000;

function presentedKey(req) {
  const plaintext = bearerToken(req);

  if (!plaintext) {
    throw new UnauthorizedError('An API key is required: Authorization: Bearer ht_<key>');
  }

  try {
    return { plaintext, prefix: apiKeyPrefix(plaintext) };
  } catch {
    throw new UnauthorizedError('The API key is malformed');
  }
}

export function createApiKeyAuth({ prisma, lastUsedThresholdMs = LAST_USED_THRESHOLD_MS }) {
  // lastUsedAt is a convenience column, not an audit record. Writing it on every
  // request would add a row lock to the hot ingestion path, so it is refreshed
  // at most once per threshold window and never blocks the response.
  function touch(record) {
    const age = record.lastUsedAt ? Date.now() - record.lastUsedAt.getTime() : Infinity;

    if (age < lastUsedThresholdMs) {
      return;
    }

    prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  return async function apiKeyAuth(req, res, next) {
    const { plaintext, prefix } = presentedKey(req);
    const record = await prisma.apiKey.findUnique({ where: { keyPrefix: prefix } });

    // The comparison runs even when the prefix is unknown, so a caller cannot
    // tell an unknown key from a wrong one by timing the response.
    const matches = constantTimeEquals(record?.keyHash ?? ABSENT_KEY_HASH, hashApiKey(plaintext));

    if (!record || !matches || record.revokedAt) {
      throw new UnauthorizedError('The API key is unknown, revoked or incorrect');
    }

    req.auth = { apiKeyId: record.id, projectId: record.projectId };

    touch(record);

    next();
  };
}
