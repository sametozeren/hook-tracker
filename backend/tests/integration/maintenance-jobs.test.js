import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRetentionJob } from '../../src/jobs/retention.js';
import { createStuckSweeper } from '../../src/jobs/stuck-sweeper.js';
import { DELIVERY_STATUS } from '../../src/shared/delivery-status.js';
import { createPublisher } from '../../src/shared/queue/publisher.js';
import { assertTopology, createTopology } from '../../src/shared/queue/topology.js';
import { recordInto } from '../support/consume.js';
import {
  createAttempt,
  createDelivery,
  createEndpoint,
  createProject,
} from '../support/fixtures.js';
import { waitFor } from '../support/poll.js';
import { closeClients, openClients, silentLogger, testConfig } from '../support/stack.js';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

const RETENTION_DAYS = 30;
const STUCK_DELIVERY_MINUTES = 15;

// Both jobs read their window from the clock, so the rows carry explicit
// timestamps on either side of the cutoff rather than the suite waiting for one.
const jobsConfig = testConfig({ RETENTION_DAYS, STUCK_DELIVERY_MINUTES });

const topology = createTopology({ namespace: 'itest-jobs' });

const delivered = [];

let clients;
let prisma;
let publisher;
let project;
let endpoint;

function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS);
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * MINUTE_MS);
}

function seedDelivery(overrides) {
  return createDelivery(prisma, {
    projectId: project.id,
    endpointId: endpoint.id,
    ...overrides,
  });
}

beforeAll(async () => {
  clients = await openClients();
  prisma = clients.prisma;

  await assertTopology(clients.queue.channel, topology);

  publisher = createPublisher({ channel: clients.queue.channel, topology });

  project = await createProject(prisma, 'jobs');
  endpoint = await createEndpoint(prisma, {
    projectId: project.id,
    url: 'https://receiver.example/hook',
  });

  await recordInto(clients.queue.channel, topology.deliveryQueue, delivered);
});

afterAll(async () => {
  await closeClients(clients);
});

describe('retention', () => {
  it('deletes events past the cutoff and cascades to their deliveries and attempts', async () => {
    const stale = await seedDelivery({
      receivedAt: daysAgo(40),
      status: DELIVERY_STATUS.SUCCEEDED,
      attemptCount: 1,
    });

    const recent = await seedDelivery({ receivedAt: daysAgo(1) });

    await createAttempt(prisma, { deliveryId: stale.id, responseStatus: 200 });
    await createAttempt(prisma, { deliveryId: recent.id, responseStatus: 200 });

    const run = createRetentionJob({ prisma, config: jobsConfig, logger: silentLogger() });
    const result = await run();

    expect(result.deleted).toBe(1);
    expect(result.cutoff.getTime()).toBeLessThan(Date.now());

    expect(await prisma.webhookEvent.findUnique({ where: { id: stale.eventId } })).toBeNull();
    expect(await prisma.delivery.count({ where: { id: stale.id } })).toBe(0);
    expect(await prisma.deliveryAttempt.count({ where: { deliveryId: stale.id } })).toBe(0);

    expect(await prisma.webhookEvent.count({ where: { id: recent.eventId } })).toBe(1);
    expect(await prisma.delivery.count({ where: { id: recent.id } })).toBe(1);
    expect(await prisma.deliveryAttempt.count({ where: { deliveryId: recent.id } })).toBe(1);
  });

  it('clears a backlog in bounded batches rather than one statement', async () => {
    for (let index = 0; index < 3; index += 1) {
      await seedDelivery({ receivedAt: daysAgo(60 + index) });
    }

    const run = createRetentionJob({
      prisma,
      config: jobsConfig,
      logger: silentLogger(),
      batchSize: 2,
    });

    const result = await run();

    expect(result).toMatchObject({ deleted: 3, batches: 2 });
    expect(
      await prisma.webhookEvent.count({
        where: { projectId: project.id, receivedAt: { lt: result.cutoff } },
      }),
    ).toBe(0);
  });
});

describe('stuck sweeper', () => {
  it('returns a stuck delivery to RETRYING and puts it back on the delivery queue', async () => {
    const stuck = await seedDelivery({
      status: DELIVERY_STATUS.IN_FLIGHT,
      attemptCount: 2,
      nextAttemptAt: minutesAgo(45),
    });

    const inProgress = await seedDelivery({
      status: DELIVERY_STATUS.IN_FLIGHT,
      attemptCount: 1,
      nextAttemptAt: minutesAgo(1),
    });

    const run = createStuckSweeper({
      prisma,
      publisher,
      config: jobsConfig,
      logger: silentLogger(),
    });

    const result = await run();

    expect(result).toMatchObject({ examined: 1, recovered: 1 });

    const message = await waitFor(() => delivered.find((body) => body.deliveryId === stuck.id));

    expect(message).toEqual({ deliveryId: stuck.id, attempt: 3 });

    expect((await prisma.delivery.findUnique({ where: { id: stuck.id } })).status).toBe(
      DELIVERY_STATUS.RETRYING,
    );
    expect((await prisma.delivery.findUnique({ where: { id: inProgress.id } })).status).toBe(
      DELIVERY_STATUS.IN_FLIGHT,
    );
  });

  it('sweeps a first attempt as well, which carries no nextAttemptAt', async () => {
    const stuck = await seedDelivery({
      status: DELIVERY_STATUS.IN_FLIGHT,
      createdAt: minutesAgo(30),
    });

    const run = createStuckSweeper({
      prisma,
      publisher,
      config: jobsConfig,
      logger: silentLogger(),
    });

    const result = await run();

    expect(result).toMatchObject({ examined: 1, recovered: 1 });

    const message = await waitFor(() => delivered.find((body) => body.deliveryId === stuck.id));

    expect(message).toEqual({ deliveryId: stuck.id, attempt: 1 });
  });
});
