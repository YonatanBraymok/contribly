/**
 * Interests — what a developer is curious about, as distinct from what they
 * already ship.
 *
 * Sourced from starred and forked repositories, which is a want signal rather
 * than an ability one. Someone with forty Python repositories who stars nothing
 * but Rust is telling us where they would like to go, and steering them toward
 * more Python is the most obvious way for a recommendation engine to feel
 * useless.
 *
 * Pure, like languages.ts — see the note there.
 */

import type { GitHubRepo } from '../github/endpoints.js';
import type { InterestTopic } from './types.js';

const MAX_INTERESTS = 15;

/**
 * Topics that describe a repository's packaging rather than its subject.
 * They are among the most-used tags on GitHub and say nothing about interest.
 */
const STOPLIST = new Set([
  'awesome', 'awesome-list', 'list', 'lists', 'hacktoberfest', 'hacktoberfest2024',
  'open-source', 'opensource', 'oss', 'tutorial', 'tutorials', 'learning',
  'example', 'examples', 'demo', 'boilerplate', 'starter', 'template',
  'library', 'framework', 'sdk', 'api', 'cli', 'tool', 'tools', 'utility',
  'utilities', 'project', 'projects', 'code', 'development', 'programming',
  'software', 'app', 'application', 'free', 'resources', 'books', 'book',
  'interview', 'roadmap', 'cheatsheet', 'documentation', 'docs',
]);

export interface InterestInput {
  starredRepos: readonly GitHubRepo[];
  /** The user's forks — bookmarking by cloning. */
  forkedRepos: readonly GitHubRepo[];
}

function isUseful(topic: string): boolean {
  const normalised = topic.trim().toLowerCase();

  return (
    normalised.length > 1 &&
    normalised.length <= 30 &&
    !STOPLIST.has(normalised)
  );
}

/** Topics and primary languages from starred and forked repos, ranked. */
export function aggregateInterests({
  starredRepos,
  forkedRepos,
}: InterestInput): InterestTopic[] {
  const counts = new Map<string, number>();

  const add = (value: string | null | undefined, weight: number) => {
    if (!value || !isUseful(value)) {
      return;
    }

    const key = value.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + weight);
  };

  for (const repo of starredRepos) {
    for (const topic of repo.topics ?? []) {
      add(topic, 1);
    }
    // A starred repo's language is a weaker signal than its topics — people
    // star for what a project does far more often than for what it is written
    // in — so it counts, but for less.
    add(repo.language, 0.5);
  }

  // Forking takes more intent than starring: you fork to change something.
  for (const repo of forkedRepos) {
    for (const topic of repo.topics ?? []) {
      add(topic, 1.5);
    }
    add(repo.language, 0.75);
  }

  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count: Number(count.toFixed(2)) }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, MAX_INTERESTS);
}
