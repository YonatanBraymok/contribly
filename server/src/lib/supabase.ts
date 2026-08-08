import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

let client: SupabaseClient | null = null;

/**
 * Lazily-constructed service-role Supabase client.
 *
 * Kept lazy so the API (and its health check) still boots when Supabase
 * credentials are absent — useful for local scaffolding and CI smoke tests.
 */
export function getSupabase(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env',
    );
  }

  client ??= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
