import { z } from 'zod';
import { DELIVERY_STATUS_VALUES, ENDPOINT_STATUS } from '../../shared/delivery-status.js';
import { ROLE_VALUES } from '../../shared/roles.js';

// The routes validate what comes in; nothing validates what goes out, so these
// describe the service return shapes for the OpenAPI document. They are built
// from the same shared enums the services write, which is what keeps the status
// and role vocabularies from drifting away from the implementation.
const timestamp = z.string().meta({ format: 'date-time' });

const nullableTimestamp = timestamp.nullable();

const deliveryStatus = z.enum(DELIVERY_STATUS_VALUES);

const endpointStatus = z.enum(Object.values(ENDPOINT_STATUS));

const role = z.enum(ROLE_VALUES);

const payload = z.record(z.string(), z.unknown());

export const problemResponse = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string(),
    requestId: z.string(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'Problem', description: 'RFC 9457 problem document.' });

export const publishAcceptedResponse = z
  .object({
    eventId: z.string(),
    deliveries: z.array(
      z.object({ id: z.string(), endpointId: z.string(), status: deliveryStatus }),
    ),
  })
  .meta({ id: 'PublishAccepted' });

const user = z.object({ id: z.string(), email: z.email(), name: z.string() });

export const sessionResponse = z
  .object({
    user,
    project: z.object({ id: z.string(), name: z.string() }).optional(),
    accessToken: z.string(),
  })
  .meta({
    id: 'Session',
    description: 'The refresh token travels in the ht_refresh cookie, never in the body.',
  });

export const accessTokenResponse = z
  .object({ accessToken: z.string() })
  .meta({ id: 'AccessToken' });

export const meResponse = z
  .object({
    id: z.string(),
    email: z.email(),
    name: z.string(),
    memberships: z.array(
      z.object({
        role,
        project: z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          alertWebhookUrl: z.string().nullable(),
        }),
      }),
    ),
  })
  .meta({ id: 'Me' });

export const projectResponse = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    alertWebhookUrl: z.string().nullable(),
    createdAt: timestamp,
    role: role.optional(),
  })
  .meta({ id: 'Project' });

export const projectListResponse = z
  .object({ projects: z.array(projectResponse) })
  .meta({ id: 'ProjectList' });

export const memberResponse = z
  .object({ userId: z.string(), email: z.email(), name: z.string(), role })
  .meta({ id: 'Member' });

export const memberListResponse = z
  .object({ members: z.array(memberResponse.extend({ joinedAt: timestamp })) })
  .meta({ id: 'MemberList' });

export const apiKeyResponse = z
  .object({
    id: z.string(),
    name: z.string(),
    keyPrefix: z.string(),
    lastUsedAt: nullableTimestamp,
    revokedAt: nullableTimestamp,
    createdAt: timestamp,
  })
  .meta({ id: 'ApiKey' });

export const apiKeyListResponse = z
  .object({ apiKeys: z.array(apiKeyResponse) })
  .meta({ id: 'ApiKeyList' });

export const apiKeyCreatedResponse = apiKeyResponse
  .extend({ key: z.string() })
  .meta({ id: 'ApiKeyCreated', description: 'The plaintext key is returned exactly once.' });

export const endpointResponse = z
  .object({
    id: z.string(),
    projectId: z.string(),
    url: z.url(),
    description: z.string().nullable(),
    status: endpointStatus,
    eventTypes: z.array(z.string()),
    rateLimitPerMinute: z.number().int(),
    consecutiveFailures: z.number().int(),
    secretRotatedAt: nullableTimestamp,
    createdAt: timestamp,
  })
  .meta({ id: 'Endpoint' });

export const endpointListResponse = z
  .object({ endpoints: z.array(endpointResponse) })
  .meta({ id: 'EndpointList' });

export const endpointCreatedResponse = endpointResponse
  .extend({ secret: z.string() })
  .meta({ id: 'EndpointCreated', description: 'The signing secret is returned exactly once.' });

export const endpointRotatedResponse = endpointResponse
  .extend({ secret: z.string(), previousSecretExpiresAt: timestamp })
  .meta({
    id: 'EndpointRotated',
    description: 'Both secrets verify until previousSecretExpiresAt passes.',
  });

const delivery = z.object({
  id: z.string(),
  eventId: z.string(),
  endpointId: z.string(),
  status: deliveryStatus,
  attemptCount: z.number().int(),
  nextAttemptAt: nullableTimestamp,
  lastError: z.string().nullable(),
  replayedFromId: z.string().nullable(),
  completedAt: nullableTimestamp,
  createdAt: timestamp,
});

export const deliveryResponse = delivery.meta({ id: 'Delivery' });

const deliveryAttempt = z.object({
  id: z.string(),
  attemptNumber: z.number().int(),
  responseStatus: z.number().int().nullable(),
  responseHeaders: z.record(z.string(), z.string()).nullable(),
  responseBodySnippet: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: timestamp,
});

export const deliveryDetailResponse = delivery
  .extend({
    eventType: z.string(),
    receivedAt: timestamp,
    payload,
    attempts: z.array(deliveryAttempt),
  })
  .meta({ id: 'DeliveryDetail' });

export const eventListResponse = z
  .object({
    events: z.array(
      z.object({
        id: z.string(),
        eventType: z.string(),
        receivedAt: timestamp,
        deliveryCount: z.number().int(),
        byStatus: z.record(z.string(), z.number().int()),
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'EventList' });

export const eventResponse = z
  .object({
    id: z.string(),
    projectId: z.string(),
    eventType: z.string(),
    receivedAt: timestamp,
    payload: z.unknown(),
    deliveries: z.array(
      z.object({
        id: z.string(),
        endpointId: z.string(),
        status: z.string(),
        attemptCount: z.number().int(),
        createdAt: timestamp,
        completedAt: timestamp.nullable(),
      }),
    ),
  })
  .meta({ id: 'Event' });

export const deliveryListResponse = z
  .object({
    deliveries: z.array(
      delivery.extend({
        eventType: z.string(),
        receivedAt: timestamp,
        lastResponseStatus: z.number().int().nullable(),
        lastDurationMs: z.number().int().nullable(),
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'DeliveryList', description: 'nextCursor is null on the last page.' });

export const bulkReplayResponse = z
  .object({
    matched: z.number().int(),
    replayed: z.number().int(),
    cappedAt: z.number().int(),
    deliveries: z.array(z.object({ id: z.string(), replayedFromId: z.string() })),
  })
  .meta({ id: 'BulkReplay' });

export const statsResponse = z
  .object({
    byStatus: z.partialRecord(deliveryStatus, z.number().int()),
    total: z.number().int(),
    latency: z.object({
      attempts: z.number().int(),
      averageMs: z.number().int().nullable(),
      slowestMs: z.number().int().nullable(),
    }),
  })
  .meta({ id: 'Stats' });

export const healthResponse = z.object({ status: z.literal('ok') }).meta({ id: 'Health' });

export const readyResponse = z
  .object({
    status: z.enum(['ready', 'degraded']),
    checks: z.array(z.object({ name: z.string(), ok: z.boolean(), reason: z.string().optional() })),
  })
  .meta({ id: 'Ready' });
