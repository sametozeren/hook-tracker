import { describe, expect, it } from 'vitest';
import { createRetentionJob, retentionCutoff } from '../../src/jobs/retention.js';

const DAY_MS = 86_400_000;

function eventsOlderThan(count, cutoffOffsetDays, prefix = 'evt') {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}_${index}`,
    receivedAt: new Date(Date.now() - cutoffOffsetDays * DAY_MS - index),
  }));
}

function fakePrisma(rows) {
  const takes = [];
  const deletes = [];

  return {
    takes,
    deletes,
    webhookEvent: {
      async findMany({ where, take }) {
        takes.push(take);

        return rows.filter((row) => row.receivedAt < where.receivedAt.lt).slice(0, take);
      },
      async deleteMany({ where }) {
        const ids = new Set(where.id.in);

        deletes.push(where.id.in.length);

        const before = rows.length;

        for (const row of [...rows]) {
          if (ids.has(row.id)) {
            rows.splice(rows.indexOf(row), 1);
          }
        }

        return { count: before - rows.length };
      },
    },
  };
}

describe('retentionCutoff', () => {
  it('places the cutoff exactly RETENTION_DAYS before the given moment', () => {
    const now = new Date('2026-03-01T12:00:00.000Z');

    expect(retentionCutoff(now, 30).toISOString()).toBe('2026-01-30T12:00:00.000Z');
    expect(retentionCutoff(now, 1).toISOString()).toBe('2026-02-28T12:00:00.000Z');
  });
});

describe('createRetentionJob', () => {
  it('deletes in batches of the configured size and stops on a short batch', async () => {
    const rows = eventsOlderThan(5, 40);
    const prisma = fakePrisma(rows);

    const run = createRetentionJob({
      prisma,
      config: { RETENTION_DAYS: 30 },
      batchSize: 2,
    });

    const result = await run();

    expect(result.deleted).toBe(5);
    expect(result.batches).toBe(3);
    expect(prisma.takes).toEqual([2, 2, 2]);
    expect(prisma.deletes).toEqual([2, 2, 1]);
    expect(rows).toHaveLength(0);
  });

  it('bounds a single pass by maxBatches and leaves the rest for the next one', async () => {
    const rows = eventsOlderThan(10, 40);
    const prisma = fakePrisma(rows);

    const run = createRetentionJob({
      prisma,
      config: { RETENTION_DAYS: 30 },
      batchSize: 2,
      maxBatches: 3,
    });

    const result = await run();

    expect(result.deleted).toBe(6);
    expect(result.batches).toBe(3);
    expect(rows).toHaveLength(4);
  });

  it('never selects a row newer than the cutoff', async () => {
    const rows = [...eventsOlderThan(2, 40, 'old'), ...eventsOlderThan(3, 1, 'new')];
    const prisma = fakePrisma(rows);

    const run = createRetentionJob({
      prisma,
      config: { RETENTION_DAYS: 30 },
      batchSize: 10,
    });

    const result = await run();

    expect(result.deleted).toBe(2);
    expect(rows).toHaveLength(3);
  });

  it('issues one query and deletes nothing when the window is empty', async () => {
    const prisma = fakePrisma([]);

    const run = createRetentionJob({ prisma, config: { RETENTION_DAYS: 30 } });

    const result = await run();

    expect(result).toMatchObject({ deleted: 0, batches: 1 });
    expect(prisma.deletes).toEqual([]);
  });

  it('takes the cutoff from the injected clock', async () => {
    const rows = eventsOlderThan(1, 10);
    const prisma = fakePrisma(rows);
    const now = new Date(Date.now() + 25 * DAY_MS);

    const run = createRetentionJob({
      prisma,
      config: { RETENTION_DAYS: 30 },
      now: () => now,
    });

    const result = await run();

    expect(result.cutoff).toEqual(retentionCutoff(now, 30));
    expect(result.deleted).toBe(1);
  });
});
