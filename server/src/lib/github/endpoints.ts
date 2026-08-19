/**
 * The six calls the profile analysis makes, and the slices of GitHub's
 * responses it actually reads.
 *
 * The types are deliberately partial. GitHub returns 60-odd fields per
 * repository; declaring the eight we use documents the dependency and means a
 * field we never touch changing shape upstream cannot break a build.
 */

import { GitHubClient } from './client.js';

/** How far back the public events feed reaches, whichever limit bites first. */
export const EVENT_WINDOW_DAYS = 90;
const EVENT_PAGES = 3;
const REPO_PAGES = 2;
const STARRED_PAGES = 2;

export interface GitHubUser {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  blog: string | null;
  public_repos: number;
  followers: number;
  created_at: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string } | null;
  description: string | null;
  fork: boolean;
  archived: boolean;
  language: string | null;
  topics: string[] | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string | null;
  created_at: string | null;
  html_url: string;
  homepage: string | null;
  license: { spdx_id: string | null; key: string | null } | null;
}

/** Byte counts keyed by language, straight from linguist. */
export type GitHubLanguages = Record<string, number>;

export interface GitHubEvent {
  id: string;
  type: string | null;
  created_at: string | null;
  repo: { id: number; name: string } | null;
  payload?: {
    action?: string;
    commits?: unknown[];
    pull_request?: { merged?: boolean };
  };
}

/** Only `total_count` is read; per_page=1 keeps the payload to one item. */
interface SearchCount {
  total_count: number;
}

export interface RepoSearchResult {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubRepo[];
}

export async function fetchViewer(client: GitHubClient): Promise<GitHubUser> {
  return client.request<GitHubUser>('/user');
}

/**
 * Any user's public profile.
 *
 * The sync always analyses the token's owner, so this exists for the fixture
 * script: tuning the heuristics needs a heavy contributor, an ordinary working
 * developer and a near-empty account, and only one of those is ever going to be
 * the person holding the token.
 */
export async function fetchUser(
  client: GitHubClient,
  login: string,
): Promise<GitHubUser> {
  return client.request<GitHubUser>(`/users/${encodeURIComponent(login)}`);
}

/**
 * The user's own public repositories, most recently pushed first.
 *
 * `/users/{login}/repos` rather than `/user/repos`: the public-user endpoint
 * needs no scope at all, so this call cannot start failing if the granted
 * scopes are ever narrowed. It returns exactly what we are permitted to
 * analyse anyway, and the sort order means the two pages we take are the two
 * that matter.
 */
export async function fetchRepos(
  client: GitHubClient,
  login: string,
): Promise<GitHubRepo[]> {
  return client.paginate<GitHubRepo>(`/users/${encodeURIComponent(login)}/repos`, {
    pages: REPO_PAGES,
    searchParams: { type: 'owner', sort: 'pushed', direction: 'desc' },
  });
}

/** Byte counts per language for one repository. One call per repo, so batched. */
export async function fetchRepoLanguages(
  client: GitHubClient,
  fullName: string,
): Promise<GitHubLanguages> {
  return client.request<GitHubLanguages>(`/repos/${fullName}/languages`);
}

/**
 * Public activity — roughly the last 90 days, capped at 300 events.
 *
 * The most valuable part is the events on repositories the user does not own:
 * that is contribution to somebody else's project, which is the behaviour
 * Contribly exists to encourage.
 */
export async function fetchPublicEvents(
  client: GitHubClient,
  login: string,
): Promise<GitHubEvent[]> {
  return client.paginate<GitHubEvent>(
    `/users/${encodeURIComponent(login)}/events/public`,
    { pages: EVENT_PAGES },
  );
}

/**
 * Starred repositories — an interest signal rather than an ability one.
 *
 * Someone with forty Python repositories who stars nothing but Rust is telling
 * us where they want to go, and that is precisely what a recommendation engine
 * should act on.
 */
export async function fetchStarred(
  client: GitHubClient,
  login: string,
): Promise<GitHubRepo[]> {
  return client.paginate<GitHubRepo>(`/users/${encodeURIComponent(login)}/starred`, {
    pages: STARRED_PAGES,
  });
}

/**
 * Merged pull requests into repositories the user does not own.
 *
 * The single most valuable number in the whole analysis: it is the only direct
 * evidence that someone has actually contributed to open source, which is the
 * exact behaviour being matched for. Everything else derived here is a proxy
 * for it. `-user:{login}` is what excludes their own projects.
 *
 * The search API has its own, much tighter limit (30 requests/minute), so this
 * is one call with per_page=1 — only `total_count` is wanted.
 */
export async function countExternalMergedPrs(
  client: GitHubClient,
  login: string,
): Promise<number> {
  const result = await client.request<SearchCount>('/search/issues', {
    searchParams: {
      q: `author:${login} type:pr is:merged -user:${login}`,
      per_page: 1,
      // Required since GitHub's 2025 issue-search change; without it the
      // qualifier syntax above is interpreted as free text.
      advanced_search: 'true',
    },
  });

  return result.total_count ?? 0;
}

/**
 * Repository search, used by the corpus ingestion job.
 *
 * The search API has its own limit — 30 requests per minute rather than the
 * 5,000 per hour the rest of these share — so the caller is responsible for
 * pacing. See server/src/lib/ingest/repositories.ts.
 */
export async function searchRepositories(
  client: GitHubClient,
  query: string,
  perPage = 30,
): Promise<RepoSearchResult> {
  return client.request<RepoSearchResult>('/search/repositories', {
    searchParams: { q: query, sort: 'stars', order: 'desc', per_page: perPage },
  });
}
