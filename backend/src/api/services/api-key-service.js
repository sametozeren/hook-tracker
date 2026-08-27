import { generateApiKey } from '../../shared/crypto.js';
import { NotFoundError } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';

function keyView(key) {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
  };
}

export function createApiKeyService({ prisma, now = () => new Date() }) {
  return {
    async list({ projectId }) {
      const keys = await prisma.apiKey.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });

      return keys.map(keyView);
    },

    // The plaintext is returned exactly once, here. Only its sha256 is stored,
    // so a lost key is replaced rather than looked up.
    async create({ projectId, name }) {
      const { plaintext, keyPrefix, keyHash } = generateApiKey();

      const key = await prisma.apiKey.create({
        data: { id: newId('apiKey'), projectId, name, keyPrefix, keyHash },
      });

      return { ...keyView(key), key: plaintext };
    },

    async revoke({ projectId, keyId }) {
      const key = await prisma.apiKey.findUnique({ where: { id: keyId } });

      if (!key || key.projectId !== projectId) {
        throw new NotFoundError('No such API key');
      }

      const revoked = await prisma.apiKey.update({
        where: { id: keyId },
        data: { revokedAt: key.revokedAt ?? now() },
      });

      return keyView(revoked);
    },
  };
}
