import { Router } from 'express';

export function createEventRouter({ eventService, jwtAuth }) {
  const router = Router();

  router.use(jwtAuth);

  router.get('/events/:eventId', async (req, res) => {
    res.status(200).json(await eventService.get({ eventId: req.params.eventId, auth: req.auth }));
  });

  return router;
}
