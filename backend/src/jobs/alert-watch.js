import { ALERT_REASON } from '../shared/alerts.js';

// Slower than the other jobs on purpose: both conditions it watches are
// instance-wide and outlive a single pass, and a short interval would turn one
// outage into an alert every few seconds for every project.
export const ALERT_WATCH_INTERVAL_MS = 300_000;

export function createAlertWatch({ prisma, redis, channel, topology, alerts, config, logger }) {
  async function deadLetterDepth() {
    const info = await channel.checkQueue(topology.deadLetterQueue);

    return info.messageCount;
  }

  async function watchDeadLetterQueue() {
    const depth = await deadLetterDepth();

    if (depth < config.ALERT_DLQ_THRESHOLD) {
      return;
    }

    await alerts.notifyConfiguredProjects({
      reason: ALERT_REASON.DEAD_LETTER_BACKLOG,
      detail: { queue: topology.deadLetterQueue, depth, threshold: config.ALERT_DLQ_THRESHOLD },
    });
  }

  // Postgres is checked but never alerted on: the addresses to alert live in
  // Postgres, so an outage there takes the routing table down with it. It is
  // logged instead, and `GET /ready` remains the check that answers for it.
  async function watchDependencies() {
    const probes = [
      { name: 'redis', probe: () => redis.ping() },
      { name: 'rabbitmq', probe: () => channel.checkQueue(topology.deliveryQueue) },
      { name: 'postgres', probe: () => prisma.$queryRaw`SELECT 1`, alertable: false },
    ];

    for (const { name, probe, alertable = true } of probes) {
      try {
        await probe();
      } catch (error) {
        logger?.error({ dependency: name, reason: error.message }, 'dependency unreachable');

        if (alertable) {
          await alerts.notifyConfiguredProjects({
            reason: ALERT_REASON.DEPENDENCY_UNREACHABLE,
            scope: name,
            detail: { dependency: name },
          });
        }
      }
    }
  }

  return async function runAlertWatch() {
    await watchDependencies();
    await watchDeadLetterQueue();
  };
}
