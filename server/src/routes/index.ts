import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { healthRouter } from './health.routes.js';
import { meRouter } from './me.routes.js';
import { recommendationsRouter } from './recommendations.routes.js';

/** Versioned API surface. Feature routers (matching, profiles, repos) mount here. */
export const apiRouter: Router = Router();

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'Contribly API',
    version: 'v1',
    endpoints: [
      '/health',
      '/health/ready',
      '/api/v1',
      '/api/v1/auth/session',
      '/api/v1/me',
      '/api/v1/me/sync',
      '/api/v1/me/analysis',
      '/api/v1/me/preferences',
      '/api/v1/recommendations',
    ],
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/recommendations', recommendationsRouter);

export { healthRouter };
