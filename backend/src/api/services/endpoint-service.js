import { encryptSecret, generateEndpointSecret } from '../../shared/crypto.js';
import { ENDPOINT_STATUS } from '../../shared/delivery-status.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../shared/errors.js';
import { previousSecretExpiresAt } from '../../shared/hmac.js';
import { newId } from '../../shared/ids.js';
import { ROLES } from '../../shared/roles.js';
import { resolveSafeTarget } from '../../shared/ssrf.js';
import { assertMembership } from '../authorization.js';

const FOREIGN_KEY_VIOLATION = 'P2003';

const TEST_EVENT_TYPE = 'ping';

function endpointView(endpoint) {
  return {
    id: endpoint.id,
    projectId: endpoint.projectId,
    url: endpoint.url,
    description: endpoint.description,
    status: endpoint.status,
    eventTypes: endpoint.eventTypes,
    rateLimitPerMinute: endpoint.rateLimitPerMinute,
    consecutiveFailures: endpoint.consecutiveFailures,
    secretRotatedAt: endpoint.secretRotatedAt,
    createdAt: endpoint.createdAt,
  };
}

export function createEndpointService({
  prisma,
  config,
  publishService,
  resolveTarget = resolveSafeTarget,
  now = () => new Date(),
}) {
  // The guard runs while the endpoint is being saved, not at delivery time: a
  // URL that can never be reached is a mistake the caller can still fix here.
  async function assertReachable(url) {
    try {
      await resolveTarget(url, {
        allowPrivate: config.SSRF_ALLOW_PRIVATE,
        allowlistHosts: config.SSRF_ALLOWLIST_HOSTS,
        blockedPorts: config.SSRF_BLOCKED_PORTS,
      });
    } catch (error) {
      throw new UnprocessableError(`The URL is not an allowed delivery target: ${error.message}`);
    }
  }

  async function load({ endpointId, auth, role = ROLES.OWNER }) {
    const endpoint = await prisma.endpoint.findUnique({ where: { id: endpointId } });

    if (!endpoint) {
      throw new NotFoundError('No such endpoint');
    }

    assertMembership(auth, endpoint.projectId, role);

    return endpoint;
  }

  return {
    async list({ projectId }) {
      const endpoints = await prisma.endpoint.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });

      return { endpoints: endpoints.map(endpointView) };
    },

    async create({ projectId, url, description, eventTypes, rateLimitPerMinute }) {
      await assertReachable(url);

      const secret = generateEndpointSecret();

      const endpoint = await prisma.endpoint.create({
        data: {
          id: newId('endpoint'),
          projectId,
          url,
          description,
          eventTypes,
          ...(rateLimitPerMinute ? { rateLimitPerMinute } : {}),
          secret: encryptSecret(secret),
        },
      });

      return { ...endpointView(endpoint), secret };
    },

    async update({ endpointId, auth, patch }) {
      const endpoint = await load({ endpointId, auth });

      if (patch.url && patch.url !== endpoint.url) {
        await assertReachable(patch.url);
      }

      const updated = await prisma.endpoint.update({ where: { id: endpoint.id }, data: patch });

      return endpointView(updated);
    },

    async rotateSecret({ endpointId, auth }) {
      const endpoint = await load({ endpointId, auth });
      const secret = generateEndpointSecret();
      const rotatedAt = now();

      const updated = await prisma.endpoint.update({
        where: { id: endpoint.id },
        data: {
          secret: encryptSecret(secret),
          previousSecret: endpoint.secret,
          secretRotatedAt: rotatedAt,
        },
      });

      return {
        ...endpointView(updated),
        secret,
        previousSecretExpiresAt: previousSecretExpiresAt(
          rotatedAt,
          config.SECRET_ROTATION_GRACE_HOURS,
        ),
      };
    },

    async enable({ endpointId, auth }) {
      const endpoint = await load({ endpointId, auth });

      const updated = await prisma.endpoint.update({
        where: { id: endpoint.id },
        data: { status: ENDPOINT_STATUS.ACTIVE, consecutiveFailures: 0 },
      });

      return endpointView(updated);
    },

    async disable({ endpointId, auth }) {
      const endpoint = await load({ endpointId, auth });

      const updated = await prisma.endpoint.update({
        where: { id: endpoint.id },
        data: { status: ENDPOINT_STATUS.DISABLED },
      });

      return endpointView(updated);
    },

    // Delivery.endpointId is onDelete: Restrict, so an endpoint with history
    // cannot be deleted. The audit trail outlives the configuration.
    async remove({ endpointId, auth }) {
      const endpoint = await load({ endpointId, auth });

      try {
        await prisma.endpoint.delete({ where: { id: endpoint.id } });
      } catch (error) {
        if (error.code === FOREIGN_KEY_VIOLATION) {
          throw new ConflictError(
            'This endpoint has delivery history and cannot be deleted; disable it instead',
          );
        }

        throw error;
      }
    },

    // Sending a test event changes no configuration; it is the same class of
    // operational action as replay, which the authorization model grants MEMBER.
    async sendTest({ endpointId, auth }) {
      const endpoint = await load({ endpointId, auth, role: ROLES.MEMBER });

      return publishService.publishEvent({
        projectId: endpoint.projectId,
        eventType: TEST_EVENT_TYPE,
        payload: { message: 'This is a test delivery from hook-tracker', at: now().toISOString() },
        endpointIds: [endpoint.id],
        idempotencyKey: newId('event'),
      });
    },
  };
}
