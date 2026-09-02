import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { REALTIME_CHANNEL_PREFIX } from '../../shared/realtime.js';
import { verifyAccessToken } from '../middleware/jwt-auth.js';

export const NAMESPACE = '/realtime';

const MILLISECOND = 1000;

// setTimeout keeps its delay in a signed 32-bit int: anything above this
// overflows and fires at once, so a long JWT_ACCESS_TTL (up to 365d) would drop
// every socket the moment it connected. Clamping closes the socket early
// instead, and the client reconnects — the timer is only a safety net.
const MAX_TIMEOUT_MS = 2_147_483_647;

export function socketExpiryDelay(expiresAtSeconds, nowMs = Date.now()) {
  return Math.min(expiresAtSeconds * MILLISECOND - nowMs, MAX_TIMEOUT_MS);
}

function roomFor(projectId) {
  return `project:${projectId}`;
}

// A burst on one project must not drown the dashboard, and must not silence the
// other projects either, so the budget is counted per project per second.
function createThrottle(limitPerSecond) {
  const windows = new Map();

  return function allow(projectId, nowMs = Date.now()) {
    const second = Math.floor(nowMs / MILLISECOND);
    const current = windows.get(projectId);

    if (!current || current.second !== second) {
      windows.set(projectId, { second, count: 1 });

      return true;
    }

    if (current.count >= limitPerSecond) {
      return false;
    }

    current.count += 1;

    return true;
  };
}

export function attachRealtime({ server, prisma, redis, config, logger }) {
  const io = new Server(server, { path: '/socket.io', serveClient: false });
  const namespace = io.of(NAMESPACE);

  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();

  io.adapter(createAdapter(pubClient, subClient));

  // The token is verified during the handshake, not after connect: a socket
  // that never proves who it is never reaches a room.
  namespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        next(new Error('unauthorized'));

        return;
      }

      const payload = verifyAccessToken(token, config.JWT_SECRET);
      const memberships = await prisma.membership.findMany({ where: { userId: payload.sub } });

      socket.data.userId = payload.sub;
      socket.data.projectIds = memberships.map((membership) => membership.projectId);
      socket.data.expiresAt = payload.exp;

      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  namespace.on('connection', (socket) => {
    for (const projectId of socket.data.projectIds) {
      socket.join(roomFor(projectId));
    }

    // A socket outlives the access token that opened it. Revoking a session
    // would otherwise take effect never, rather than within the token's life.
    const msUntilExpiry = socketExpiryDelay(socket.data.expiresAt);

    if (msUntilExpiry <= 0) {
      socket.disconnect(true);

      return;
    }

    const timer = setTimeout(() => {
      socket.emit('token_expired');
      socket.disconnect(true);
    }, msUntilExpiry);

    socket.on('disconnect', () => clearTimeout(timer));
  });

  const bridge = redis.duplicate();
  const allow = createThrottle(config.REALTIME_MAX_EVENTS_PER_SECOND);

  bridge.psubscribe(`${REALTIME_CHANNEL_PREFIX}:*`).catch((error) => {
    logger?.error({ reason: error.message }, 'realtime subscription failed');
  });

  bridge.on('pmessage', (_pattern, channel, raw) => {
    const projectId = channel.slice(REALTIME_CHANNEL_PREFIX.length + 1);

    if (!allow(projectId)) {
      return;
    }

    try {
      const { event, payload } = JSON.parse(raw);

      // .local: every API replica receives this pub/sub message, so emitting
      // through the adapter would send one copy per replica.
      namespace.local.to(roomFor(projectId)).emit(event, payload);
    } catch (error) {
      logger?.warn({ channel, reason: error.message }, 'realtime message dropped');
    }
  });

  return {
    io,
    async close() {
      await io.close();

      bridge.disconnect();
      pubClient.disconnect();
      subClient.disconnect();
    },
  };
}
