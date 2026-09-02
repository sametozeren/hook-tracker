import { NotFoundError } from '../../shared/errors.js';
import { assertMembership } from '../authorization.js';
import { decodeCursor, encodeCursor } from './keyset.js';

const PATH_SEPARATOR = '.';

// A search asks for one value at one path, and the query it becomes is a
// containment test: `payload @> {"customer":{"id":42}}`. Containment is what the
// GIN index on payload answers, which is why the search is not a substring one —
// matching anywhere in the document would need a trigram index over every
// payload, and its write cost would land on the ingestion path.
export function containmentCandidates(path, value) {
  const segments = path.split(PATH_SEPARATOR).filter(Boolean);

  if (segments.length === 0) {
    return [];
  }

  function nest(leaf) {
    return segments.reduceRight((carried, segment) => ({ [segment]: carried }), leaf);
  }

  const candidates = [nest(value)];

  // The caller types a value, not a type, and JSON keeps the two apart: 1234 and
  // "1234" are different documents. Both are offered, so a search finds the
  // event whichever way the publisher wrote it.
  if (value !== '' && !Number.isNaN(Number(value))) {
    candidates.push(nest(Number(value)));
  }

  if (value === 'true' || value === 'false') {
    candidates.push(nest(value === 'true'));
  }

  return candidates;
}

function eventListView(row, byStatus) {
  const deliveries = byStatus.get(row.id) ?? [];

  return {
    id: row.id,
    eventType: row.eventType,
    receivedAt: row.receivedAt,
    deliveryCount: deliveries.reduce((total, entry) => total + entry.count, 0),
    byStatus: Object.fromEntries(deliveries.map((entry) => [entry.status, entry.count])),
  };
}

export function createEventService({ prisma }) {
  async function deliverySummary(eventIds) {
    if (eventIds.length === 0) {
      return new Map();
    }

    const grouped = await prisma.delivery.groupBy({
      by: ['eventId', 'status'],
      where: { eventId: { in: eventIds } },
      _count: { _all: true },
    });

    const byStatus = new Map();

    for (const row of grouped) {
      const entries = byStatus.get(row.eventId) ?? [];

      entries.push({ status: row.status, count: row._count._all });
      byStatus.set(row.eventId, entries);
    }

    return byStatus;
  }

  return {
    // Written as one raw statement rather than through the query builder: the
    // payload filter is a containment test, and the builder expresses that path
    // as an equality the GIN index cannot serve.
    async list({ projectId, filters }) {
      const { cursor, limit, eventType, from, to, payloadPath, payloadValue } = filters;
      const after = cursor ? decodeCursor(cursor) : null;
      const candidates = payloadPath ? containmentCandidates(payloadPath, payloadValue ?? '') : [];

      const rows = await prisma.$queryRaw`
        SELECT id, "eventType", "receivedAt"
        FROM webhook_events
        WHERE "projectId" = ${projectId}
          AND (${eventType ?? null}::text IS NULL OR "eventType" = ${eventType ?? null})
          AND (${from ?? null}::timestamptz IS NULL OR "receivedAt" >= ${from ?? null}::timestamptz)
          AND (${to ?? null}::timestamptz IS NULL OR "receivedAt" <= ${to ?? null}::timestamptz)
          AND (
            ${candidates[0] ? JSON.stringify(candidates[0]) : null}::jsonb IS NULL
            OR payload @> ${candidates[0] ? JSON.stringify(candidates[0]) : null}::jsonb
            OR (
              ${candidates[1] ? JSON.stringify(candidates[1]) : null}::jsonb IS NOT NULL
              AND payload @> ${candidates[1] ? JSON.stringify(candidates[1]) : null}::jsonb
            )
          )
          AND (
            ${after?.createdAt ?? null}::timestamptz IS NULL
            OR "receivedAt" < ${after?.createdAt ?? null}::timestamptz
            OR ("receivedAt" = ${after?.createdAt ?? null}::timestamptz AND id < ${after?.id ?? null})
          )
        ORDER BY "receivedAt" DESC, id DESC
        LIMIT ${limit + 1}
      `;

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const byStatus = await deliverySummary(page.map((row) => row.id));
      const last = page.at(-1);

      return {
        events: page.map((row) => eventListView(row, byStatus)),
        nextCursor: hasMore ? encodeCursor({ createdAt: last.receivedAt, id: last.id }) : null,
      };
    },

    async get({ eventId, auth }) {
      const event = await prisma.webhookEvent.findUnique({
        where: { id: eventId },
        include: { deliveries: { orderBy: { createdAt: 'asc' } } },
      });

      if (!event) {
        throw new NotFoundError('No such event');
      }

      assertMembership(auth, event.projectId);

      return {
        id: event.id,
        projectId: event.projectId,
        eventType: event.eventType,
        receivedAt: event.receivedAt,
        payload: event.payload,
        deliveries: event.deliveries.map((delivery) => ({
          id: delivery.id,
          endpointId: delivery.endpointId,
          status: delivery.status,
          attemptCount: delivery.attemptCount,
          createdAt: delivery.createdAt,
          completedAt: delivery.completedAt,
        })),
      };
    },
  };
}
