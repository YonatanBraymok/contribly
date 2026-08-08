import { createApp } from './app.js';
import { env } from './config/env.js';
import { isSupabaseConfigured } from './lib/supabase.js';

const app = createApp();

// 0.0.0.0 so the container port mapping reaches the process.
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`[contribly-api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  console.log(`[contribly-api] health: http://localhost:${env.PORT}/health`);
  if (!isSupabaseConfigured()) {
    console.warn('[contribly-api] Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
});

// Let in-flight requests finish before the container is torn down.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[contribly-api] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
