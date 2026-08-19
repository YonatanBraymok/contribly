import type { AuthenticatedUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import type { ProfileAnalysis } from './profile/types.js';
import { getSupabase } from './supabase.js';

/**
 * The profile as the client sees it. Deliberately enumerated rather than
 * `select *`: the row also holds `profile_embedding` (1536 floats) and
 * `analysis` (several kilobytes of derivation detail), neither of which most
 * callers want and both of which would dominate the response. The analysis
 * blob has its own endpoint, which matters because onboarding polls this one
 * every couple of seconds.
 */
const PROFILE_COLUMNS = [
  'id',
  'email',
  'github_username',
  'github_id',
  'avatar_url',
  'tech_stack',
  'language_proficiency',
  'complexity_level',
  'complexity_score',
  'learning_goals',
  'preferred_languages',
  'contribution_goals',
  'weekly_hours',
  'difficulty_preference',
  'onboarding_completed_at',
  'tech_stack_edited_at',
  'sync_status',
  'sync_started_at',
  'sync_error',
  'last_synced_at',
  'created_at',
  'updated_at',
].join(', ');

export type SyncStatus = 'pending' | 'running' | 'ready' | 'failed';

export interface Profile {
  id: string;
  email: string | null;
  github_username: string | null;
  github_id: number | null;
  avatar_url: string | null;
  tech_stack: string[];
  language_proficiency: Record<string, number>;
  complexity_level: string;
  complexity_score: number | null;
  learning_goals: string[];
  preferred_languages: string[];
  contribution_goals: string[];
  weekly_hours: number | null;
  difficulty_preference: string | null;
  onboarding_completed_at: string | null;
  tech_stack_edited_at: string | null;
  sync_status: SyncStatus;
  sync_started_at: string | null;
  sync_error: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Drops undefined keys so an absent claim never overwrites a stored value. */
function defined<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * Writes the GitHub identity from the session onto the profile row.
 *
 * public.handle_new_user() already creates the row on first sign-in, so this is
 * normally a refresh — usernames and avatars change. It upserts rather than
 * updates so the profile still appears if that trigger never ran, which is the
 * case against the local Postgres shim where nothing inserts into auth.users.
 */
export async function syncProfile(user: AuthenticatedUser): Promise<Profile> {
  const { data, error } = await getSupabase()
    .from('users')
    .upsert(
      defined({
        id: user.id,
        email: user.email,
        github_username: user.username,
        github_id: user.githubId,
        avatar_url: user.avatarUrl,
      }),
      { onConflict: 'id' },
    )
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    throw new HttpError(502, 'Could not save profile', error.message);
  }

  return data as unknown as Profile;
}

/** Reads a profile, or null when no row exists yet. */
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(502, 'Could not load profile', error.message);
  }

  return (data as unknown as Profile) ?? null;
}

/**
 * The full derivation behind the profile — what the dashboard shows when
 * someone asks why they were called intermediate.
 *
 * Split from getProfile because it is large and rarely needed: onboarding
 * polls the profile every couple of seconds and has no use for it.
 */
export async function getAnalysis(userId: string): Promise<ProfileAnalysis | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('analysis')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(502, 'Could not load analysis', error.message);
  }

  const analysis = (data as { analysis?: ProfileAnalysis } | null)?.analysis;

  // The column defaults to '{}', which is not an analysis — it is the absence
  // of one, and the caller should be able to tell the difference.
  return analysis && Object.keys(analysis).length > 0 ? analysis : null;
}

/** The fields onboarding and the preferences UI are allowed to write. */
export interface PreferencesUpdate {
  tech_stack?: string[];
  tech_stack_edited_at?: string;
  learning_goals?: string[];
  preferred_languages?: string[];
  contribution_goals?: string[];
  weekly_hours?: number | null;
  difficulty_preference?: string | null;
  onboarding_completed_at?: string;
}

export async function updatePreferences(
  userId: string,
  update: PreferencesUpdate,
): Promise<Profile> {
  const { data, error } = await getSupabase()
    .from('users')
    .update(defined(update as Record<string, unknown>))
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    throw new HttpError(502, 'Could not save preferences', error.message);
  }

  return data as unknown as Profile;
}

/**
 * Stores the GitHub access token handed back by the OAuth exchange.
 *
 * Lives in github_credentials rather than on the profile: RLS lets a user read
 * their own profile row, and this token must stay server-side.
 */
export async function storeGitHubToken(
  userId: string,
  accessToken: string,
  scopes: string[],
): Promise<void> {
  const { error } = await getSupabase()
    .from('github_credentials')
    .upsert(
      { user_id: userId, access_token: accessToken, scopes },
      { onConflict: 'user_id' },
    );

  if (error) {
    throw new HttpError(502, 'Could not store GitHub credentials', error.message);
  }
}

/**
 * Reads the stored GitHub token. Service-role only, which is the whole reason
 * github_credentials has RLS on and no policies.
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('github_credentials')
    .select('access_token')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(502, 'Could not read GitHub credentials', error.message);
  }

  return (data as { access_token?: string } | null)?.access_token ?? null;
}
