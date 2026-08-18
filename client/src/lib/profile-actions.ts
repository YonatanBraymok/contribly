"use server";

import { fetchProfile, requestSync, type SyncStatus } from "@/lib/api-server";

/**
 * The slice of the profile a client component polls for while the background
 * analysis runs.
 *
 * Deliberately narrow: this round-trips every couple of seconds, and the caller
 * only needs to know whether the analysis has finished and what it found.
 *
 * Server Actions rather than Route Handlers because the session already lives
 * in cookies the server can read — a handler would exist only to forward a JWT
 * that api-server.ts forwards anyway.
 */
export interface SyncSnapshot {
  sync_status: SyncStatus;
  sync_error: string | null;
  tech_stack: string[];
  languages: string[];
  error?: string;
}

export async function pollSync(): Promise<SyncSnapshot> {
  const result = await fetchProfile();

  if (!result.ok) {
    // A transient API failure must not look like a failed analysis: the poller
    // keeps going, and the UI keeps letting the user move forward.
    return {
      sync_status: "running",
      sync_error: null,
      tech_stack: [],
      languages: [],
      error: result.error,
    };
  }

  const { profile } = result.data;

  return {
    sync_status: profile.sync_status,
    sync_error: profile.sync_error,
    tech_stack: profile.tech_stack,
    // Ordered by share — Postgres preserves jsonb key order as written.
    languages: Object.keys(profile.language_proficiency),
  };
}

/** Retries or refreshes an analysis. Bypasses the six-hour throttle. */
export async function retrySync(): Promise<{ ok: boolean; error?: string }> {
  const result = await requestSync(true);

  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
