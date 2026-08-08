import { Router } from 'express';
import { env } from '../config/env.js';
import { isSupabaseConfigured } from '../lib/supabase.js';

export const healthRouter: Router = Router();

const startedAt = Date.now();

/** Liveness — is the process up? Used by Docker's healthcheck. */
healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'contribly-api',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness — is the process able to serve traffic? Reports on downstream
 * dependencies without taking the whole service down when they are missing.
 */
healthRouter.get('/health/ready', (_req, res) => {
  const checks = {
    supabase: isSupabaseConfigured() ? 'configured' : 'not_configured',
  };

  const ready = Object.values(checks).every((value) => value === 'configured');

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});
