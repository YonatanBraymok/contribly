import type { AuthenticatedUser } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { getSupabase } from './supabase.js';

/**
 * The profile as the client sees it. Deliberately enumerated rather than
 * `select *`: the row also holds `profile_embedding`, 1536 floats that no
 * caller needs and that would dominate the response.
 */
const PROFILE_COLUMNS =
  'id, email, github_username, github_id, avatar_url, tech_stack, language_proficiency, complexity_level, learning_goals, last_synced_at, created_at, updated_at';

export interface Profile {
  id: string;
  email: string | null;
  github_username: string | null;
  github_id: number | null;
  avatar_url: string | null;
  tech_stack: string[];
  language_proficiency: Record<string, number>;
  complexity_level: string;
  learning_goals: string[];
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
