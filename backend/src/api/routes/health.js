import { Router } from 'express';
import { pingDatabase } from '../../shared/db.js';
import { createChannel } from '../../shared/queue/connection.js';
import { pingRedis } from '../../shared/redis.js';

async function probe(name, run) {
  try {
    await run();

    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, reason: error.message };
  }
}

export function createHealthRouter({ prisma, redis, connection }) {
  const router = Router();

  router.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  router.get('/ready', async (req, res) => {
    const checks = await Promise.all([
      probe('postgres', () => pingDatabase(prisma)),
      probe('redis', () => pingRedis(redis)),
      probe('rabbitmq', async () => {
        const channel = await createChannel(connection);

        await channel.close();
      }),
    ]);

    const ready = checks.every((check) => check.ok);

    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', checks });
  });

  return router;
}
