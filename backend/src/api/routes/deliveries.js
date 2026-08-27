import { Router } from 'express';

export function createDeliveryRouter({ deliveryService, jwtAuth }) {
  const router = Router();

  router.use(jwtAuth);

  router.get('/deliveries/:deliveryId', async (req, res) => {
    res
      .status(200)
      .json(await deliveryService.get({ deliveryId: req.params.deliveryId, auth: req.auth }));
  });

  router.post('/deliveries/:deliveryId/replay', async (req, res) => {
    res
      .status(202)
      .json(await deliveryService.replay({ deliveryId: req.params.deliveryId, auth: req.auth }));
  });

  return router;
}
