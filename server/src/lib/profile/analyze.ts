/**
 * Turns a GitHub token into a ProfileAnalysis.
 *
 * Split in two on purpose. `fetchRawProfile` is the only thing here that
 * touches the network; `deriveProfile` is pure, taking the collected responses
 * and producing the analysis. That seam is what lets src/scripts/analyze-fixture.ts
 * replay a saved capture through the *exact* derivation the server runs — the
 * weights below are guesses until they are tuned against real accounts, and
 * tuning them against the live API would be slow, rate-limited and
 * irreproducible.
 */

import {
  GitHubClient,
  GitHubError,
  mapWithConcurrency,
} from '../github/client.js';
import {
  EVENT_WINDOW_DAYS,
  countExternalMergedPrs,
  fetchPublicEvents,
  fetchRepoLanguages,
  fetchRepos,
  fetchStarred,
  fetchUser,
  fetchViewer,
  type GitHubEvent,
  type GitHubLanguages,
  type GitHubRepo,
  type GitHubUser,
} from '../github/endpoints.js';
import { scoreComplexity } from './complexity.js';
import { detectFrameworks, qualifiesForStack } from './frameworks.js';
import { aggregateInterests } from './interests.js';
import {
  computeLanguageProficiency,
  isCoreLanguage,
  type RepoLanguageInput,
} from './languages.js';
import {
  ANALYSIS_VERSION,
  type ComplexityLevel,
  type Confidence,
  type ProfileAnalysis,
  type SourceStatus,
} from './types.js';

/** One call each, so this is the ceiling on the expensive part of a sync. */
const TOP_REPOS_FOR_LANGUAGES = 30;

/** GitHub's stated ceiling is far above this; bursts trip secondary limits first. */
const LANGUAGE_FETCH_CONCURRENCY = 5;

/** A language needs this share before it is named as part of someone's stack. */
const STACK_MIN_LANGUAGE_SHARE = 0.05;

const MAX_TECH_STACK = 15;

/** Events that count as helping on somebody else's project. */
const COLLABORATION_EVENTS = new Set([
  'PullRequestReviewEvent',
  'PullRequestReviewCommentEvent',
  'IssueCommentEvent',
  'PullRequestEvent',
  'IssuesEvent',
]);

/**
 * Everything the six calls returned. JSON-serialisable by construction, which
 * is what makes it usable as a fixture.
 */
export interface RawProfileData {
  /**
   * When the capture was taken. Every recency weight is relative to this, so
   * replaying a fixture without it would produce a different answer each day
   * and make the heuristics impossible to tune against.
   */
  captured_at: string;
  viewer: GitHubUser;
  repos: GitHubRepo[];
  events: GitHubEvent[];
  starred: GitHubRepo[];
  externalMergedPrs: number;
  repoLanguages: { full_name: string; languages: GitHubLanguages }[];
  sources: SourceStatus[];
}

/** What a sync writes back to public.users. */
export interface ProfileDerivation {
  analysis: ProfileAnalysis;
  techStack: string[];
  languageProficiency: Record<string, number>;
  complexityLevel: ComplexityLevel;
  complexityScore: number;
}

// -----------------------------------------------------------------------------
// Fetch
// -----------------------------------------------------------------------------

/**
 * Runs an optional source, recording success or failure instead of throwing.
 *
 * Each of these degrades one signal rather than the analysis. Losing the
 * starred list costs some interest topics; losing the PR count costs the
 * heaviest complexity component but still leaves five others. Failing the whole
 * sync over either would be worse than shipping a slightly thinner profile, and
 * `sources` records exactly what was missing.
 */
async function attempt<T>(
  endpoint: string,
  statuses: SourceStatus[],
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    const value = await run();
    statuses.push({ endpoint, ok: true });
    return value;
  } catch (error) {
    statuses.push({
      endpoint,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export interface FetchOptions {
  /** Analyse this account instead of the token's owner. Fixture capture only. */
  login?: string;
}

export async function fetchRawProfile(
  token: string,
  { login: loginOverride }: FetchOptions = {},
): Promise<RawProfileData> {
  const client = new GitHubClient(token);
  const sources: SourceStatus[] = [];
  const capturedAt = new Date().toISOString();

  // Load-bearing: without an identity and a repository list there is nothing to
  // analyse, so these two throw rather than degrade.
  const viewer = loginOverride
    ? await fetchUser(client, loginOverride)
    : await fetchViewer(client);
  sources.push({ endpoint: loginOverride ? 'GET /users/{login}' : 'GET /user', ok: true });

  const login = viewer.login;

  const repos = await fetchRepos(client, login);
  sources.push({ endpoint: 'GET /users/{login}/repos', ok: true });

  // Independent of one another, so they overlap rather than queue.
  const [events, starred, externalMergedPrs] = await Promise.all([
    attempt('GET /users/{login}/events/public', sources, [] as GitHubEvent[], () =>
      fetchPublicEvents(client, login),
    ),
    attempt('GET /users/{login}/starred', sources, [] as GitHubRepo[], () =>
      fetchStarred(client, login),
    ),
    attempt('GET /search/issues', sources, 0, () => countExternalMergedPrs(client, login)),
  ]);

  // Most recently pushed first, so the thirty we can afford are the thirty that
  // describe what this developer is doing now. Repos with no primary language
  // are empty or docs-only and would spend a call to return `{}`.
  const languageTargets = repos
    .filter((repo) => repo.language !== null)
    .slice(0, TOP_REPOS_FOR_LANGUAGES);

  const repoLanguages: { full_name: string; languages: GitHubLanguages }[] = [];

  await mapWithConcurrency(languageTargets, LANGUAGE_FETCH_CONCURRENCY, async (repo) => {
    try {
      repoLanguages.push({
        full_name: repo.full_name,
        languages: await fetchRepoLanguages(client, repo.full_name),
      });
    } catch (error) {
      // A single repo going private or being renamed mid-sweep is routine and
      // must not cost the other twenty-nine.
      if (!(error instanceof GitHubError)) {
        throw error;
      }
    }
  });

  sources.push({
    endpoint: 'GET /repos/{owner}/{repo}/languages',
    ok: repoLanguages.length > 0 || languageTargets.length === 0,
    ...(repoLanguages.length === 0 && languageTargets.length > 0
      ? { error: 'No repository language data could be read' }
      : {}),
  });

  return {
    captured_at: capturedAt,
    viewer,
    repos,
    events,
    starred,
    externalMergedPrs,
    repoLanguages,
    sources,
  };
}

// -----------------------------------------------------------------------------
// Derive — pure from here down
// -----------------------------------------------------------------------------

function monthKey(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }

  const date = new Date(iso);

  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 7) : null;
}

/**
 * Distinct months with activity in the last twelve.
 *
 * Assembled from two partial views because neither is enough alone: the public
 * events feed stops at 90 days, and a repository's `pushed_at` records only its
 * most recent push. Their union under-counts a prolific developer — several
 * pushes in one month to one repository look like one month — which is the safe
 * direction for a score to be wrong in.
 */
function activeMonthsLastYear(
  repos: readonly GitHubRepo[],
  events: readonly GitHubEvent[],
  now: Date,
): number {
  const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const months = new Set<string>();

  for (const repo of repos) {
    if (repo.pushed_at && new Date(repo.pushed_at) >= cutoff) {
      const key = monthKey(repo.pushed_at);
      if (key) months.add(key);
    }
  }

  for (const event of events) {
    const key = monthKey(event.created_at);
    if (key) months.add(key);
  }

  return Math.min(12, months.size);
}

function pushEventsByRepo(events: readonly GitHubEvent[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const event of events) {
    if (event.type === 'PushEvent' && event.repo?.name) {
      counts.set(event.repo.name, (counts.get(event.repo.name) ?? 0) + 1);
    }
  }

  return counts;
}

function countExternalCollaboration(
  events: readonly GitHubEvent[],
  login: string,
): number {
  const ownerPrefix = `${login.toLowerCase()}/`;

  return events.filter((event) => {
    if (!event.type || !COLLABORATION_EVENTS.has(event.type)) {
      return false;
    }

    const name = event.repo?.name?.toLowerCase();

    return Boolean(name && !name.startsWith(ownerPrefix));
  }).length;
}

/**
 * How much the derived signals should be trusted next to what the user said.
 *
 * The `low` case matters more than it looks: plenty of strong developers have
 * an empty public profile because all their work sits behind a company
 * firewall. Saying so lets the UI lean on the questionnaire instead of quietly
 * labelling a principal engineer a beginner.
 */
function assessConfidence(
  nonForkRepos: number,
  eventCount: number,
  externalPrs: number,
  repoCount: number,
  sources: readonly SourceStatus[],
): Confidence {
  if (nonForkRepos < 3 && eventCount === 0) {
    return 'low';
  }

  const complete = sources.every((source) => source.ok);

  // `high` is a claim that we saw enough to be sure. A sync missing a source
  // has not, however good the part it did read looks.
  if (complete && externalPrs > 0 && eventCount >= 20 && repoCount >= 5) {
    return 'high';
  }

  return 'medium';
}

/** Pure: the same inputs always produce the same analysis. */
export function deriveProfile(
  raw: RawProfileData,
  now: Date = new Date(),
): ProfileDerivation {
  const { viewer, repos, events, starred, externalMergedPrs, repoLanguages } = raw;
  const login = viewer.login;

  const pushCounts = pushEventsByRepo(events);
  const reposByName = new Map(repos.map((repo) => [repo.full_name, repo]));

  const languageInputs: RepoLanguageInput[] = repoLanguages.flatMap((entry) => {
    const repo = reposByName.get(entry.full_name);

    return repo
      ? [{ repo, languages: entry.languages, pushEvents: pushCounts.get(entry.full_name) ?? 0 }]
      : [];
  });

  const languages = computeLanguageProficiency(languageInputs, now);
  const frameworks = detectFrameworks({ ownRepos: repos, starredRepos: starred }, now);
  const interests = aggregateInterests({
    starredRepos: starred,
    forkedRepos: repos.filter((repo) => repo.fork),
  });

  const nonForks = repos.filter((repo) => !repo.fork);
  const maxStars = nonForks.reduce((best, repo) => Math.max(best, repo.stargazers_count), 0);
  const externalCollaborationEvents = countExternalCollaboration(events, login);
  const activeMonths = activeMonthsLastYear(repos, events, now);

  const searchOk =
    raw.sources.find((source) => source.endpoint === 'GET /search/issues')?.ok ?? true;

  const complexity = scoreComplexity(
    {
      externalMergedPrs,
      externalPrsAvailable: searchOk,
      activeMonthsLastYear: activeMonths,
      languages,
      nonForkRepos: nonForks.length,
      maxStars,
      accountCreatedAt: viewer.created_at ?? null,
      externalCollaborationEvents,
    },
    now,
  );

  const techStack = [
    // HTML and CSS stay in the proficiency breakdown, where they are an honest
    // description of the repositories, but nobody states them as their stack.
    ...languages
      .filter(
        (language) =>
          language.share >= STACK_MIN_LANGUAGE_SHARE && isCoreLanguage(language.name),
      )
      .map((language) => language.name),
    ...frameworks.filter(qualifiesForStack).map((framework) => framework.name),
  ].slice(0, MAX_TECH_STACK);

  const analysis: ProfileAnalysis = {
    version: ANALYSIS_VERSION,
    generated_at: now.toISOString(),
    confidence: assessConfidence(
      nonForks.length,
      events.length,
      externalMergedPrs,
      repos.length,
      raw.sources,
    ),
    github: {
      login,
      account_created_at: viewer.created_at ?? null,
      public_repos: viewer.public_repos ?? repos.length,
      followers: viewer.followers ?? 0,
      non_fork_repos: nonForks.length,
      max_stars: maxStars,
      external_merged_prs: externalMergedPrs,
      active_months_last_year: activeMonths,
      events_analysed: events.length,
      events_window_days: EVENT_WINDOW_DAYS,
      external_collaboration_events: externalCollaborationEvents,
    },
    languages,
    frameworks,
    interests,
    complexity,
    sources: raw.sources,
  };

  return {
    analysis,
    techStack,
    languageProficiency: Object.fromEntries(
      languages.map((language) => [language.name, language.share]),
    ),
    complexityLevel: complexity.level,
    complexityScore: complexity.score,
  };
}

export async function analyzeProfile(
  token: string,
  now: Date = new Date(),
): Promise<ProfileDerivation> {
  return deriveProfile(await fetchRawProfile(token), now);
}
