import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../shared/errors.js';

const BEARER = /^Bearer\s+(\S+)$/i;

export function verifyAccessToken(token, secret) {
  try {
    return jwt.verify(token, secret);
  } catch {
    throw new UnauthorizedError('The access token is missing, malformed or expired');
  }
}

export function createJwtAuth({ prisma, config }) {
  return async function jwtAuth(req, res, next) {
    const match = BEARER.exec(req.get('authorization') ?? '');

    if (!match) {
      throw new UnauthorizedError('An access token is required: Authorization: Bearer <jwt>');
    }

    const payload = verifyAccessToken(match[1], config.JWT_SECRET);

    // The membership set is read per request rather than carried in the token,
    // so removing someone from a project takes effect at once instead of when
    // their access token happens to expire.
    const memberships = await prisma.membership.findMany({ where: { userId: payload.sub } });

    req.auth = {
      userId: payload.sub,
      expiresAt: payload.exp,
      memberships: memberships.map((membership) => ({
        projectId: membership.projectId,
        role: membership.role,
      })),
    };

    next();
  };
}
