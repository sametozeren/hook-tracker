import { config } from '../shared/config.js';
import { disconnectDatabase, prisma } from '../shared/db.js';
import { closeServer, onShutdown } from '../shared/lifecycle.js';
import { createLogger } from '../shared/logger.js';
import { createQueueConnection } from '../shared/queue/connection.js';
import { createPublisher } from '../shared/queue/publisher.js';
import { assertTopology, createTopology } from '../shared/queue/topology.js';
import { createRedisClient } from '../shared/redis.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime/socket.js';

const logger = createLogger('api');

const redis = createRedisClient();
const queue = await createQueueConnection({ url: config.RABBITMQ_URL, logger });
const topology = createTopology();

await assertTopology(queue.channel, topology);

const publisher = createPublisher({ channel: queue.channel, topology });

const app = createApp({
  prisma,
  redis,
  publisher,
  connection: queue.connection,
  config,
  logger,
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api listening');
});

const realtime = attachRealtime({ server, prisma, redis, config, logger });

onShutdown({
  logger,
  graceMs: config.SHUTDOWN_GRACE_MS,
  close: async () => {
    await realtime.close();
    await closeServer(server);
    await queue.close();
    await redis.quit();
    await disconnectDatabase();
  },
});
