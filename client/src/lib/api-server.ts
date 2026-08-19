import { apiFetch, type ApiResult } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export type SyncStatus = "pending" | "running" | "ready" | "failed";
export type ComplexityLevel =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "expert";

/** The profile shape returned by GET /api/v1/me. */
export interface Profile {
  id: string;
  email: string | null;
  github_username: string | null;
  github_id: number | null;
  avatar_url: string | null;
  tech_stack: string[];
  language_proficiency: Record<string, number>;
  complexity_level: ComplexityLevel;
  complexity_score: number | null;
  learning_goals: string[];
  preferred_languages: string[];
  contribution_goals: string[];
  weekly_hours: number | null;
  difficulty_preference: ComplexityLevel | null;
  onboarding_completed_at: string | null;
  tech_stack_edited_at: string | null;
  sync_status: SyncStatus;
  sync_started_at: string | null;
  sync_error: string | null;
  last_synced_at: string | null;
}

/** Mirrors the server's ProfileAnalysis — see server/src/lib/profile/types.ts. */
export interface ProfileAnalysis {
  version: number;
  generated_at: string;
  confidence: "low" | "medium" | "high";
  github: {
    login: string;
    account_created_at: string | null;
    public_repos: number;
    followers: number;
    non_fork_repos: number;
    max_stars: number;
    external_merged_prs: number;
    active_months_last_year: number;
    events_analysed: number;
    events_window_days: number;
    external_collaboration_events: number;
  };
  languages: { name: string; share: number; bytes: number; repos: number }[];
  frameworks: {
    name: string;
    mentions: number;
    sources: ("topic" | "description" | "starred")[];
  }[];
  interests: { topic: string; count: number }[];
  complexity: {
    score: number;
    level: ComplexityLevel;
    components: Record<
      string,
      { points: number; max: number; note: string }
    >;
  };
  sources: { endpoint: string; ok: boolean; error?: string }[];
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

/**
 * The full derivation behind the profile.
 *
 * Null until the first sync finishes — the column defaults to an empty object,
 * and the API turns that into an explicit null so callers can tell "not yet"
 * from "nothing found".
 */
export function fetchAnalysis(): Promise<
  ApiResult<{ analysis: ProfileAnalysis | null }>
> {
  return apiFetchAuthed<{ analysis: ProfileAnalysis | null }>(
    "/api/v1/me/analysis",
  );
}

export interface PreferencesUpdate {
  tech_stack?: string[];
  learning_goals?: string[];
  preferred_languages?: string[];
  contribution_goals?: string[];
  weekly_hours?: number | null;
  difficulty_preference?: ComplexityLevel | null;
  complete_onboarding?: boolean;
}

export function savePreferences(
  update: PreferencesUpdate,
): Promise<ApiResult<{ profile: Profile }>> {
  return apiFetchAuthed<{ profile: Profile }>("/api/v1/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export interface Recommendation {
  id: string;
  full_name: string;
  description: string | null;
  html_url: string;
  primary_language: string | null;
  topics: string[];
  tech_tags: string[];
  stars: number;
  open_issues_count: number;
  contribution_difficulty: ComplexityLevel | null;
  has_good_first_issues: boolean;
  last_commit_at: string | null;
  /** Which of the user's technologies this repository shares — the "why". */
  matched_tech: string[];
  overlap: number;
}

/**
 * Four outcomes, because three different situations produce zero results and
 * each needs a different thing said about it. See the server's
 * lib/recommendations.ts.
 */
export type RecommendationResult =
  | { status: "ok"; recommendations: Recommendation[]; techStack: string[] }
  | { status: "insufficient_stack"; techStack: string[]; required: number }
  | { status: "empty_corpus" }
  | { status: "no_matches"; techStack: string[] };

export function fetchRecommendations(): Promise<ApiResult<RecommendationResult>> {
  return apiFetchAuthed<RecommendationResult>("/api/v1/recommendations");
}

/** Kicks a background re-sync. Returns immediately; poll the profile for the result. */
export function requestSync(
  force = false,
): Promise<ApiResult<{ outcome: string; sync_status: SyncStatus }>> {
  return apiFetchAuthed<{ outcome: string; sync_status: SyncStatus }>(
    `/api/v1/me/sync${force ? "?force=1" : ""}`,
    { method: "POST" },
  );
}
