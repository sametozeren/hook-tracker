import { createAlertDispatcher } from '../shared/alerts.js';
import { config } from '../shared/config.js';
import { disconnectDatabase, prisma } from '../shared/db.js';
import { onShutdown } from '../shared/lifecycle.js';
import { createLogger } from '../shared/logger.js';
import { createQueueConnection } from '../shared/queue/connection.js';
import { createRedisClient } from '../shared/redis.js';
import { createPublisher } from '../shared/queue/publisher.js';
import { assertTopology, createTopology } from '../shared/queue/topology.js';
import { ALERT_WATCH_INTERVAL_MS, createAlertWatch } from './alert-watch.js';
import { RETENTION_INTERVAL_MS, createRetentionJob } from './retention.js';
import { createScheduleRunner } from './schedule.js';
import { createStuckSweeper, sweepIntervalMs } from './stuck-sweeper.js';

const logger = createLogger('jobs');

const redis = createRedisClient();

const queue = await createQueueConnection({ url: config.RABBITMQ_URL, logger });

const topology = createTopology();

await assertTopology(queue.channel, topology);

const publisher = createPublisher({ channel: queue.channel, topology });

const alerts = createAlertDispatcher({ prisma, redis, config, logger });

const schedules = createScheduleRunner({ logger });

const stuckSweepIntervalMs = sweepIntervalMs(config.STUCK_DELIVERY_MINUTES);

schedules.every({
  name: 'retention',
  intervalMs: RETENTION_INTERVAL_MS,
  run: createRetentionJob({ prisma, config, logger }),
});

schedules.every({
  name: 'stuck-sweeper',
  intervalMs: stuckSweepIntervalMs,
  run: createStuckSweeper({ prisma, publisher, config, logger }),
});

schedules.every({
  name: 'alert-watch',
  intervalMs: ALERT_WATCH_INTERVAL_MS,
  run: createAlertWatch({
    prisma,
    redis,
    channel: queue.channel,
    topology,
    alerts,
    config,
    logger,
  }),
});

logger.info(
  {
    retentionDays: config.RETENTION_DAYS,
    retentionIntervalMs: RETENTION_INTERVAL_MS,
    stuckDeliveryMinutes: config.STUCK_DELIVERY_MINUTES,
    stuckSweepIntervalMs,
    alertWatchIntervalMs: ALERT_WATCH_INTERVAL_MS,
    alertDlqThreshold: config.ALERT_DLQ_THRESHOLD,
  },
  'jobs scheduled',
);

onShutdown({
  logger,
  graceMs: config.SHUTDOWN_GRACE_MS,
  close: async () => {
    await schedules.stop();
    await queue.close();
    await redis.quit();
    await disconnectDatabase();
  },
});
