import { Router } from 'express';
import { ROLES, requireProjectRole } from '../authorization.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import {
  apiKeySchema,
  bulkReplaySchema,
  deliveryFilterSchema,
  endpointCreateSchema,
  memberSchema,
  projectSchema,
} from '../schemas/dashboard.js';

export function createProjectRouter({
  projectService,
  apiKeyService,
  endpointService,
  deliveryService,
  jwtAuth,
}) {
  const router = Router();

  router.use(jwtAuth);

  router.get('/projects', async (req, res) => {
    res
      .status(200)
      .json({ projects: await projectService.list({ memberships: req.auth.memberships }) });
  });

  router.post('/projects', validateBody(projectSchema), async (req, res) => {
    res
      .status(201)
      .json(await projectService.create({ userId: req.auth.userId, name: req.validated.name }));
  });

  router.patch(
    '/projects/:projectId',
    requireProjectRole(ROLES.OWNER),
    validateBody(projectSchema),
    async (req, res) => {
      res.status(200).json(
        await projectService.rename({
          projectId: req.params.projectId,
          name: req.validated.name,
        }),
      );
    },
  );

  router.get('/projects/:projectId/members', requireProjectRole(), async (req, res) => {
    res
      .status(200)
      .json({ members: await projectService.members({ projectId: req.params.projectId }) });
  });

  router.post(
    '/projects/:projectId/members',
    requireProjectRole(ROLES.OWNER),
    validateBody(memberSchema),
    async (req, res) => {
      res
        .status(201)
        .json(
          await projectService.addMember({ projectId: req.params.projectId, ...req.validated }),
        );
    },
  );

  router.delete(
    '/projects/:projectId/members/:userId',
    requireProjectRole(ROLES.OWNER),
    async (req, res) => {
      await projectService.removeMember({
        projectId: req.params.projectId,
        userId: req.params.userId,
      });

      res.status(204).end();
    },
  );

  router.get('/projects/:projectId/api-keys', requireProjectRole(), async (req, res) => {
    res
      .status(200)
      .json({ apiKeys: await apiKeyService.list({ projectId: req.params.projectId }) });
  });

  router.post(
    '/projects/:projectId/api-keys',
    requireProjectRole(ROLES.OWNER),
    validateBody(apiKeySchema),
    async (req, res) => {
      res
        .status(201)
        .json(
          await apiKeyService.create({ projectId: req.params.projectId, name: req.validated.name }),
        );
    },
  );

  router.delete(
    '/projects/:projectId/api-keys/:keyId',
    requireProjectRole(ROLES.OWNER),
    async (req, res) => {
      res
        .status(200)
        .json(
          await apiKeyService.revoke({ projectId: req.params.projectId, keyId: req.params.keyId }),
        );
    },
  );

  router.get('/projects/:projectId/endpoints', requireProjectRole(), async (req, res) => {
    res
      .status(200)
      .json({ endpoints: await endpointService.list({ projectId: req.params.projectId }) });
  });

  router.post(
    '/projects/:projectId/endpoints',
    requireProjectRole(ROLES.OWNER),
    validateBody(endpointCreateSchema),
    async (req, res) => {
      res
        .status(201)
        .json(await endpointService.create({ projectId: req.params.projectId, ...req.validated }));
    },
  );

  router.get(
    '/projects/:projectId/deliveries',
    requireProjectRole(),
    validateQuery(deliveryFilterSchema),
    async (req, res) => {
      res.status(200).json(
        await deliveryService.list({
          projectId: req.params.projectId,
          filters: req.validatedQuery,
        }),
      );
    },
  );

  router.post(
    '/projects/:projectId/deliveries/bulk-replay',
    requireProjectRole(),
    validateBody(bulkReplaySchema),
    async (req, res) => {
      res.status(202).json(
        await deliveryService.bulkReplay({
          projectId: req.params.projectId,
          filters: req.validated,
        }),
      );
    },
  );

  router.get('/projects/:projectId/stats', requireProjectRole(), async (req, res) => {
    res.status(200).json(await deliveryService.stats({ projectId: req.params.projectId }));
  });

  return router;
}
