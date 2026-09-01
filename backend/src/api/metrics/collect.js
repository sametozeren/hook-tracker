import { Prisma } from '../../shared/db.js';
import { DELIVERY_STATUS_VALUES, ENDPOINT_STATUS } from '../../shared/delivery-status.js';
import { closeQuietly, createChannel } from '../../shared/queue/connection.js';
import { allQueueNames, createTopology } from '../../shared/queue/topology.js';
import { summariseObservations } from './histogram.js';
import { attemptOutcome, responseClass } from './labels.js';

const MILLISECONDS_PER_SECOND = 1000;

// Seeded at zero so the series a dashboard plots exist before the first
// delivery. Only the reachable combinations are seeded: a 2xx is what makes an
// attempt a success, and an attempt that never got a response is a failure.
const SEEDED_ATTEMPT_LABELS = Object.freeze([
  Object.freeze({ outcome: 'success', responseClass: '2xx' }),
  Object.freeze({ outcome: 'failure', responseClass: '4xx' }),
  Object.freeze({ outcome: 'failure', responseClass: '5xx' }),
  Object.freeze({ outcome: 'failure', responseClass: 'none' }),
]);

export const DURATION_BUCKET_SECONDS = Object.freeze([0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]);

// Bounded well under Prometheus's default scrape_timeout (10s of a 15s
// scrape_interval), so a hung source (a broker socket that accepts but never
// answers, a pool waiting on its own timeout) still lets the response return
// before the scraper gives up on the whole request.
export const SOURCE_TIMEOUT_MS = 2000;

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function safely(collect, { source, logger, timeoutMs }) {
  try {
    return await withTimeout(collect(), timeoutMs);
  } catch (error) {
    logger?.warn({ source, reason: error.message }, 'metrics source unavailable');

    return null;
  }
}

function publishFamily(publishCounter) {
  return {
    name: 'hooktracker_publish_requests_total',
    help: 'Publish requests answered by this API instance, by outcome.',
    type: 'counter',
    samples: Object.entries(publishCounter.snapshot()).map(([result, value]) => ({
      labels: { result },
      value,
    })),
  };
}

// Delivery rows move between statuses, so this is the current population of
// each status rather than a running total. It is read from Postgres because the
// worker replicas that produce the transitions are not scraped themselves.
async function deliveriesFamily(prisma) {
  const grouped = await prisma.delivery.groupBy({ by: ['status'], _count: { _all: true } });
  const counts = new Map(DELIVERY_STATUS_VALUES.map((status) => [status, 0]));

  for (const row of grouped) {
    counts.set(row.status, row._count._all);
  }

  return {
    name: 'hooktracker_deliveries_total',
    help: 'Delivery rows currently in each status.',
    type: 'gauge',
    samples: [...counts].map(([status, value]) => ({ labels: { status }, value })),
  };
}

async function attemptsFamily(prisma) {
  const grouped = await prisma.deliveryAttempt.groupBy({
    by: ['responseStatus'],
    _count: { _all: true },
  });

  const counts = new Map(
    SEEDED_ATTEMPT_LABELS.map((labels) => [`${labels.outcome}|${labels.responseClass}`, 0]),
  );

  for (const row of grouped) {
    const key = `${attemptOutcome(row.responseStatus)}|${responseClass(row.responseStatus)}`;

    counts.set(key, (counts.get(key) ?? 0) + row._count._all);
  }

  return {
    name: 'hooktracker_delivery_attempts_total',
    help: 'Delivery attempts recorded, by outcome and response class.',
    type: 'counter',
    samples: [...counts].map(([key, value]) => {
      const [outcome, className] = key.split('|');

      return { labels: { outcome, response_class: className }, value };
    }),
  };
}

// One scan of the attempt table rather than one per bucket: the table is the
// largest in the schema and a scrape runs on Prometheus's interval.
async function durationFamily(prisma) {
  const bucketColumns = Prisma.join(
    DURATION_BUCKET_SECONDS.map(
      (bound, index) =>
        Prisma.sql`count(*) FILTER (WHERE "durationMs" <= ${Math.round(bound * MILLISECONDS_PER_SECOND)})::int AS ${Prisma.raw(`"le${index}"`)}`,
    ),
  );

  const [row] = await prisma.$queryRaw`
    SELECT count(*)::int AS observations,
           coalesce(sum("durationMs"), 0)::float8 AS total_ms,
           ${bucketColumns}
    FROM delivery_attempts
    WHERE "durationMs" IS NOT NULL
  `;

  return {
    name: 'hooktracker_delivery_duration_seconds',
    help: 'Wall-clock duration of recorded delivery attempts.',
    type: 'histogram',
    bounds: DURATION_BUCKET_SECONDS,
    cumulative: DURATION_BUCKET_SECONDS.map((bound, index) => row[`le${index}`]),
    sum: row.total_ms / MILLISECONDS_PER_SECOND,
    count: row.observations,
  };
}

async function attemptNumberFamily(prisma, maxAttempts) {
  const grouped = await prisma.deliveryAttempt.groupBy({
    by: ['attemptNumber'],
    _count: { _all: true },
  });

  const bounds = Array.from({ length: maxAttempts }, (_value, index) => index + 1);

  const observations = grouped.map((row) => ({
    value: row.attemptNumber,
    count: row._count._all,
  }));

  return {
    name: 'hooktracker_delivery_attempt_number',
    help: 'Which attempt of the ladder a delivery attempt was.',
    type: 'histogram',
    ...summariseObservations(bounds, observations),
  };
}

async function endpointsDisabledFamily(prisma) {
  const value = await prisma.endpoint.count({ where: { status: ENDPOINT_STATUS.DISABLED } });

  return {
    name: 'hooktracker_endpoints_disabled_total',
    help: 'Endpoints currently disabled, by auto-disable or by an operator.',
    type: 'gauge',
    samples: [{ value }],
  };
}

async function queueFamilies(connection, topology) {
  const channel = await createChannel(connection);

  try {
    const depths = [];

    for (const queue of allQueueNames(topology)) {
      const { messageCount } = await channel.checkQueue(queue);

      depths.push({ queue, messageCount });
    }

    const deadLetter = depths.find((depth) => depth.queue === topology.deadLetterQueue);

    return [
      {
        name: 'hooktracker_queue_depth',
        help: 'Messages waiting on each queue of the delivery topology.',
        type: 'gauge',
        samples: depths.map(({ queue, messageCount }) => ({
          labels: { queue },
          value: messageCount,
        })),
      },
      {
        name: 'hooktracker_dlq_size',
        help: 'Messages waiting on the dead-letter queue.',
        type: 'gauge',
        samples: [{ value: deadLetter?.messageCount ?? 0 }],
      },
    ];
  } finally {
    await closeQuietly(channel);
  }
}

// Every source is collected independently and a failed one is omitted: a scrape
// is not allowed to fail the API, and a broker outage should still leave the
// database-backed series readable.
export async function collectMetrics({
  prisma,
  connection,
  topology = createTopology(),
  publishCounter,
  maxAttempts,
  logger,
  sourceTimeoutMs = SOURCE_TIMEOUT_MS,
}) {
  const sources = [
    ['deliveries', () => deliveriesFamily(prisma)],
    ['attempts', () => attemptsFamily(prisma)],
    ['duration', () => durationFamily(prisma)],
    ['attemptNumber', () => attemptNumberFamily(prisma, maxAttempts)],
    ['endpoints', () => endpointsDisabledFamily(prisma)],
    ['queues', () => queueFamilies(connection, topology)],
  ];

  const collected = await Promise.all(
    sources.map(([source, collect]) =>
      safely(collect, { source, logger, timeoutMs: sourceTimeoutMs }),
    ),
  );

  return [publishFamily(publishCounter), ...collected.flat()].filter(Boolean);
}
