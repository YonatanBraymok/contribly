/**
 * The profile sync run: lifecycle, throttling, and persistence.
 *
 * Runs in-process, in the background, and reports progress through
 * `users.sync_status` so the client can poll `GET /api/v1/me`. There is no
 * queue and no worker container behind this — deliberately. A single job type
 * that runs once per user per six hours does not earn a fourth service, and
 * every decision below is about making that honest rather than pretending the
 * failure modes do not exist.
 *
 * The one it cannot hide: an in-process task dies with the process. A run
 * killed by a restart leaves `sync_status = 'running'` forever, so
 * `isStaleRun()` treats a run that started long enough ago as abandoned and
 * lets the next request re-kick it. Cheap, self-healing, no job table.
 */

import { GitHubError, GitHubRateLimitError } from '../github/client.js';
import { getGitHubToken } from '../users.js';
import { getSupabase } from '../supabase.js';
import { analyzeProfile } from './analyze.js';

/** Re-syncing more often than this buys nothing — GitHub profiles move slowly. */
export const SYNC_THROTTLE_HOURS = 6;

/**
 * A 'running' row older than this belonged to a process that is gone.
 *
 * Generous next to a sync's real duration (a few seconds) because the cost of
 * being wrong is asymmetric: re-kicking a live run wastes ~39 API calls, while
 * declaring a live run dead too eagerly could have two runs writing the same
 * row. Ten minutes is far past any legitimate run.
 */
export const STALE_RUN_MINUTES = 10;

export type SyncOutcome =
  | 'started'
  | 'already_running'
  | 'throttled'
  | 'no_token'
  | 'unavailable';

/**
 * Users with a run in flight in *this* process.
 *
 * Per-process, so it is a hard guard for a single API container and a
 * best-effort one behind a load balancer. Acceptable while the operation is
 * idempotent and six-hour-throttled: the worst case is duplicated work, not a
 * corrupted profile. When it stops being acceptable, the answer is the worker
 * container, and nothing here obstructs that.
 */
const inFlight = new Set<string>();

interface SyncState {
  sync_status: string | null;
  sync_started_at: string | null;
  last_synced_at: string | null;
  tech_stack_edited_at: string | null;
}

function minutesSince(iso: string | null): number {
  if (!iso) {
    return Number.POSITIVE_INFINITY;
  }

  const then = new Date(iso).getTime();

  return Number.isFinite(then) ? (Date.now() - then) / 60_000 : Number.POSITIVE_INFINITY;
}

export function isStaleRun(status: string | null, startedAt: string | null): boolean {
  return status === 'running' && minutesSince(startedAt) > STALE_RUN_MINUTES;
}

async function readSyncState(userId: string): Promise<SyncState | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('sync_status, sync_started_at, last_synced_at, tech_stack_edited_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read sync state: ${error.message}`);
  }

  return (data as unknown as SyncState) ?? null;
}

async function writeSyncState(
  userId: string,
  update: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabase().from('users').update(update).eq('id', userId);

  if (error) {
    // Nothing useful to do about it here — this is already the background path,
    // and throwing would only produce an unhandled rejection.
    console.error(`[profile-sync] could not write sync state for ${userId}:`, error.message);
  }
}

/** Turns whatever went wrong into something worth showing a user. */
function describeFailure(error: unknown): string {
  if (error instanceof GitHubRateLimitError) {
    const resets = error.resetAt ? ` Resets at ${error.resetAt.toISOString()}.` : '';
    return `GitHub rate limit reached.${resets}`;
  }

  if (error instanceof GitHubError && error.isAuthFailure) {
    return 'GitHub rejected the stored token. Sign in again to reconnect your account.';
  }

  if (error instanceof GitHubError && error.isNotFound) {
    return 'GitHub could not find that account. It may have been renamed or deleted.';
  }

  return error instanceof Error ? error.message : 'Profile sync failed';
}

/**
 * The run itself. Never throws — it is invoked without an awaiting caller, so
 * a rejection here would surface as an unhandled promise and take the process
 * down under Node's default policy.
 */
async function runSync(userId: string, token: string, techStackEdited: boolean): Promise<void> {
  try {
    const derivation = await analyzeProfile(token);

    await writeSyncState(userId, {
      // While tech_stack_edited_at is null the sync owns this column. Once the
      // user has corrected their stack by hand, it stops writing it and only
      // updates `analysis` — otherwise every re-sync would quietly undo the
      // correction they just made, which is the fastest way to lose someone's
      // trust in the whole profile.
      ...(techStackEdited ? {} : { tech_stack: derivation.techStack }),
      language_proficiency: derivation.languageProficiency,
      complexity_level: derivation.complexityLevel,
      complexity_score: derivation.complexityScore,
      analysis: derivation.analysis,
      last_synced_at: new Date().toISOString(),
      sync_status: 'ready',
      sync_error: null,
    });

    console.log(
      `[profile-sync] ${userId} ready — ${derivation.techStack.length} stack entries, ` +
        `complexity ${derivation.complexityScore} (${derivation.complexityLevel})`,
    );
  } catch (error) {
    const message = describeFailure(error);
    console.error(`[profile-sync] ${userId} failed:`, message);

    await writeSyncState(userId, { sync_status: 'failed', sync_error: message });
  } finally {
    inFlight.delete(userId);
  }
}

export interface KickOptions {
  /** Bypass the six-hour throttle. Behind `?force=1` on the sync route. */
  force?: boolean;
}

/**
 * Starts a background sync if one is warranted, and returns immediately.
 *
 * Safe to call speculatively — from the auth callback, from a page load, from
 * a button — because every reason not to run is checked here rather than by
 * the caller.
 */
export async function kickProfileSync(
  userId: string,
  { force = false }: KickOptions = {},
): Promise<SyncOutcome> {
  if (inFlight.has(userId)) {
    return 'already_running';
  }

  const state = await readSyncState(userId);

  if (!state) {
    return 'unavailable';
  }

  // A 'running' row this process knows nothing about is either another
  // container's live run or the residue of one that died. Only the second is
  // ours to take over.
  if (state.sync_status === 'running' && !isStaleRun(state.sync_status, state.sync_started_at)) {
    return 'already_running';
  }

  if (!force && minutesSince(state.last_synced_at) < SYNC_THROTTLE_HOURS * 60) {
    return 'throttled';
  }

  const token = await getGitHubToken(userId);

  if (!token) {
    await writeSyncState(userId, {
      sync_status: 'failed',
      sync_error:
        'No GitHub token stored. Sign out and sign in again to reconnect your account.',
    });

    return 'no_token';
  }

  inFlight.add(userId);

  await writeSyncState(userId, {
    sync_status: 'running',
    sync_started_at: new Date().toISOString(),
    sync_error: null,
  });

  // Deliberately not awaited: the caller gets its 202 now, and runSync owns
  // every outcome from here.
  void runSync(userId, token, Boolean(state.tech_stack_edited_at));

  return 'started';
}

/**
 * Re-kicks a sync that a restart abandoned.
 *
 * Called from GET /api/v1/me, which is the one route every signed-in user hits,
 * making it the natural place to notice and heal a stuck row.
 */
export async function recoverStaleSync(
  userId: string,
  status: string | null,
  startedAt: string | null,
): Promise<boolean> {
  if (!isStaleRun(status, startedAt)) {
    return false;
  }

  console.warn(`[profile-sync] ${userId} run looks abandoned — restarting`);
  const outcome = await kickProfileSync(userId, { force: true });

  return outcome === 'started';
}
