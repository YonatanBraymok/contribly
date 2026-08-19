/**
 * Corpus ingestion — filling public.repositories with somewhere to send people.
 *
 * The matching in 20260818000100_recommendations.sql is a set intersection
 * between a developer's `tech_stack` and a repository's `tech_tags`. Both sides
 * have to speak one vocabulary for that to return anything at all, so every
 * repository ingested here has its topics run through the *same*
 * profile/taxonomy.ts the analysis uses, and the search queries are generated
 * from that table too. A repository we cannot name in those terms is one we
 * could never recommend, so there is no point ingesting it.
 *
 * Run from src/scripts/ingest-repositories.ts, by hand. This is a seed job, not
 * a service: it exists to be run occasionally and re-run when the corpus goes
 * stale, and scheduling it is a later problem.
 */

import { GitHubClient } from '../github/client.js';
import { searchRepositories, type GitHubRepo } from '../github/endpoints.js';
import { matchTopic } from '../profile/taxonomy.js';
import { frameworkTopics } from '../profile/taxonomy.js';
import { getSupabase } from '../supabase.js';

/**
 * The search API allows 30 requests per minute — two orders of magnitude
 * tighter than everything else, and it counts rejected requests too. 2.2
 * seconds apart is roughly 27/minute, which leaves headroom without making a
 * full sweep take all afternoon.
 */
const SEARCH_INTERVAL_MS = 2200;

/** Rows per upsert. Large enough to be few round trips, small enough to retry. */
const UPSERT_BATCH = 200;

/**
 * Languages worth a sweep of their own.
 *
 * Topic searches find projects that tagged themselves; plenty of excellent
 * repositories never did. Searching by language catches those, and it is the
 * only way a language ends up in the corpus attached to projects that are not
 * about a framework.
 */
const LANGUAGES = [
  'TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'C#', 'C++', 'C',
  'Ruby', 'PHP', 'Swift', 'Kotlin', 'Elixir', 'Scala', 'Dart', 'Lua', 'Shell',
];

export interface IngestOptions {
  /** Ignore repositories below this many stars. */
  minStars?: number;
  /** Only consider repositories pushed within this many months. */
  activeWithinMonths?: number;
  /** Results per search query. GitHub caps this at 100. */
  perPage?: number;
  /** Run only the first N queries — for a quick check rather than a full sweep. */
  limit?: number;
  onProgress?: (message: string) => void;
}

export interface IngestSummary {
  queriesRun: number;
  queriesFailed: number;
  reposSeen: number;
  reposWritten: number;
  skippedUntaggable: number;
}

interface SearchSpec {
  label: string;
  query: string;
}

function isoMonthsAgo(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);

  return date.toISOString().slice(0, 10);
}

/**
 * The searches to run.
 *
 * Every query carries `good-first-issues:>0`. That is a product decision as
 * much as a filter: Contribly exists to get people contributing, and a
 * repository with no marked way in is a worse recommendation than a less
 * popular one that has them. It also means `has_good_first_issues` is known
 * rather than guessed. Widening the corpus later is a matter of dropping that
 * qualifier from a second pass.
 */
export function buildSearchSpecs({
  minStars = 50,
  activeWithinMonths = 6,
}: IngestOptions = {}): SearchSpec[] {
  const shared = `stars:>${minStars} pushed:>${isoMonthsAgo(activeWithinMonths)} archived:false is:public good-first-issues:>0`;

  return [
    ...frameworkTopics().map(({ canonical, topic }) => ({
      label: `topic:${canonical}`,
      query: `topic:${topic} ${shared}`,
    })),
    ...LANGUAGES.map((language) => ({
      label: `language:${language}`,
      // Quoted because of C# and C++ — unquoted, the qualifier does not parse.
      query: `language:"${language}" ${shared}`,
    })),
  ];
}

/**
 * Canonical technology names for a repository.
 *
 * The primary language goes in as-is (linguist's spelling is already the one
 * the profile analysis produces), and topics go through the taxonomy. Topics it
 * does not recognise are dropped rather than stored: a tag no profile can ever
 * contain cannot contribute to an overlap, and keeping it would only dilute the
 * count that ordering depends on.
 */
export function techTagsFor(repo: GitHubRepo): string[] {
  const tags = new Set<string>();

  if (repo.language) {
    tags.add(repo.language);
  }

  for (const topic of repo.topics ?? []) {
    const canonical = matchTopic(topic);

    if (canonical) {
      tags.add(canonical);
    }
  }

  return [...tags];
}

/**
 * A crude proxy for how much a contribution here will cost you.
 *
 * Not issue difficulty — we have not read the issues. It stands in for project
 * weight: how much context, process and review a change has to pass through,
 * which tracks popularity closely enough to be useful and is honest about being
 * a proxy. A 300-star tool takes a patch; a 200,000-star framework takes a
 * proposal, a discussion, and three reviewers.
 */
export function difficultyFor(stars: number): 'beginner' | 'intermediate' | 'advanced' {
  if (stars < 2_000) return 'beginner';
  if (stars < 25_000) return 'intermediate';

  return 'advanced';
}

function toRow(repo: GitHubRepo, techTags: string[]) {
  return {
    github_id: repo.id,
    full_name: repo.full_name,
    owner: repo.owner?.login ?? repo.full_name.split('/')[0] ?? '',
    name: repo.name,
    description: repo.description,
    html_url: repo.html_url,
    homepage: repo.homepage || null,
    primary_language: repo.language,
    topics: repo.topics ?? [],
    tech_tags: techTags,
    license: repo.license?.spdx_id ?? repo.license?.key ?? null,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    open_issues_count: repo.open_issues_count ?? 0,
    contribution_difficulty: difficultyFor(repo.stargazers_count),
    // Known rather than inferred: every search query required it.
    has_good_first_issues: true,
    archived: repo.archived,
    last_commit_at: repo.pushed_at,
    indexed_at: new Date().toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sweeps GitHub search and writes the results to public.repositories.
 *
 * Deduplicated across the whole run before anything is written, because the
 * same repository legitimately answers a dozen queries — React shows up under
 * `topic:react`, `topic:nextjs` and `language:JavaScript` — and upserting it
 * thirteen times would spend most of the run rewriting rows.
 */
export async function ingestRepositories(
  token: string,
  options: IngestOptions = {},
): Promise<IngestSummary> {
  const { perPage = 50, limit, onProgress = () => {} } = options;

  const specs = buildSearchSpecs(options).slice(0, limit ?? Number.POSITIVE_INFINITY);
  const collected = new Map<number, ReturnType<typeof toRow>>();

  const client = new GitHubClient(token);
  const summary: IngestSummary = {
    queriesRun: 0,
    queriesFailed: 0,
    reposSeen: 0,
    reposWritten: 0,
    skippedUntaggable: 0,
  };

  for (const [index, spec] of specs.entries()) {
    // Ahead of the request rather than after it, so a failure does not let the
    // next query through early and trip the limit we are pacing to avoid.
    if (index > 0) {
      await sleep(SEARCH_INTERVAL_MS);
    }

    try {
      const result = await searchRepositories(client, spec.query, perPage);
      summary.queriesRun += 1;
      summary.reposSeen += result.items.length;

      for (const repo of result.items) {
        // A fork is a copy of somebody else's project; contributions belong
        // upstream, so recommending the fork sends people to the wrong door.
        if (repo.fork || repo.archived) {
          continue;
        }

        const techTags = techTagsFor(repo);

        // Fewer than two tags can never satisfy a two-tech match, so this row
        // could only ever take up space.
        if (techTags.length < 2) {
          summary.skippedUntaggable += 1;
          continue;
        }

        collected.set(repo.id, toRow(repo, techTags));
      }

      onProgress(
        `[${index + 1}/${specs.length}] ${spec.label} — ${result.items.length} hits, ${collected.size} unique so far`,
      );
    } catch (error) {
      summary.queriesFailed += 1;
      onProgress(
        `[${index + 1}/${specs.length}] ${spec.label} — FAILED: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const rows = [...collected.values()];

  for (let start = 0; start < rows.length; start += UPSERT_BATCH) {
    const batch = rows.slice(start, start + UPSERT_BATCH);

    const { error } = await getSupabase()
      .from('repositories')
      .upsert(batch, { onConflict: 'github_id' });

    if (error) {
      throw new Error(`Upsert failed at row ${start}: ${error.message}`);
    }

    summary.reposWritten += batch.length;
    onProgress(`wrote ${summary.reposWritten}/${rows.length}`);
  }

  return summary;
}
