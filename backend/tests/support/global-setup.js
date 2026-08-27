import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GenericContainer, Wait } from 'testcontainers';

const run = promisify(execFile);

const STARTUP_TIMEOUT_MS = 180_000;

const CREDENTIALS = 'hooktracker';

// One stack for the whole integration run. The files isolate themselves by
// queue namespace and by project row, not by container, so a container each
// only bought a slower suite.
export default async function setup({ provide }) {
  const [postgres, redis, rabbitmq] = await Promise.all([
    new GenericContainer('postgres:17-alpine')
      .withEnvironment({
        POSTGRES_USER: CREDENTIALS,
        POSTGRES_PASSWORD: CREDENTIALS,
        POSTGRES_DB: CREDENTIALS,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start(),
    new GenericContainer('redis:8-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start(),
    new GenericContainer('rabbitmq:4-management-alpine')
      .withExposedPorts(5672)
      .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start(),
  ]);

  const databaseUrl = `postgresql://${CREDENTIALS}:${CREDENTIALS}@${postgres.getHost()}:${postgres.getMappedPort(5432)}/${CREDENTIALS}?schema=public`;

  // The same command the compose stack runs: no application process ever
  // creates the schema itself, and neither does a test.
  await run('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: true,
  });

  provide('stackUrls', {
    databaseUrl,
    redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    amqpUrl: `amqp://guest:guest@${rabbitmq.getHost()}:${rabbitmq.getMappedPort(5672)}`,
  });

  return async () => {
    await Promise.all([postgres.stop(), redis.stop(), rabbitmq.stop()]);
  };
}
