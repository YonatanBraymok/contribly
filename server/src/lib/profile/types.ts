/**
 * The shape of `public.users.analysis`.
 *
 * Persisted whole as one jsonb blob rather than spread across a dozen columns:
 * the derivation will churn hard for a while yet and the schema should not
 * churn with it. Anything the matching query eventually needs to *filter* on
 * gets promoted to a real column at that point.
 *
 * `version` is what makes that safe. A stored analysis records the algorithm
 * that produced it, so a reader can tell an old blob from a current one and a
 * re-sync can be forced when the shape moves on.
 */

export const ANALYSIS_VERSION = 1;

export type ComplexityLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/**
 * How much the derived signals should be trusted relative to what the user
 * told us. `low` means the public profile was too thin to read anything from,
 * which is common and says nothing about the developer.
 */
export type Confidence = 'low' | 'medium' | 'high';

export interface LanguageShare {
  name: string;
  /** Share of the weighted total, over the languages kept. Sums to ~1. */
  share: number;
  bytes: number;
  repos: number;
}

/** Where a framework was spotted. `starred` alone is interest, not experience. */
export type FrameworkSource = 'topic' | 'description' | 'starred';

export interface FrameworkHit {
  name: string;
  /** Distinct pieces of evidence. Two are required to enter `tech_stack`. */
  mentions: number;
  sources: FrameworkSource[];
}

export interface InterestTopic {
  topic: string;
  count: number;
}

export interface ComplexityComponent {
  points: number;
  max: number;
  /** Plain-language reason, rendered directly in the dashboard breakdown. */
  note: string;
}

export interface ComplexityBreakdown {
  score: number;
  level: ComplexityLevel;
  components: Record<string, ComplexityComponent>;
}

export interface GitHubStats {
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
}

/** One entry per API call attempted, so a partial sync explains itself. */
export interface SourceStatus {
  endpoint: string;
  ok: boolean;
  error?: string;
}

export interface ProfileAnalysis {
  version: number;
  generated_at: string;
  confidence: Confidence;
  github: GitHubStats;
  languages: LanguageShare[];
  frameworks: FrameworkHit[];
  interests: InterestTopic[];
  complexity: ComplexityBreakdown;
  sources: SourceStatus[];
}
