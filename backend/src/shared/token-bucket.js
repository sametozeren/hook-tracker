// Refill and take in one round trip: two workers asking at the same moment must
// not both read the same token count and both spend it.
const TAKE_TOKEN = `
local key = KEYS[1]
local ratePerMinute = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local state = redis.call('HMGET', key, 'tokens', 'updatedAt')
local tokens = tonumber(state[1])
local updatedAt = tonumber(state[2])

if tokens == nil or updatedAt == nil then
  tokens = capacity
  updatedAt = now
end

local elapsed = now - updatedAt

if elapsed > 0 then
  tokens = math.min(capacity, tokens + elapsed * ratePerMinute / 60000)
end

local allowed = 0

if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'updatedAt', now)
redis.call('PEXPIRE', key, ttl)

return allowed
`;

const TTL_MS = 300_000;

export function createTokenBucket({ redis, keyPrefix = 'bucket:endpoint', ttlMs = TTL_MS }) {
  redis.defineCommand('hookTrackerTakeToken', { numberOfKeys: 1, lua: TAKE_TOKEN });

  return {
    async take({ endpointId, ratePerMinute, now = Date.now() }) {
      const allowed = await redis.hookTrackerTakeToken(
        `${keyPrefix}:${endpointId}`,
        ratePerMinute,
        ratePerMinute,
        now,
        ttlMs,
      );

      return allowed === 1;
    },
  };
}
