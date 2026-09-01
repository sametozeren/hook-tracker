import { DELIVERY_STATUS } from '../shared/delivery-status.js';

const MS_PER_MINUTE = 60_000;

const SWEEPS_PER_THRESHOLD = 3;

const MIN_SWEEP_INTERVAL_MS = MS_PER_MINUTE;

const DEFAULT_BATCH_SIZE = 200;

export const STUCK_RECOVERY_ERROR = 'recovered by the stuck-delivery sweeper';

export function stuckCutoff(now, stuckMinutes) {
  return new Date(now.getTime() - stuckMinutes * MS_PER_MINUTE);
}

// The interval is derived from the threshold rather than configured on its own:
// the only sane value is a fraction of the threshold, and sweeping several
// times per threshold keeps recovery latency near it instead of twice it.
export function sweepIntervalMs(stuckMinutes) {
  const derived = Math.round((stuckMinutes * MS_PER_MINUTE) / SWEEPS_PER_THRESHOLD);

  return Math.max(MIN_SWEEP_INTERVAL_MS, derived);
}

// A delivery on its first attempt has no nextAttemptAt, so createdAt is the
// only timestamp bounding how long it can have been in flight.
export function stuckDeliveryFilter(cutoff) {
  return {
    status: DELIVERY_STATUS.IN_FLIGHT,
    OR: [{ nextAttemptAt: { lt: cutoff } }, { nextAttemptAt: null, createdAt: { lt: cutoff } }],
  };
}

export function createStuckSweeper({
  prisma,
  publisher,
  config,
  logger,
  now = () => new Date(),
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  // The claim is the whole concurrency story: the status is part of the
  // predicate, so a worker that commits its own outcome first, or a second
  // sweeper, leaves this update matching nothing and no message is published.
  async function claim(deliveryId) {
    const { count } = await prisma.delivery.updateMany({
      where: { id: deliveryId, status: DELIVERY_STATUS.IN_FLIGHT },
      data: { status: DELIVERY_STATUS.RETRYING, lastError: STUCK_RECOVERY_ERROR },
    });

    return count === 1;
  }

  // Nothing consumes a RETRYING row without a message behind it, so a failed
  // publish is put back to IN_FLIGHT and picked up by the next sweep.
  async function release(deliveryId) {
    await prisma.delivery.updateMany({
      where: { id: deliveryId, status: DELIVERY_STATUS.RETRYING },
      data: { status: DELIVERY_STATUS.IN_FLIGHT },
    });
  }

  async function recover(delivery) {
    if (!(await claim(delivery.id))) {
      return false;
    }

    try {
      await publisher.publishDelivery({
        deliveryId: delivery.id,
        attempt: delivery.attemptCount + 1,
      });
    } catch (error) {
      await release(delivery.id);

      throw error;
    }

    return true;
  }

  return async function runStuckSweep() {
    const cutoff = stuckCutoff(now(), config.STUCK_DELIVERY_MINUTES);

    const stuck = await prisma.delivery.findMany({
      where: stuckDeliveryFilter(cutoff),
      select: { id: true, attemptCount: true },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    let recovered = 0;

    for (const delivery of stuck) {
      if (await recover(delivery)) {
        recovered += 1;
      }
    }

    logger?.info(
      { cutoff, examined: stuck.length, recovered, stuckMinutes: config.STUCK_DELIVERY_MINUTES },
      'stuck sweep finished',
    );

    return { cutoff, examined: stuck.length, recovered };
  };
}
