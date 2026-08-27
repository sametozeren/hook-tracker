// Every process shuts down the same way and closes different things. Only the
// sameness lives here: one shutdown per process however many signals arrive, a
// force-exit timer so a hung dependency cannot hold the process open, and the
// exit code. What to close stays with the process that owns it.
export function onShutdown({ logger, graceMs, close }) {
  let shuttingDown = false;

  async function run(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    logger?.info({ signal }, 'shutting down');

    const timer = setTimeout(() => {
      logger?.warn({ graceMs }, 'grace period elapsed, forcing exit');
      process.exit(1);
    }, graceMs);

    timer.unref();

    try {
      await close(signal);
    } catch (error) {
      logger?.error({ reason: error.message }, 'shutdown failed');
      clearTimeout(timer);
      process.exit(1);
    }

    clearTimeout(timer);
    process.exit(0);
  }

  process.on('SIGTERM', () => run('SIGTERM'));
  process.on('SIGINT', () => run('SIGINT'));
}

export function closeServer(server) {
  return new Promise((resolve) => {
    server.close(resolve);
  });
}
