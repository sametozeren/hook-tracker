import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { REDACTION_PATHS } from '../shared/logger.js';
import { createApiKeyAuth } from './middleware/api-key-auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createIdempotency } from './middleware/idempotency.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import { createHealthRouter } from './routes/health.js';
import { createPublishRouter } from './routes/publish.js';
import { createPublishService } from './services/publish-service.js';

const HSTS_MAX_AGE_SECONDS = 15_552_000;

export function createApp({ prisma, redis, publisher, connection, config, logger }) {
  const app = express();

  app.disable('x-powered-by');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      redact: { paths: REDACTION_PATHS, censor: '[redacted]' },
    }),
  );

  // HSTS only in production: the compose stack serves plain HTTP on localhost,
  // and a browser that has cached the header would refuse to reach it.
  app.use(
    helmet({
      hsts: config.NODE_ENV === 'production' ? { maxAge: HSTS_MAX_AGE_SECONDS } : false,
    }),
  );

  // An empty CORS_ORIGINS means no browser origin is allowed, which is what a
  // deployment that never configured it should get.
  if (config.CORS_ORIGINS.length > 0) {
    app.use(cors({ origin: config.CORS_ORIGINS, credentials: true }));
  }

  app.use(createHealthRouter({ prisma, redis, connection }));

  const publishService = createPublishService({ prisma, publisher, logger });

  app.use(
    '/v1',
    express.json({ limit: config.MAX_PAYLOAD_BYTES }),
    createPublishRouter({
      publishService,
      apiKeyAuth: createApiKeyAuth({ prisma }),
      rateLimit: createRateLimiter({ redis, limit: config.RATE_LIMIT_PUBLISH_PER_MINUTE }),
      idempotency: createIdempotency({ redis, ttlSeconds: config.IDEMPOTENCY_TTL_SECONDS }),
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
