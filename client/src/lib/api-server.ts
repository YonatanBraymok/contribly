import { apiFetch, type ApiResult } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

/** The profile shape returned by GET /api/v1/me. */
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
}

/**
 * Calls the API as the signed-in user.
 *
 * Reads the token with getSession rather than getUser: the point here is to
 * forward the JWT, and the API verifies it against Supabase anyway, so a
 * second round trip to re-check it before sending would buy nothing.
 *
 * Server-side only — it reads the session cookies.
 */
export async function apiFetchAuthed<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { ok: false, error: "Not signed in" };
  }

  return apiFetch<T>(path, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
}

/** The current user's profile, or an error the page can render around. */
export function fetchProfile(): Promise<ApiResult<{ profile: Profile }>> {
  return apiFetchAuthed<{ profile: Profile }>("/api/v1/me");
}
