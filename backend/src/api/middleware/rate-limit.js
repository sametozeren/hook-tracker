import { randomUUID } from 'node:crypto';
import { RateLimitedError } from '../../shared/errors.js';

const WINDOW_MS = 60_000;

// A sorted set of request timestamps: entries older than the window are dropped
// on every call, so the window slides instead of resetting on a fixed boundary.
export function createRateLimiter({
  redis,
  limit,
  windowMs = WINDOW_MS,
  keyPrefix = 'ratelimit:publish',
  identify = (req) => req.auth.apiKeyId,
}) {
  async function resetSeconds(key, now) {
    const [, oldestScore] = await redis.zrange(key, 0, 0, 'WITHSCORES');

    if (!oldestScore) {
      return Math.ceil(windowMs / 1000);
    }

    return Math.max(1, Math.ceil((Number(oldestScore) + windowMs - now) / 1000));
  }

  return async function rateLimit(req, res, next) {
    const key = `${keyPrefix}:${identify(req)}`;
    const now = Date.now();
    const member = `${now}-${randomUUID()}`;

    const results = await redis
      .multi()
      .zremrangebyscore(key, 0, now - windowMs)
      .zadd(key, now, member)
      .zcard(key)
      .pexpire(key, windowMs)
      .exec();

    const used = Number(results[2][1]);
    const reset = await resetSeconds(key, now);

    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - used)));
    res.setHeader('RateLimit-Reset', String(reset));

    if (used <= limit) {
      next();

      return;
    }

    // The rejected call is removed again: a client that keeps hammering would
    // otherwise keep pushing its own window forward and never recover.
    await redis.zrem(key, member);

    throw new RateLimitedError(`${limit} requests per minute allowed for this API key`, {
      'Retry-After': String(reset),
      'RateLimit-Limit': String(limit),
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(reset),
    });
  };
}
