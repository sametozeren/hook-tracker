import { sha256Hex } from '../../shared/crypto.js';
import { ConflictError } from '../../shared/errors.js';
import { canonicalJson } from '../../shared/json.js';

const RESERVED = 'reserved';

// The target set belongs in the key: the same body aimed at two different
// endpoint lists is two different publishes. A body without endpointIds hashes
// to exactly what it hashed before the targets were folded in, so keys already
// issued against a live window keep replaying instead of silently expiring.
export function defaultIdempotencyKey({ eventType, payload, endpointIds }) {
  const targets = endpointIds?.length ? canonicalJson([...new Set(endpointIds)].sort()) : '';

  return sha256Hex(`${eventType}${canonicalJson(payload)}${targets}`);
}

export function createIdempotency({ redis, ttlSeconds }) {
  return async function idempotency(req, res, next) {
    const key = req.get('idempotency-key') ?? defaultIdempotencyKey(req.validated);
    const redisKey = `idem:${req.auth.projectId}:${sha256Hex(key)}`;
    const reserved = await redis.set(redisKey, RESERVED, 'EX', ttlSeconds, 'NX');

    if (!reserved) {
      const stored = await redis.get(redisKey);

      if (!stored || stored === RESERVED) {
        throw new ConflictError(
          'A request with this Idempotency-Key is still in flight; retry once it completes',
        );
      }

      const original = JSON.parse(stored);

      res.setHeader('Idempotency-Replayed', 'true');
      res.status(original.status).json(original.body);

      return;
    }

    let stored = false;

    req.idempotency = {
      key,
      store: async (status, body) => {
        stored = true;

        await redis.set(redisKey, JSON.stringify({ status, body }), 'EX', ttlSeconds);
      },
    };

    // A reservation that never produced a response would lock the key for the
    // whole TTL, so a failed request releases it on the way out.
    res.on('finish', () => {
      if (stored || res.statusCode < 400) {
        return;
      }

      redis.del(redisKey).catch(() => {});
    });

    next();
  };
}
