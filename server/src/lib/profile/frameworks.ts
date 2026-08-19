/**
 * Framework and tooling detection.
 *
 * taxonomy.ts owns the vocabulary; this module owns the evidence rules. Kept
 * apart so the AI phase can replace the vocabulary without touching the "how
 * many independent mentions does it take to believe this" logic, which is the
 * part that stops the detected stack from embarrassing itself.
 *
 * Pure, like languages.ts — see the note there.
 */

import type { GitHubRepo } from '../github/endpoints.js';
import { matchText, matchTopic } from './taxonomy.js';
import { monthsSince } from './time.js';
import type { FrameworkHit, FrameworkSource } from './types.js';

/** Two independent pieces of evidence before a framework is claimed. */
const MIN_MENTIONS_FOR_STACK = 2;

/**
 * How stale a repository may be and still speak for a developer's current
 * stack.
 *
 * Three years is generous, and the point is the far side of it: someone who
 * shipped a Spring service in 2021 and has written nothing but Go since should
 * not be introduced as a Spring developer, however honestly that repository
 * was tagged at the time.
 */
const EVIDENCE_MAX_AGE_MONTHS = 36;

export interface FrameworkInput {
  ownRepos: readonly GitHubRepo[];
  starredRepos: readonly GitHubRepo[];
}

interface Evidence {
  mentions: Set<string>;
  sources: Set<FrameworkSource>;
}

function record(
  evidence: Map<string, Evidence>,
  name: string,
  source: FrameworkSource,
  key: string,
): void {
  const entry = evidence.get(name) ?? { mentions: new Set(), sources: new Set() };

  // Keyed by repo *and* source, so one repository that both tags `react` and
  // says "React" in its description counts twice — those are genuinely two
  // signals — while re-reading the same repo never inflates anything.
  entry.mentions.add(`${source}:${key}`);
  entry.sources.add(source);
  evidence.set(name, entry);
}

/**
 * Every framework spotted, with its evidence.
 *
 * Three tiers of source, and which tier a repository lands in is most of what
 * keeps this honest:
 *
 * - A repository the user wrote and touched recently speaks for their stack,
 *   through both its topics and its description.
 * - A **fork** does not. Its topics and description were written by whoever
 *   built the original, so a forked PyTorch harness says the user was curious,
 *   not that they train models. Forks are demoted to the same tier as stars.
 * - A **starred** repository contributes topics only. Its description
 *   describes *that project*, not the user, so mining it would conclude
 *   someone knows Kubernetes because they bookmarked a tutorial about it.
 */
export function detectFrameworks(
  { ownRepos, starredRepos }: FrameworkInput,
  now: Date = new Date(),
): FrameworkHit[] {
  const evidence = new Map<string, Evidence>();

  for (const repo of ownRepos) {
    // Forks are somebody else's description of somebody else's project.
    const tier: FrameworkSource = repo.fork ? 'starred' : 'topic';

    if (monthsSince(repo.pushed_at, now) > EVIDENCE_MAX_AGE_MONTHS) {
      continue;
    }

    for (const topic of repo.topics ?? []) {
      const name = matchTopic(topic);
      if (name) {
        record(evidence, name, tier, repo.full_name);
      }
    }

    // Only for repositories the user actually wrote.
    if (!repo.fork) {
      for (const name of matchText(repo.description)) {
        record(evidence, name, 'description', repo.full_name);
      }
    }
  }

  for (const repo of starredRepos) {
    for (const topic of repo.topics ?? []) {
      const name = matchTopic(topic);
      if (name) {
        record(evidence, name, 'starred', repo.full_name);
      }
    }
  }

  return [...evidence.entries()]
    .map(([name, entry]) => ({
      name,
      mentions: entry.mentions.size,
      sources: [...entry.sources],
    }))
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
}

/**
 * Whether a hit is strong enough to state as fact in the user's stack.
 *
 * Requires evidence from a repository they own — stars alone are aspiration,
 * and belong in interests rather than in a claim about what they can do.
 */
export function qualifiesForStack(hit: FrameworkHit): boolean {
  const hasOwnedEvidence =
    hit.sources.includes('topic') || hit.sources.includes('description');

  return hasOwnedEvidence && hit.mentions >= MIN_MENTIONS_FOR_STACK;
}
