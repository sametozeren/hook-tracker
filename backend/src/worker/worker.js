import { createAlertDispatcher } from '../shared/alerts.js';
import { config } from '../shared/config.js';
import { disconnectDatabase, prisma } from '../shared/db.js';
import { onShutdown } from '../shared/lifecycle.js';
import { createLogger } from '../shared/logger.js';
import { createQueueConnection } from '../shared/queue/connection.js';
import { createPublisher } from '../shared/queue/publisher.js';
import { assertTopology, createTopology } from '../shared/queue/topology.js';
import { createRealtimePublisher } from '../shared/realtime.js';
import { createRedisClient } from '../shared/redis.js';
import { createTokenBucket } from '../shared/token-bucket.js';
import { createDeliveryHandler } from './handle-delivery.js';

const DRAIN_POLL_MS = 50;

const DRAIN_SHARE = 0.8;

const logger = createLogger('worker');

const redis = createRedisClient();
const queue = await createQueueConnection({
  url: config.RABBITMQ_URL,
  logger,
  prefetch: config.WORKER_PREFETCH,
});

const topology = createTopology();

await assertTopology(queue.channel, topology);

const handleDelivery = createDeliveryHandler({
  prisma,
  publisher: createPublisher({
    channel: queue.channel,
    topology,
    deadLetterTtlMs: config.DLQ_MESSAGE_TTL_HOURS * 60 * 60 * 1000,
  }),
  realtime: createRealtimePublisher({ redis, logger }),
  tokenBucket: createTokenBucket({ redis }),
  alerts: createAlertDispatcher({ prisma, redis, config, logger }),
  config,
  logger,
});

let inFlight = 0;

const { consumerTag } = await queue.channel.consume(topology.deliveryQueue, async (message) => {
  if (!message) {
    return;
  }

  inFlight += 1;

  let body;

  try {
    body = JSON.parse(message.content.toString('utf8'));

    const result = await handleDelivery(body);

    logger.info(
      { deliveryId: body.deliveryId, attempt: body.attempt, outcome: result.outcome },
      'delivery handled',
    );

    queue.channel.ack(message);
  } catch (error) {
    logger.error(
      { deliveryId: body?.deliveryId, attempt: body?.attempt, reason: error.message },
      'delivery handling failed',
    );

    // One requeue, then the message is acked and the row is left IN_FLIGHT for
    // the stuck sweeper. Requeueing forever would spin on a message this
    // worker cannot process at all.
    if (message.fields.redelivered) {
      queue.channel.ack(message);
    } else {
      queue.channel.nack(message, false, true);
    }
  } finally {
    inFlight -= 1;
  }
});

logger.info(
  { queue: topology.deliveryQueue, prefetch: config.WORKER_PREFETCH },
  'worker consuming',
);

async function drain(deadline) {
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise((resolve) => {
      setTimeout(resolve, DRAIN_POLL_MS);
    });
  }
}

onShutdown({
  logger,
  graceMs: config.SHUTDOWN_GRACE_MS,
  close: async () => {
    try {
      await queue.channel.cancel(consumerTag);
    } catch (error) {
      logger.warn({ reason: error.message }, 'cancelling the consumer failed');
    }

    // The drain gets a share of the grace period rather than all of it: the
    // closes below still need room before the force-exit timer fires.
    await drain(Date.now() + config.SHUTDOWN_GRACE_MS * DRAIN_SHARE);

    if (inFlight > 0) {
      logger.warn({ inFlight }, 'grace period elapsed with attempts still in flight');
    }

    await queue.close();
    await redis.quit();
    await disconnectDatabase();
  },
});
