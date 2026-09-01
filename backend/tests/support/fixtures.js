import { encryptSecret, generateEndpointSecret } from '../../src/shared/crypto.js';
import { newId } from '../../src/shared/ids.js';

// Every file seeds its own project and scopes its rows to it, which is what
// lets the whole suite share one database.
export function createProject(prisma, prefix) {
  return prisma.project.create({
    data: { id: newId('project'), name: `${prefix} project`, slug: `${prefix}-${Date.now()}` },
  });
}

export function createEndpoint(
  prisma,
  { projectId, url, secret, status = 'ACTIVE', eventTypes = [], rateLimitPerMinute },
) {
  return prisma.endpoint.create({
    data: {
      id: newId('endpoint'),
      projectId,
      url,
      status,
      eventTypes,
      ...(rateLimitPerMinute ? { rateLimitPerMinute } : {}),
      secret: encryptSecret(secret ?? generateEndpointSecret()),
    },
  });
}

// `receivedAt` is writable so a test can place a row on either side of the
// retention cutoff without waiting for one.
export function createEvent(
  prisma,
  { projectId, eventType = 'order.created', payload = {}, receivedAt },
) {
  return prisma.webhookEvent.create({
    data: {
      id: newId('event'),
      projectId,
      eventType,
      payload,
      idempotencyKey: newId('event'),
      ...(receivedAt ? { receivedAt } : {}),
    },
  });
}

export async function createDelivery(
  prisma,
  {
    projectId,
    endpointId,
    eventType,
    payload,
    status,
    attemptCount,
    receivedAt,
    createdAt,
    nextAttemptAt,
  },
) {
  const event = await createEvent(prisma, { projectId, eventType, payload, receivedAt });

  return prisma.delivery.create({
    data: {
      id: newId('delivery'),
      eventId: event.id,
      endpointId,
      ...(status ? { status } : {}),
      ...(attemptCount ? { attemptCount } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(nextAttemptAt ? { nextAttemptAt } : {}),
    },
  });
}

export function createAttempt(prisma, { deliveryId, attemptNumber = 1, responseStatus = 500 }) {
  return prisma.deliveryAttempt.create({
    data: { id: newId('attempt'), deliveryId, attemptNumber, responseStatus },
  });
}
