import Redis from 'ioredis';
import { config } from './config.js';

export function createRedisClient({ url = config.REDIS_URL, ...options } = {}) {
  return new Redis(url, { maxRetriesPerRequest: 3, ...options });
}

export async function pingRedis(client) {
  const reply = await client.ping();

  if (reply !== 'PONG') {
    throw new Error(`unexpected redis ping reply: ${reply}`);
  }
}
