import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { loginSchema, registerSchema } from '../schemas/dashboard.js';

export const REFRESH_COOKIE = 'ht_refresh';

const REFRESH_PATH = '/v1/auth';

// Secure is off outside production on purpose: the compose stack serves plain
// HTTP on localhost, and a Secure cookie would never be stored there, which
// reads as a broken login rather than as a security setting.
function refreshCookieOptions(config, expires) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: REFRESH_PATH,
    secure: config.NODE_ENV === 'production',
    expires,
  };
}

export function createAuthRouter({ authService, config, jwtAuth, authRateLimit }) {
  const router = Router();

  function respondWithSession(res, status, { refresh, ...body }) {
    res.cookie(REFRESH_COOKIE, refresh.token, refreshCookieOptions(config, refresh.expiresAt));
    res.status(status).json(body);
  }

  router.post('/auth/register', authRateLimit, validateBody(registerSchema), async (req, res) => {
    respondWithSession(res, 201, await authService.register(req.validated));
  });

  router.post('/auth/login', authRateLimit, validateBody(loginSchema), async (req, res) => {
    respondWithSession(res, 200, await authService.login(req.validated));
  });

  router.post('/auth/refresh', authRateLimit, async (req, res) => {
    respondWithSession(
      res,
      200,
      await authService.refresh({ token: req.cookies?.[REFRESH_COOKIE] }),
    );
  });

  router.post('/auth/logout', async (req, res) => {
    await authService.logout({ token: req.cookies?.[REFRESH_COOKIE] });

    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(config));
    res.status(204).end();
  });

  router.get('/auth/me', jwtAuth, async (req, res) => {
    res.status(200).json(await authService.me({ userId: req.auth.userId }));
  });

  return router;
}
