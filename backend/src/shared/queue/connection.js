import { connect } from 'amqplib';

const DEFAULT_ATTEMPTS = 10;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10_000;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// The URL carries the broker password, so failures are reported with the error
// message alone and never with the connection string.
export async function connectWithRetry({
  url,
  logger,
  attempts = DEFAULT_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  sleep = wait,
}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const connection = await connect(url);

      // amqplib surfaces channel-level faults as an 'error' event on the
      // connection too. Without a listener Node treats it as unhandled and
      // kills the process, so a missing queue would take the whole worker down.
      connection.on('error', (error) => {
        logger?.warn({ reason: error.message }, 'rabbitmq connection error');
      });

      return connection;
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);

      logger?.warn(
        { attempt, attempts, delayMs, reason: error.message },
        'rabbitmq connection failed, retrying',
      );

      await sleep(delayMs);
    }
  }

  throw lastError;
}

// A channel with no 'error' listener escalates its own faults to the
// connection, and amqplib then closes the connection. Every channel this module
// hands out carries one, so a 404 on one queue cannot take the process's
// connection with it.
function withErrorListener(channel, logger) {
  channel.on('error', (error) => {
    logger?.warn({ reason: error.message }, 'rabbitmq channel error');
  });

  return channel;
}

export async function createChannel(connection, { logger } = {}) {
  return withErrorListener(await connection.createChannel(), logger);
}

export async function createConfirmChannel(connection, { prefetch, logger } = {}) {
  const channel = withErrorListener(await connection.createConfirmChannel(), logger);

  if (Number.isFinite(prefetch)) {
    await channel.prefetch(prefetch);
  }

  return channel;
}

export async function closeQuietly(resource, logger) {
  if (!resource) {
    return;
  }

  try {
    await resource.close();
  } catch (error) {
    logger?.warn({ reason: error.message }, 'closing rabbitmq resource failed');
  }
}

export async function createQueueConnection({ url, logger, prefetch, ...retryOptions }) {
  const connection = await connectWithRetry({ url, logger, ...retryOptions });
  const channel = await createConfirmChannel(connection, { prefetch, logger });

  return {
    connection,
    channel,
    close: async () => {
      await closeQuietly(channel, logger);
      await closeQuietly(connection, logger);
    },
  };
}
