import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./config";

/**
 * Supabase client for Client Components.
 *
 * `createBrowserClient` memoises internally, so calling this on every render is
 * fine — you get the same underlying client back.
 */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
