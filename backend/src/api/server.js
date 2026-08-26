import express from 'express';
import { pinoHttp } from 'pino-http';
import { config } from '../shared/config.js';
import { createLogger, REDACTION_PATHS } from '../shared/logger.js';

const logger = createLogger('api');

const app = express();
app.disable('x-powered-by');
app.use(pinoHttp({ logger, redact: { paths: REDACTION_PATHS, censor: '[redacted]' } }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api listening');
});

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  const timer = setTimeout(() => {
    logger.warn({ graceMs: config.SHUTDOWN_GRACE_MS }, 'grace period elapsed, forcing exit');
    process.exit(1);
  }, config.SHUTDOWN_GRACE_MS);
  timer.unref();

  server.close(() => {
    clearTimeout(timer);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
