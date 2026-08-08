import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { apiRouter, healthRouter } from './routes/index.js';

/**
 * Builds the Express app without binding a port, so tests can drive it
 * in-process via supertest.
 */
export function createApp(): Express {
  const app = express();

  // Behind Docker/a reverse proxy, trust the first hop for correct client IPs.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));

  // Health checks sit outside the versioned API so probes survive version bumps.
  app.use('/', healthRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
