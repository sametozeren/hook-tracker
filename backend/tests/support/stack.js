import { pino } from 'pino';
import { inject } from 'vitest';
import { config } from '../../src/shared/config.js';
import { createPrismaClient } from '../../src/shared/db.js';
import { closeQuietly, createQueueConnection } from '../../src/shared/queue/connection.js';
import { createRedisClient } from '../../src/shared/redis.js';

const CONNECT_ATTEMPTS = 10;

const CONNECT_BASE_DELAY_MS = 250;

export function stackUrls() {
  return inject('stackUrls');
}

// Clients are per file, the containers behind them are not: a file that closes
// its own connections cannot disturb the next one.
export async function openClients({ prefetch, subscriber = false } = {}) {
  const urls = stackUrls();

  return {
    prisma: createPrismaClient({ connectionString: urls.databaseUrl }),
    redis: createRedisClient({ url: urls.redisUrl }),
    subscriber: subscriber ? createRedisClient({ url: urls.redisUrl }) : undefined,
    queue: await createQueueConnection({
      url: urls.amqpUrl,
      attempts: CONNECT_ATTEMPTS,
      baseDelayMs: CONNECT_BASE_DELAY_MS,
      prefetch,
    }),
  };
}

export async function closeClients({ prisma, redis, subscriber, queue }) {
  await closeQuietly(queue?.channel);
  await closeQuietly(queue?.connection);
  await subscriber?.quit();
  await redis?.quit();
  await prisma?.$disconnect();
}

export function testConfig(overrides = {}) {
  return { ...config, NODE_ENV: 'test', CORS_ORIGINS: [], ...overrides };
}

export function silentLogger() {
  return pino({ level: 'silent' });
}
