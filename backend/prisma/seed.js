import { config } from '../src/shared/config.js';
import { encryptSecret, generateApiKey, hashPassword } from '../src/shared/crypto.js';
import { disconnectDatabase, prisma } from '../src/shared/db.js';
import { newId } from '../src/shared/ids.js';

const DEMO_USER_EMAIL = 'demo@hook-tracker.dev';
const DEMO_USER_PASSWORD = 'demo-password-123';
const DEMO_PROJECT_SLUG = 'demo';
const DEMO_ENDPOINT_URL = 'http://receiver:4000/flaky?rate=0.7';
const DEMO_API_KEY_NAME = 'demo-key';

function print(line) {
  process.stdout.write(`${line}\n`);
}

async function seed() {
  if (!config.DEMO_ENDPOINT_SECRET) {
    throw new Error('DEMO_ENDPOINT_SECRET is required to seed the demo endpoint; see .env.example');
  }

  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: {
      id: newId('user'),
      email: DEMO_USER_EMAIL,
      name: 'Demo User',
      passwordHash: await hashPassword(DEMO_USER_PASSWORD),
    },
  });

  const project = await prisma.project.upsert({
    where: { slug: DEMO_PROJECT_SLUG },
    update: {},
    create: { id: newId('project'), name: 'Demo Project', slug: DEMO_PROJECT_SLUG },
  });

  await prisma.membership.upsert({
    where: { userId_projectId: { userId: user.id, projectId: project.id } },
    update: { role: 'OWNER' },
    create: { userId: user.id, projectId: project.id, role: 'OWNER' },
  });

  const existingEndpoint = await prisma.endpoint.findFirst({
    where: { projectId: project.id, url: DEMO_ENDPOINT_URL },
  });

  const endpoint =
    existingEndpoint ??
    (await prisma.endpoint.create({
      data: {
        id: newId('endpoint'),
        projectId: project.id,
        url: DEMO_ENDPOINT_URL,
        description: 'Bundled demo receiver, fails 70% of the time so retries are visible',
        secret: encryptSecret(config.DEMO_ENDPOINT_SECRET),
        eventTypes: [],
      },
    }));

  const existingKey = await prisma.apiKey.findFirst({
    where: { projectId: project.id, name: DEMO_API_KEY_NAME, revokedAt: null },
  });

  print('');
  print('Seed complete.');
  print(`  user      ${user.email} / ${DEMO_USER_PASSWORD}`);
  print(`  project   ${project.name} (${project.id})`);
  print(`  endpoint  ${endpoint.url} (${endpoint.id})`);

  if (existingKey) {
    print(`  api key   ${existingKey.keyPrefix}… already exists, plaintext shown only at creation`);
  } else {
    const { plaintext, keyPrefix, keyHash } = generateApiKey();

    await prisma.apiKey.create({
      data: {
        id: newId('apiKey'),
        projectId: project.id,
        name: DEMO_API_KEY_NAME,
        keyPrefix,
        keyHash,
      },
    });
    print(`  api key   ${plaintext}`);
    print('            copy it now; it is stored hashed and never shown again');
  }

  print('');
}

try {
  await seed();
} catch (error) {
  process.stderr.write(`Seed failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
