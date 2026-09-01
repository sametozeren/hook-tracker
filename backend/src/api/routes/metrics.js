import { Router } from 'express';
import { collectMetrics } from '../metrics/collect.js';
import { renderMetrics } from '../metrics/exposition.js';

export const EXPOSITION_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

// No authentication: this route rides on the API's published port (docker-compose.yml
// maps ${PORT:-3000}:3000), so it is reachable from the host, not just the Docker
// network. A real deployment must block it at the reverse proxy. It is safe to leave
// unauthenticated regardless, because architecture §14 keeps the exposition
// low-cardinality — no project id, endpoint id, or URL in any label.
export function createMetricsRouter({
  prisma,
  connection,
  topology,
  publishCounter,
  config,
  logger,
}) {
  const router = Router();

  router.get('/metrics', async (req, res) => {
    const families = await collectMetrics({
      prisma,
      connection,
      topology,
      publishCounter,
      maxAttempts: config.MAX_ATTEMPTS,
      logger: req.log ?? logger,
    });

    res.status(200).type(EXPOSITION_CONTENT_TYPE).send(renderMetrics(families));
  });

  return router;
}
