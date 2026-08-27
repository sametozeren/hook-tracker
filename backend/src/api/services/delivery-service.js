import { NotFoundError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import { assertMembership } from '../authorization.js';
import { decodeCursor, olderThan, paginate } from './keyset.js';

const REPLAYABLE_FROM = new Set(['SUCCEEDED', 'FAILED_PERMANENTLY', 'SKIPPED', 'RETRYING']);

function deliveryView(delivery) {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    endpointId: delivery.endpointId,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    nextAttemptAt: delivery.nextAttemptAt,
    lastError: delivery.lastError,
    replayedFromId: delivery.replayedFromId,
    completedAt: delivery.completedAt,
    createdAt: delivery.createdAt,
    ...(delivery.event
      ? { eventType: delivery.event.eventType, receivedAt: delivery.event.receivedAt }
      : {}),
  };
}

function attemptView(attempt) {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    responseStatus: attempt.responseStatus,
    responseHeaders: attempt.responseHeaders,
    responseBodySnippet: attempt.responseBodySnippet,
    durationMs: attempt.durationMs,
    errorCode: attempt.errorCode,
    errorMessage: attempt.errorMessage,
    startedAt: attempt.startedAt,
  };
}

export function createDeliveryService({ prisma, publisher, config, logger }) {
  // Every filter is anchored on the project the caller was authorised for, so a
  // supplied endpointId or delivery id can never widen the scope.
  function filterWhere({ projectId, status, endpointId, eventType, from, to }) {
    const receivedAt = {};

    if (from) receivedAt.gte = new Date(from);

    if (to) receivedAt.lte = new Date(to);

    return {
      event: {
        projectId,
        ...(eventType ? { eventType } : {}),
        ...(Object.keys(receivedAt).length > 0 ? { receivedAt } : {}),
      },
      ...(status ? { status } : {}),
      ...(endpointId ? { endpointId } : {}),
    };
  }

  async function loadForCaller({ deliveryId, auth, include }) {
    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId }, include });

    if (!delivery) {
      throw new NotFoundError('No such delivery');
    }

    assertMembership(auth, delivery.event.projectId);

    return delivery;
  }

  return {
    async list({ projectId, filters }) {
      const { cursor, limit, ...rest } = filters;

      const rows = await prisma.delivery.findMany({
        where: {
          ...filterWhere({ projectId, ...rest }),
          ...(cursor ? olderThan(decodeCursor(cursor)) : {}),
        },
        include: { event: { select: { eventType: true, receivedAt: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });

      const { page, nextCursor } = paginate(rows, limit);

      return { deliveries: page.map(deliveryView), nextCursor };
    },

    async get({ deliveryId, auth }) {
      const delivery = await loadForCaller({
        deliveryId,
        auth,
        include: {
          event: true,
          attempts: { orderBy: { attemptNumber: 'asc' } },
        },
      });

      return {
        ...deliveryView(delivery),
        payload: delivery.event.payload,
        attempts: delivery.attempts.map(attemptView),
      };
    },

    // A replay is a new delivery against the same event, never a rewrite of the
    // old one: the original attempt history stays exactly as it happened.
    async replay({ deliveryId, auth }) {
      const original = await loadForCaller({ deliveryId, auth, include: { event: true } });
      const replay = await prisma.delivery.create({
        data: {
          id: newId('delivery'),
          eventId: original.eventId,
          endpointId: original.endpointId,
          replayedFromId: original.id,
        },
      });

      await publisher.publishDelivery({ deliveryId: replay.id, attempt: 1 });

      logger?.info({ deliveryId: replay.id, replayedFromId: original.id }, 'delivery replayed');

      return deliveryView(replay);
    },

    async bulkReplay({ projectId, filters }) {
      const limit = Math.min(filters.limit ?? config.BULK_REPLAY_LIMIT, config.BULK_REPLAY_LIMIT);

      const originals = await prisma.delivery.findMany({
        where: filterWhere({ projectId, ...filters }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });

      const replayable = originals.filter((delivery) => REPLAYABLE_FROM.has(delivery.status));

      const replays = replayable.map((original) => ({
        id: newId('delivery'),
        eventId: original.eventId,
        endpointId: original.endpointId,
        replayedFromId: original.id,
      }));

      if (replays.length > 0) {
        await prisma.delivery.createMany({ data: replays });
      }

      for (const replay of replays) {
        await publisher.publishDelivery({ deliveryId: replay.id, attempt: 1 });
      }

      return {
        matched: originals.length,
        replayed: replays.length,
        cappedAt: limit,
        deliveries: replays.map((replay) => ({
          id: replay.id,
          replayedFromId: replay.replayedFromId,
        })),
      };
    },

    // Per-project figures come from the database rather than from a Prometheus
    // label, which would grow one time series per tenant.
    async stats({ projectId }) {
      const grouped = await prisma.delivery.groupBy({
        by: ['status'],
        where: { event: { projectId } },
        _count: { _all: true },
      });

      const byStatus = Object.fromEntries(
        grouped.map((entry) => [entry.status, entry._count._all]),
      );

      const latency = await prisma.deliveryAttempt.aggregate({
        where: { delivery: { event: { projectId } }, durationMs: { not: null } },
        _avg: { durationMs: true },
        _max: { durationMs: true },
        _count: { _all: true },
      });

      return {
        byStatus,
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        latency: {
          attempts: latency._count._all,
          averageMs: latency._avg.durationMs === null ? null : Math.round(latency._avg.durationMs),
          slowestMs: latency._max.durationMs,
        },
      };
    },
  };
}
