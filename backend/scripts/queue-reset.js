import { config, isProduction } from '../src/shared/config.js';
import { createLogger } from '../src/shared/logger.js';
import { closeQuietly, connectWithRetry, createChannel } from '../src/shared/queue/connection.js';
import { allQueueNames, assertTopology, createTopology } from '../src/shared/queue/topology.js';

const logger = createLogger('queue-reset');

const force = process.argv.includes('--force');

function print(line) {
  process.stdout.write(`${line}\n`);
}

// checkQueue fails the channel when the queue is missing, so every inspection
// runs on a channel of its own and a missing queue is reported as null rather
// than as an error. That channel gets no logger: on a fresh broker every queue
// is missing, and eight expected 404s are noise, not diagnostics.
async function pendingMessages(connection, queue) {
  const channel = await createChannel(connection);

  try {
    const info = await channel.checkQueue(queue);

    await channel.close();

    return info.messageCount;
  } catch {
    return null;
  }
}

async function reset() {
  if (isProduction) {
    throw new Error(
      'queue:reset is a development tool and refuses to run with NODE_ENV=production',
    );
  }

  const topology = createTopology();
  const connection = await connectWithRetry({ url: config.RABBITMQ_URL, logger, attempts: 3 });

  try {
    const states = [];

    for (const queue of allQueueNames(topology)) {
      const messageCount = await pendingMessages(connection, queue);

      states.push({ queue, messageCount });

      print(messageCount === null ? `  absent    ${queue}` : `  ${messageCount} held  ${queue}`);
    }

    const occupied = states.filter((state) => state.messageCount > 0);

    if (occupied.length > 0 && !force) {
      throw new Error(
        `refusing to delete queues that still hold messages: ${occupied
          .map((state) => state.queue)
          .join(', ')}. Drain them first, or pass --force to discard those messages`,
      );
    }

    const channel = await createChannel(connection, { logger });

    for (const state of states.filter((entry) => entry.messageCount !== null)) {
      await channel.deleteQueue(state.queue);
    }

    for (const exchange of Object.values(topology.exchanges)) {
      await channel.deleteExchange(exchange);
    }

    await assertTopology(channel, topology);
    await channel.close();

    print('');
    print('Topology deleted and redeclared.');
  } finally {
    await closeQuietly(connection, logger);
  }
}

try {
  await reset();
} catch (error) {
  process.stderr.write(`queue:reset failed: ${error.message}\n`);
  process.exitCode = 1;
}
