/**
 * Language proficiency: which languages a developer actually works in, and in
 * what proportion.
 *
 * Pure — plain GitHub response objects in, plain data out, no Supabase and no
 * fetch. That is what lets server/scripts/analyze-fixture.ts tune the weights
 * below against saved responses in a second, with no network and no rate limit.
 */

import type { GitHubLanguages, GitHubRepo } from '../github/endpoints.js';
import { monthsSince } from './time.js';
import type { LanguageShare } from './types.js';

/**
 * Weight halves every twelve months since the last push.
 *
 * The single most consequential number in this file. Someone who wrote Java
 * until 2021 and TypeScript this month should read as a TypeScript developer,
 * and a linear recency weight is nowhere near aggressive enough to make that
 * happen — their Java repos are usually much larger.
 */
const RECENCY_HALF_LIFE_MONTHS = 12;

/** A fork may contain no work of the user's at all. */
const FORK_WEIGHT = 0.25;

/** Recent pushes are the strongest evidence that the code is really theirs. */
const EVENT_BONUS_PER_PUSH = 0.15;
const EVENT_BONUS_PUSH_CAP = 10;

const MIN_SHARE = 0.02;
const MAX_LANGUAGES = 10;

/**
 * Formats linguist counts but nobody works "in".
 *
 * A Dockerfile and a pom.xml are part of building software, not part of what
 * someone contributes. Left in, they crowd out real languages in a top-ten
 * list and inflate the breadth component of the complexity score, which is
 * supposed to measure range rather than repository furniture.
 */
const CONFIG_LANGUAGES = new Set([
  'Dockerfile', 'Makefile', 'CMake', 'XML', 'YAML', 'JSON', 'JSON5', 'TOML',
  'INI', 'Batchfile', 'EditorConfig', 'Gradle', 'Procfile', 'Nix', 'HCL',
  'Git Attributes', 'Git Config', 'Diff', 'Text',
]);

/**
 * Real languages that make a poor claim about a stack on their own.
 *
 * Kept in the proficiency breakdown, because a frontend developer's repos
 * genuinely are full of CSS and saying otherwise would misrepresent them.
 * Excluded from `tech_stack` and from the breadth score, because "I know HTML"
 * is not a statement anyone makes about themselves, and counting it as one of
 * five languages would flatter almost every web developer into `expert`.
 */
const SUPPORTING_LANGUAGES = new Set([
  'HTML', 'CSS', 'SCSS', 'Sass', 'Less', 'Stylus', 'Markdown', 'MDX',
]);

/** Whether a language should be stated as part of someone's stack. */
export function isCoreLanguage(name: string): boolean {
  return !SUPPORTING_LANGUAGES.has(name) && !CONFIG_LANGUAGES.has(name);
}

export interface RepoLanguageInput {
  repo: GitHubRepo;
  languages: GitHubLanguages;
  /** PushEvents seen against this repo in the events window. */
  pushEvents: number;
}

/**
 * Weighted, normalised share per language.
 *
 * ```
 * contribution(repo, lang) =
 *     sqrt(bytes)                        damp the one 400k-line monorepo
 *   * 0.5 ^ (months_since_push / 12)     recency
 *   * (fork ? 0.25 : 1)                  a fork may be nobody's work
 *   * (1 + 0.15 * min(pushes, 10))       recent commits prove real typing
 * ```
 *
 * `sqrt` rather than raw bytes because otherwise a single vendored dependency
 * or generated client swallows the entire distribution — one 2 MB Jupyter
 * notebook would outweigh three years of hand-written Go.
 *
 * Vendored and generated files are already stripped upstream: GitHub's
 * linguist excludes them from the languages endpoint, which handles the usual
 * `HTML`/`CSS` false positives before we ever see them.
 */
export function computeLanguageProficiency(
  inputs: readonly RepoLanguageInput[],
  now: Date = new Date(),
): LanguageShare[] {
  const weighted = new Map<string, number>();
  const totalBytes = new Map<string, number>();
  const repoCounts = new Map<string, number>();

  for (const { repo, languages, pushEvents } of inputs) {
    // An undated repo yields Infinity months, hence a weight of 0 — it
    // contributes nothing rather than contributing wrongly.
    const recency = Math.pow(0.5, monthsSince(repo.pushed_at, now) / RECENCY_HALF_LIFE_MONTHS);
    const forkFactor = repo.fork ? FORK_WEIGHT : 1;
    const eventFactor =
      1 + EVENT_BONUS_PER_PUSH * Math.min(pushEvents, EVENT_BONUS_PUSH_CAP);
    const repoWeight = recency * forkFactor * eventFactor;

    for (const [language, bytes] of Object.entries(languages)) {
      if (!Number.isFinite(bytes) || bytes <= 0 || CONFIG_LANGUAGES.has(language)) {
        continue;
      }

      weighted.set(language, (weighted.get(language) ?? 0) + Math.sqrt(bytes) * repoWeight);
      totalBytes.set(language, (totalBytes.get(language) ?? 0) + bytes);
      repoCounts.set(language, (repoCounts.get(language) ?? 0) + 1);
    }
  }

  const total = [...weighted.values()].reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return [];
  }

  const ranked = [...weighted.entries()]
    .map(([name, value]) => ({ name, weight: value, share: value / total }))
    .filter((entry) => entry.share >= MIN_SHARE)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_LANGUAGES);

  // Re-normalise over what survived. Shares that visibly fail to add up read as
  // a bug in a progress bar, and "share of the languages we kept" is the more
  // honest reading of the number anyway.
  const keptTotal = ranked.reduce((sum, entry) => sum + entry.weight, 0);

  return ranked.map((entry) => ({
    name: entry.name,
    share: Number((entry.weight / keptTotal).toFixed(4)),
    bytes: totalBytes.get(entry.name) ?? 0,
    repos: repoCounts.get(entry.name) ?? 0,
  }));
}
