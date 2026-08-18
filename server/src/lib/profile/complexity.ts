/**
 * Complexity level: a scored heuristic, not a vibe.
 *
 * Six components sum to 0-100 and band into public.complexity_level. Every
 * component records its own points and a plain-language note, because the
 * dashboard has to be able to answer "why did you call me intermediate?" with
 * the actual arithmetic. Users will ask, and "our algorithm decided" is not an
 * answer anyone accepts about themselves.
 *
 * Pure, like languages.ts — see the note there.
 */

import { isCoreLanguage } from './languages.js';
import type {
  ComplexityBreakdown,
  ComplexityComponent,
  ComplexityLevel,
  LanguageShare,
} from './types.js';

const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25;

/** Languages below this share are noise, not breadth. */
const BREADTH_MIN_SHARE = 0.03;

export interface ComplexityInput {
  /** Merged PRs into repositories the user does not own. */
  externalMergedPrs: number;
  /**
   * False when the search call failed. Without it a rate-limited request and a
   * developer who has genuinely never contributed score identically — a
   * 30-point swing, enough to move someone two bands — with nothing anywhere
   * to say which of the two happened.
   */
  externalPrsAvailable?: boolean;
  /** Distinct months with activity in the last 12. */
  activeMonthsLastYear: number;
  languages: readonly LanguageShare[];
  nonForkRepos: number;
  maxStars: number;
  accountCreatedAt: string | null;
  /** Reviews and issue comments on other people's repos, in the event window. */
  externalCollaborationEvents: number;
}

function band(value: number, bands: readonly (readonly [number, number])[]): number {
  let points = 0;

  for (const [threshold, awarded] of bands) {
    if (value >= threshold) {
      points = awarded;
    }
  }

  return points;
}

/** `plural(1, 'repository', 'repositories')` — the second form is required for
 * anything that does not simply take an `s`. */
function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

/**
 * External merged PRs — the heaviest component, at 30 of 100.
 *
 * It is the only signal that measures the target behaviour directly rather
 * than proxying for it: contributing to somebody else's open-source project is
 * the thing Contribly exists to help people do more of.
 */
function scoreExternalPrs(count: number, available: boolean): ComplexityComponent {
  // Unscoreable rather than zero. Zero points is the only honest number when
  // the evidence is missing — inventing a middling default would be worse —
  // but the note has to say so, or the dashboard shows a confident claim it
  // cannot support.
  if (!available) {
    return {
      points: 0,
      max: 30,
      note: 'GitHub’s search could not be reached, so contributions to other projects could not be counted',
    };
  }

  const points = band(count, [
    [1, 10],
    [3, 18],
    [10, 25],
    [30, 30],
  ]);

  return {
    points,
    max: 30,
    note:
      count === 0
        ? 'No merged pull requests into other people’s repositories yet'
        : `${plural(count, 'merged pull request')} into repositories you do not own`,
  };
}

/** Consistency beats a single heroic month, so this rewards spread. */
function scoreSustainedActivity(activeMonths: number): ComplexityComponent {
  const clamped = Math.min(12, Math.max(0, activeMonths));

  return {
    points: Math.min(20, Math.round(clamped * 1.67)),
    max: 20,
    note: `Active in ${plural(clamped, 'month')} of the last 12`,
  };
}

/**
 * Breadth counts languages someone actually works in. HTML and CSS are
 * excluded: every web repository is full of both, and letting them count would
 * hand three of the five breadth points to anyone who has ever shipped a page.
 */
function scoreBreadth(languages: readonly LanguageShare[]): ComplexityComponent {
  const count = languages.filter(
    (language) => language.share >= BREADTH_MIN_SHARE && isCoreLanguage(language.name),
  ).length;

  return {
    points: band(count, [
      [1, 3],
      [2, 7],
      [3, 11],
      [5, 15],
    ]),
    max: 15,
    note: `${plural(count, 'language')} used substantially`,
  };
}

/**
 * Owning projects other people use. Stars are log-scaled because the gap
 * between 10 and 100 stars says far more about a developer than the gap
 * between 5,000 and 50,000, which is mostly about topic and timing.
 */
function scoreOwnership(nonForkRepos: number, maxStars: number): ComplexityComponent {
  const starPoints = Math.min(14, Math.round(4 * Math.log10(1 + Math.max(0, maxStars))));
  const repoPoints = Math.min(6, Math.max(0, nonForkRepos));

  return {
    points: Math.min(20, starPoints + repoPoints),
    max: 20,
    note: `${plural(nonForkRepos, 'original repository', 'original repositories')}, best at ${plural(maxStars, 'star')}`,
  };
}

/**
 * Capped at ten points, and at five years, deliberately.
 *
 * A decade-old dormant account is not an expert. Letting account age carry real
 * weight would be the single most insulting failure mode this scorer has.
 */
function scoreMaturity(accountCreatedAt: string | null, now: Date): ComplexityComponent {
  const created = accountCreatedAt ? new Date(accountCreatedAt).getTime() : Number.NaN;

  if (!Number.isFinite(created)) {
    return { points: 0, max: 10, note: 'Account age unknown' };
  }

  const years = Math.max(0, (now.getTime() - created) / MS_PER_YEAR);

  return {
    points: Math.min(10, Math.floor(years * 2)),
    max: 10,
    note: `GitHub account is ${years.toFixed(1)} years old`,
  };
}

function scoreCollaboration(events: number): ComplexityComponent {
  return {
    points: band(events, [
      [1, 2],
      [5, 4],
      [15, 5],
    ]),
    max: 5,
    note: `${plural(events, 'review or comment', 'reviews or comments')} on other people’s repositories recently`,
  };
}

export function levelForScore(score: number): ComplexityLevel {
  if (score >= 75) return 'expert';
  if (score >= 50) return 'advanced';
  if (score >= 25) return 'intermediate';
  return 'beginner';
}

export function scoreComplexity(
  input: ComplexityInput,
  now: Date = new Date(),
): ComplexityBreakdown {
  const components: Record<string, ComplexityComponent> = {
    external_prs: scoreExternalPrs(
      input.externalMergedPrs,
      input.externalPrsAvailable ?? true,
    ),
    sustained_activity: scoreSustainedActivity(input.activeMonthsLastYear),
    language_breadth: scoreBreadth(input.languages),
    project_ownership: scoreOwnership(input.nonForkRepos, input.maxStars),
    account_maturity: scoreMaturity(input.accountCreatedAt, now),
    collaboration: scoreCollaboration(input.externalCollaborationEvents),
  };

  const score = Math.min(
    100,
    Object.values(components).reduce((sum, component) => sum + component.points, 0),
  );

  return { score, level: levelForScore(score), components };
}
