/**
 * v1 recommendations: repositories sharing at least two technologies with the
 * developer's detected stack.
 *
 * All of the matching lives in public.recommend_repositories() — see
 * supabase/migrations/20260818000100_recommendations.sql. This module decides
 * what to ask it and, more importantly, what to say when there is nothing to
 * return. Three different situations produce zero recommendations and they need
 * three different answers, because "nothing found" is useless advice when the
 * fix is one click away.
 */

import { HttpError } from '../middleware/errors.js';
import { getSupabase } from './supabase.js';
import type { Profile } from './users.js';

/** Two shared technologies. The rule the whole feature is built around. */
export const MIN_TECH_OVERLAP = 2;

export const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

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
  contribution_difficulty: string | null;
  has_good_first_issues: boolean;
  last_commit_at: string | null;
  /** Which of the user's technologies this repository shares. The "why". */
  matched_tech: string[];
  overlap: number;
}

export type RecommendationResult =
  /** Matches found. */
  | { status: 'ok'; recommendations: Recommendation[]; techStack: string[] }
  /**
   * Fewer than two technologies on the profile, so the rule cannot be applied.
   * Common and not the user's fault — a private-work developer reaches this
   * with a perfectly good career behind them. The client turns it into an
   * invitation to fill the stack in, not an error.
   */
  | { status: 'insufficient_stack'; techStack: string[]; required: number }
  /** The corpus has not been seeded. A deployment problem, not a user one. */
  | { status: 'empty_corpus' }
  /** Real stack, real corpus, nothing overlapping twice. */
  | { status: 'no_matches'; techStack: string[] };

async function corpusIsEmpty(): Promise<boolean> {
  const { count, error } = await getSupabase()
    .from('repositories')
    .select('id', { count: 'exact', head: true });

  if (error) {
    throw new HttpError(502, 'Could not read the repository corpus', error.message);
  }

  return (count ?? 0) === 0;
}

/**
 * Recommendations for one developer.
 *
 * The two-technology rule runs against `tech_stack` alone — what they actually
 * hold. Stated preferences never decide *whether* a repository qualifies, only
 * the order of the ones that already have; a repository cannot get onto the
 * list because someone said they would like to learn Rust.
 */
export async function recommendFor(
  profile: Profile,
  limit: number = DEFAULT_LIMIT,
): Promise<RecommendationResult> {
  const techStack = profile.tech_stack ?? [];

  if (techStack.length < MIN_TECH_OVERLAP) {
    return { status: 'insufficient_stack', techStack, required: MIN_TECH_OVERLAP };
  }

  const { data, error } = await getSupabase().rpc('recommend_repositories', {
    p_tech_tags: techStack,
    p_min_overlap: MIN_TECH_OVERLAP,
    p_limit: Math.min(Math.max(1, limit), MAX_LIMIT),
    // Tiebreakers only. Null is a perfectly good answer for both — the RPC
    // treats an absent preference as "no opinion" rather than as a filter.
    p_preferred_languages: profile.preferred_languages?.length
      ? profile.preferred_languages
      : null,
    p_difficulty: profile.difficulty_preference ?? null,
    p_exclude_owner: profile.github_username ?? null,
  });

  if (error) {
    throw new HttpError(502, 'Could not load recommendations', error.message);
  }

  const recommendations = (data ?? []) as Recommendation[];

  if (recommendations.length > 0) {
    return { status: 'ok', recommendations, techStack };
  }

  // Only now worth a second query: distinguishing "we have nothing indexed" from
  // "we have plenty and none of it fits you" is the difference between a note
  // telling the operator to run the ingestion job and one telling the user
  // their stack is unusual.
  return (await corpusIsEmpty())
    ? { status: 'empty_corpus' }
    : { status: 'no_matches', techStack };
}
