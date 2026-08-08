import 'dotenv/config';
import { z } from 'zod';

/**
 * Single source of truth for configuration. The process refuses to boot on an
 * invalid environment rather than failing later at the first Supabase call.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Comma-separated list of origins allowed to call the API.
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Supabase. The service-role key bypasses RLS — server-side only, never ship
  // it to the client.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Dimensionality of the stored embeddings. Must match the vector(n) column
  // in supabase/migrations and the model that produces them.
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
});

// Docker Compose substitutes unset variables as empty strings rather than
// omitting them, so drop blanks to let `.optional()` fields read as absent.
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== ''),
);

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export type Env = typeof env;
