/**
 * Tuning harness for the profile heuristics.
 *
 *   npm run fixture:capture --workspace=server -- <github-login>
 *   npm run fixture:analyze --workspace=server -- <login-or-path>
 *
 * `capture` saves the six API responses for an account to
 * server/fixtures/<login>.json. `analyze` replays one through the same
 * `deriveProfile` the server calls and prints what came out.
 *
 * The point is iteration speed. Every weight in languages.ts and complexity.ts
 * is a guess until it is checked against real accounts, and checking them
 * against the live API would be slow, rate-limited, and different every run.
 * Replaying a capture is instant and reproducible — the analysis is pinned to
 * `captured_at`, so a fixture taken today still scores the same next year.
 *
 * Three captures are worth keeping: a heavy open-source contributor, a working
 * developer with few external PRs, and a near-empty account. The last is the
 * cold-start path, which is the easiest to get wrong and the hardest to notice.
 *
 * Needs a token in GITHUB_TOKEN for `capture` only. A classic PAT with no
 * scopes ticked is enough — every endpoint reads public data, and the token is
 * only there for the rate limit.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveProfile,
  fetchRawProfile,
  type RawProfileData,
} from '../lib/profile/analyze.js';

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

function fixturePath(target: string): string {
  return target.endsWith('.json') ? resolve(target) : resolve(FIXTURE_DIR, `${target}.json`);
}

function count(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function bar(share: number, width = 24): string {
  const filled = Math.round(share * width);

  return '█'.repeat(filled).padEnd(width, '·');
}

async function capture(login: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      'GITHUB_TOKEN is not set. A classic PAT with no scopes is enough — every ' +
        'endpoint reads public data and the token is only there for the rate limit.',
    );
  }

  console.log(`Capturing ${login}…`);
  const raw = await fetchRawProfile(token, { login });

  await mkdir(FIXTURE_DIR, { recursive: true });
  const path = fixturePath(login);
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`);

  console.log(
    `Wrote ${path}\n` +
      `  ${raw.repos.length} repos, ${raw.repoLanguages.length} language reads, ` +
      `${raw.events.length} events, ${raw.starred.length} starred, ` +
      `${raw.externalMergedPrs} external merged PRs`,
  );

  for (const source of raw.sources.filter((entry) => !entry.ok)) {
    console.warn(`  ! ${source.endpoint} — ${source.error}`);
  }
}

async function analyze(target: string): Promise<void> {
  const path = fixturePath(target);
  const raw = JSON.parse(await readFile(path, 'utf8')) as RawProfileData;

  // Pinned to the capture, not to today, so the output is reproducible.
  const result = deriveProfile(raw, new Date(raw.captured_at));
  const { analysis } = result;

  console.log(`\n${analysis.github.login} — ${path}`);
  console.log(`captured ${raw.captured_at}  ·  confidence ${analysis.confidence}\n`);

  console.log('Languages');
  if (analysis.languages.length === 0) {
    console.log('  (none detected)');
  }
  for (const language of analysis.languages) {
    const percent = `${(language.share * 100).toFixed(1)}%`.padStart(6);
    console.log(
      `  ${language.name.padEnd(20)} ${bar(language.share)} ${percent}  ` +
        `${count(language.repos, 'repo')}, ${(language.bytes / 1024).toFixed(0)} KB`,
    );
  }

  console.log('\nFrameworks');
  if (analysis.frameworks.length === 0) {
    console.log('  (none detected)');
  }
  for (const framework of analysis.frameworks.slice(0, 20)) {
    const inStack = result.techStack.includes(framework.name) ? '✓' : ' ';
    console.log(
      `  ${inStack} ${framework.name.padEnd(20)} ${count(framework.mentions, 'mention')} ` +
        `(${framework.sources.join(', ')})`,
    );
  }

  console.log(`\nComplexity — ${analysis.complexity.score}/100 → ${analysis.complexity.level}`);
  for (const [name, component] of Object.entries(analysis.complexity.components)) {
    console.log(
      `  ${name.padEnd(20)} ${String(component.points).padStart(2)}/${String(component.max).padEnd(3)} ${component.note}`,
    );
  }

  console.log(`\nInterests\n  ${analysis.interests.map((i) => i.topic).join(', ') || '(none)'}`);
  console.log(`\nResulting tech_stack\n  ${result.techStack.join(', ') || '(empty)'}`);

  const failed = analysis.sources.filter((source) => !source.ok);
  if (failed.length > 0) {
    console.log('\nDegraded sources');
    for (const source of failed) {
      console.log(`  ! ${source.endpoint} — ${source.error}`);
    }
  }
  console.log();
}

async function main(): Promise<void> {
  const [command, target] = process.argv.slice(2);

  if (!command || !target || (command !== 'capture' && command !== 'analyze')) {
    console.error(
      'Usage:\n' +
        '  npm run fixture:capture --workspace=server -- <github-login>\n' +
        '  npm run fixture:analyze --workspace=server -- <login-or-path>',
    );
    process.exitCode = 1;
    return;
  }

  await (command === 'capture' ? capture(target) : analyze(target));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
