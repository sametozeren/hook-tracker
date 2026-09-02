import { Router } from 'express';
import { pingDatabase } from '../../shared/db.js';
import { createChannel } from '../../shared/queue/connection.js';
import { pingRedis } from '../../shared/redis.js';

// The driver messages carry the internal host and port that could not be
// reached — `connect ECONNREFUSED 10.0.3.14:5432`. /ready is unauthenticated,
// so the caller learns only which dependency is down; the reason stays in the
// log, where the operator reads it.
async function probe(name, run, logger) {
  try {
    await run();

    return { name, ok: true };
  } catch (error) {
    logger?.warn({ check: name, reason: error.message }, 'readiness probe failed');

    return { name, ok: false };
  }
}

export function createHealthRouter({ prisma, redis, connection, logger }) {
  const router = Router();

  router.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  router.get('/ready', async (req, res) => {
    const checks = await Promise.all([
      probe('postgres', () => pingDatabase(prisma), logger),
      probe('redis', () => pingRedis(redis), logger),
      probe(
        'rabbitmq',
        async () => {
          const channel = await createChannel(connection);

          await channel.close();
        },
        logger,
      ),
    ]);

    const ready = checks.every((check) => check.ok);

    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', checks });
  });

  return router;
}
