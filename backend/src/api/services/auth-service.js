import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { hashPassword, sha256Hex, verifyPassword } from '../../shared/crypto.js';
import { ConflictError, UnauthorizedError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import { ROLES } from '../../shared/roles.js';

const DAY_MS = 86_400_000;

// One message for an unknown email and for a wrong password: telling them apart
// turns the login route into an account-existence oracle.
const CREDENTIALS_REJECTED = 'The email or the password is wrong';

const REFRESH_REJECTED = 'The refresh token is unknown, revoked or expired';

export function slugify(value) {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  return `${base || 'project'}-${randomBytes(3).toString('hex')}`;
}

export function createAuthService({ prisma, config, logger, now = () => new Date() }) {
  function issueAccessToken(userId) {
    return jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: config.JWT_ACCESS_TTL });
  }

  async function issueRefreshToken(userId) {
    const plaintext = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now().getTime() + config.REFRESH_TOKEN_TTL_DAYS * DAY_MS);

    await prisma.refreshToken.create({
      data: {
        id: newId('refreshToken'),
        userId,
        tokenHash: sha256Hex(plaintext),
        expiresAt,
      },
    });

    return { token: plaintext, expiresAt };
  }

  async function session(userId) {
    return {
      accessToken: issueAccessToken(userId),
      refresh: await issueRefreshToken(userId),
    };
  }

  async function revokeFamily(userId) {
    const revoked = await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now() },
    });

    return revoked.count;
  }

  async function usableToken(token) {
    if (!token) {
      throw new UnauthorizedError('No refresh token was presented');
    }

    const record = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(token) } });

    if (!record || record.expiresAt.getTime() <= now().getTime()) {
      throw new UnauthorizedError(REFRESH_REJECTED);
    }

    // A revoked but still unexpired token coming back means two copies of it
    // exist: the one that rotated it and this one. Which of the two is the
    // thief cannot be told apart from here, so every live token of the account
    // goes — the legitimate session drops with the stolen one, and the log line
    // is the record that it happened.
    if (record.revokedAt) {
      const revokedCount = await revokeFamily(record.userId);

      logger?.warn(
        { userId: record.userId, refreshTokenId: record.id, revokedCount },
        'revoked refresh token replayed; revoked every live token of the account',
      );

      throw new UnauthorizedError(REFRESH_REJECTED);
    }

    return record;
  }

  return {
    async register({ email, password, name, projectName }) {
      const existing = await prisma.user.findUnique({ where: { email } });

      if (existing) {
        throw new ConflictError('An account with this email already exists');
      }

      const userId = newId('user');
      const projectId = newId('project');

      await prisma.$transaction([
        prisma.user.create({
          data: { id: userId, email, name, passwordHash: await hashPassword(password) },
        }),
        prisma.project.create({
          data: { id: projectId, name: projectName, slug: slugify(projectName) },
        }),
        prisma.membership.create({ data: { userId, projectId, role: ROLES.OWNER } }),
      ]);

      return {
        user: { id: userId, email, name },
        project: { id: projectId, name: projectName },
        ...(await session(userId)),
      };
    },

    async login({ email, password }) {
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || !(await verifyPassword(user.passwordHash, password))) {
        throw new UnauthorizedError(CREDENTIALS_REJECTED);
      }

      return {
        user: { id: user.id, email: user.email, name: user.name },
        ...(await session(user.id)),
      };
    },

    // Rotation: the presented token is revoked as the new one is issued, so a
    // stolen token is usable at most once. The revocation is the condition of
    // the write, not a step after the read — two requests racing with the same
    // token both pass usableToken, but only one updateMany matches a row that
    // is still unrevoked, and the loser is refused instead of being handed a
    // second independent session. Replaying an already revoked token is what
    // usableToken turns into a family-wide revocation.
    async refresh({ token }) {
      const record = await usableToken(token);

      const rotated = await prisma.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: now() },
      });

      if (rotated.count !== 1) {
        throw new UnauthorizedError(REFRESH_REJECTED);
      }

      return session(record.userId);
    },

    async logout({ token }) {
      if (!token) {
        return;
      }

      await prisma.refreshToken.updateMany({
        where: { tokenHash: sha256Hex(token), revokedAt: null },
        data: { revokedAt: now() },
      });
    },

    async me({ userId }) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { memberships: { include: { project: true } } },
      });

      if (!user) {
        throw new UnauthorizedError('The account no longer exists');
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        memberships: user.memberships.map((membership) => ({
          role: membership.role,
          project: {
            id: membership.project.id,
            name: membership.project.name,
            slug: membership.project.slug,
            alertWebhookUrl: membership.project.alertWebhookUrl,
          },
        })),
      };
    },
  };
}
