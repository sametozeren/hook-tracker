import { describe, expect, it } from 'vitest';
import { DELIVERY_STATUS } from '../../src/shared/delivery-status.js';
import {
  STUCK_RECOVERY_ERROR,
  createStuckSweeper,
  stuckCutoff,
  stuckDeliveryFilter,
  sweepIntervalMs,
} from '../../src/jobs/stuck-sweeper.js';

const MINUTE_MS = 60_000;

function fakePrisma(rows, { claimable = () => true } = {}) {
  const updates = [];

  return {
    updates,
    delivery: {
      async findMany({ take }) {
        return rows.slice(0, take);
      },
      async updateMany({ where, data }) {
        updates.push({ where, data });

        if (data.status === DELIVERY_STATUS.RETRYING && !claimable(where.id)) {
          return { count: 0 };
        }

        return { count: 1 };
      },
    },
  };
}

function fakePublisher(onPublish = async () => {}) {
  const published = [];

  return {
    published,
    async publishDelivery(message) {
      published.push(message);

      await onPublish(message);
    },
  };
}

const config = { STUCK_DELIVERY_MINUTES: 15 };

describe('stuckCutoff', () => {
  it('places the cutoff exactly STUCK_DELIVERY_MINUTES before the given moment', () => {
    const now = new Date('2026-03-01T12:00:00.000Z');

    expect(stuckCutoff(now, 15).toISOString()).toBe('2026-03-01T11:45:00.000Z');
  });
});

describe('sweepIntervalMs', () => {
  it('sweeps several times per threshold', () => {
    expect(sweepIntervalMs(15)).toBe(5 * MINUTE_MS);
    expect(sweepIntervalMs(60)).toBe(20 * MINUTE_MS);
  });

  it('never drops below a minute, however small the threshold is', () => {
    expect(sweepIntervalMs(1)).toBe(MINUTE_MS);
    expect(sweepIntervalMs(2)).toBe(MINUTE_MS);
  });
});

describe('stuckDeliveryFilter', () => {
  it('covers a scheduled retry and a first attempt, which carries no nextAttemptAt', () => {
    const cutoff = new Date('2026-03-01T11:45:00.000Z');

    expect(stuckDeliveryFilter(cutoff)).toEqual({
      status: DELIVERY_STATUS.IN_FLIGHT,
      OR: [{ nextAttemptAt: { lt: cutoff } }, { nextAttemptAt: null, createdAt: { lt: cutoff } }],
    });
  });
});

describe('createStuckSweeper', () => {
  it('claims a stuck delivery and re-publishes it as the next attempt', async () => {
    const prisma = fakePrisma([{ id: 'dlv_1', attemptCount: 2 }]);
    const publisher = fakePublisher();

    const run = createStuckSweeper({ prisma, publisher, config });
    const result = await run();

    expect(result).toMatchObject({ examined: 1, recovered: 1 });
    expect(publisher.published).toEqual([{ deliveryId: 'dlv_1', attempt: 3 }]);
    expect(prisma.updates[0].data).toEqual({
      status: DELIVERY_STATUS.RETRYING,
      lastError: STUCK_RECOVERY_ERROR,
    });
    expect(prisma.updates[0].where.status).toBe(DELIVERY_STATUS.IN_FLIGHT);
  });

  it('publishes nothing for a delivery another process already moved on', async () => {
    const prisma = fakePrisma([{ id: 'dlv_1', attemptCount: 1 }], { claimable: () => false });
    const publisher = fakePublisher();

    const run = createStuckSweeper({ prisma, publisher, config });
    const result = await run();

    expect(result).toMatchObject({ examined: 1, recovered: 0 });
    expect(publisher.published).toEqual([]);
  });

  it('returns a delivery to IN_FLIGHT when the publish fails', async () => {
    const prisma = fakePrisma([{ id: 'dlv_1', attemptCount: 1 }]);

    const publisher = fakePublisher(async () => {
      throw new Error('broker unavailable');
    });

    const run = createStuckSweeper({ prisma, publisher, config });

    await expect(run()).rejects.toThrow('broker unavailable');

    expect(prisma.updates.at(-1)).toEqual({
      where: { id: 'dlv_1', status: DELIVERY_STATUS.RETRYING },
      data: { status: DELIVERY_STATUS.IN_FLIGHT },
    });
  });

  it('bounds the pass by the batch size', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      id: `dlv_${index}`,
      attemptCount: 0,
    }));

    const prisma = fakePrisma(rows);
    const publisher = fakePublisher();

    const run = createStuckSweeper({ prisma, publisher, config, batchSize: 2 });
    const result = await run();

    expect(result).toMatchObject({ examined: 2, recovered: 2 });
    expect(publisher.published).toHaveLength(2);
  });

  it('takes the cutoff from the injected clock', async () => {
    const now = new Date('2026-03-01T12:00:00.000Z');
    const prisma = fakePrisma([]);

    const run = createStuckSweeper({ prisma, publisher: fakePublisher(), config, now: () => now });
    const result = await run();

    expect(result.cutoff).toEqual(stuckCutoff(now, 15));
  });
});
