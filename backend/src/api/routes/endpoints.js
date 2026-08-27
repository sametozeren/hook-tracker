import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { endpointUpdateSchema } from '../schemas/dashboard.js';

export function createEndpointRouter({ endpointService, jwtAuth }) {
  const router = Router();

  router.use(jwtAuth);

  router.patch('/endpoints/:endpointId', validateBody(endpointUpdateSchema), async (req, res) => {
    res.status(200).json(
      await endpointService.update({
        endpointId: req.params.endpointId,
        auth: req.auth,
        patch: req.validated,
      }),
    );
  });

  router.post('/endpoints/:endpointId/rotate-secret', async (req, res) => {
    res
      .status(200)
      .json(
        await endpointService.rotateSecret({ endpointId: req.params.endpointId, auth: req.auth }),
      );
  });

  router.post('/endpoints/:endpointId/enable', async (req, res) => {
    res
      .status(200)
      .json(await endpointService.enable({ endpointId: req.params.endpointId, auth: req.auth }));
  });

  router.post('/endpoints/:endpointId/disable', async (req, res) => {
    res
      .status(200)
      .json(await endpointService.disable({ endpointId: req.params.endpointId, auth: req.auth }));
  });

  router.post('/endpoints/:endpointId/test', async (req, res) => {
    res
      .status(202)
      .json(await endpointService.sendTest({ endpointId: req.params.endpointId, auth: req.auth }));
  });

  router.delete('/endpoints/:endpointId', async (req, res) => {
    await endpointService.remove({ endpointId: req.params.endpointId, auth: req.auth });

    res.status(204).end();
  });

  return router;
}
