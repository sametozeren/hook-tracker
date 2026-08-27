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

export function createEvent(prisma, { projectId, eventType = 'order.created', payload = {} }) {
  return prisma.webhookEvent.create({
    data: {
      id: newId('event'),
      projectId,
      eventType,
      payload,
      idempotencyKey: newId('event'),
    },
  });
}

export async function createDelivery(
  prisma,
  { projectId, endpointId, eventType, payload, status, attemptCount },
) {
  const event = await createEvent(prisma, { projectId, eventType, payload });

  return prisma.delivery.create({
    data: {
      id: newId('delivery'),
      eventId: event.id,
      endpointId,
      ...(status ? { status } : {}),
      ...(attemptCount ? { attemptCount } : {}),
    },
  });
}
