import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { publishSchema } from '../schemas/publish.js';

const ACCEPTED = 202;

export function createPublishRouter({ publishService, apiKeyAuth, rateLimit, idempotency }) {
  const router = Router();

  router.post(
    '/publish',
    apiKeyAuth,
    rateLimit,
    validateBody(publishSchema),
    idempotency,
    async (req, res) => {
      const { eventType, payload, endpointIds } = req.validated;

      const result = await publishService.publishEvent({
        projectId: req.auth.projectId,
        eventType,
        payload,
        endpointIds,
        idempotencyKey: req.idempotency.key,
      });

      await req.idempotency.store(ACCEPTED, result);

      res.status(ACCEPTED).json(result);
    },
  );

  return router;
}
