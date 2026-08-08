import { Router } from 'express';
import { healthRouter } from './health.routes.js';

/** Versioned API surface. Feature routers (matching, profiles, repos) mount here. */
export const apiRouter: Router = Router();

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'Contribly API',
    version: 'v1',
    endpoints: ['/health', '/health/ready', '/api/v1'],
  });
});

export { healthRouter };
