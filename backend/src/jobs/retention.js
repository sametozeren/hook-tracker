const MS_PER_DAY = 86_400_000;

// Retention walks a window measured in days, so the pass cadence only decides
// how far past the cutoff a row can linger. Hourly keeps that bounded without
// adding a knob whose value nobody would ever tune.
export const RETENTION_INTERVAL_MS = 3_600_000;

const DEFAULT_BATCH_SIZE = 500;

// A pass is bounded as well as its batches: an install that has never run
// retention should shed its backlog over several passes rather than hold the
// connection for one very long pass.
const DEFAULT_MAX_BATCHES = 20;

export function retentionCutoff(now, retentionDays) {
  return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}

export function createRetentionJob({
  prisma,
  config,
  logger,
  now = () => new Date(),
  batchSize = DEFAULT_BATCH_SIZE,
  maxBatches = DEFAULT_MAX_BATCHES,
}) {
  // Prisma's deleteMany takes no limit, so the batch is selected first and
  // deleted by id: an explicit ceiling per statement, never one unbounded
  // delete holding a long transaction over a month of events.
  async function deleteBatch(cutoff) {
    const stale = await prisma.webhookEvent.findMany({
      where: { receivedAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { receivedAt: 'asc' },
      take: batchSize,
    });

    if (stale.length === 0) {
      return 0;
    }

    const { count } = await prisma.webhookEvent.deleteMany({
      where: { id: { in: stale.map((event) => event.id) } },
    });

    return count;
  }

  return async function runRetention() {
    const cutoff = retentionCutoff(now(), config.RETENTION_DAYS);

    let deleted = 0;
    let batches = 0;

    while (batches < maxBatches) {
      const count = await deleteBatch(cutoff);

      batches += 1;
      deleted += count;

      if (count < batchSize) {
        break;
      }
    }

    logger?.info(
      { cutoff, deleted, batches, retentionDays: config.RETENTION_DAYS },
      'retention pass finished',
    );

    return { cutoff, deleted, batches };
  };
}
