import { UnprocessableError } from '../../shared/errors.js';
import { subscriptionMatches } from '../../shared/event-types.js';
import { newId } from '../../shared/ids.js';

export function createPublishService({ prisma, publisher, logger }) {
  // An id from another project is refused with the same message as an id that
  // does not exist, so the response cannot be used to enumerate endpoints.
  async function explicitEndpoints({ projectId, endpointIds }) {
    const unique = [...new Set(endpointIds)];
    const endpoints = await prisma.endpoint.findMany({
      where: { projectId, id: { in: unique } },
    });

    if (endpoints.length !== unique.length) {
      throw new UnprocessableError('One or more endpoints are not available for this project');
    }

    return endpoints;
  }

  async function subscribedEndpoints({ projectId, eventType }) {
    const endpoints = await prisma.endpoint.findMany({ where: { projectId } });

    return endpoints.filter((endpoint) => subscriptionMatches(endpoint.eventTypes, eventType));
  }

  return {
    async publishEvent({ projectId, eventType, payload, endpointIds, idempotencyKey }) {
      const endpoints = endpointIds?.length
        ? await explicitEndpoints({ projectId, endpointIds })
        : await subscribedEndpoints({ projectId, eventType });

      if (endpoints.length === 0) {
        throw new UnprocessableError(
          `No endpoint of this project subscribes to "${eventType}"; sending data nowhere is a configuration error`,
        );
      }

      const eventId = newId('event');

      // A disabled endpoint still gets a row. Dropping it silently would leave
      // the audit trail claiming the event reached fewer endpoints than it did.
      const deliveries = endpoints.map((endpoint) => ({
        id: newId('delivery'),
        eventId,
        endpointId: endpoint.id,
        status: endpoint.status === 'ACTIVE' ? 'PENDING' : 'SKIPPED',
      }));

      await prisma.$transaction([
        prisma.webhookEvent.create({
          data: { id: eventId, projectId, eventType, payload, idempotencyKey },
        }),
        prisma.delivery.createMany({ data: deliveries }),
      ]);

      const queued = deliveries.filter((delivery) => delivery.status === 'PENDING');

      for (const delivery of queued) {
        await publisher.publishDelivery({ deliveryId: delivery.id, attempt: 1 });
      }

      logger?.info(
        { eventId, eventType, deliveries: deliveries.length, queued: queued.length },
        'event accepted',
      );

      return {
        eventId,
        deliveries: deliveries.map(({ id, endpointId, status }) => ({ id, endpointId, status })),
      };
    },
  };
}
