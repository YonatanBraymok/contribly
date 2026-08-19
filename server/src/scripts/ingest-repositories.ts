/**
 * Seeds public.repositories from GitHub search.
 *
 *   npm run ingest:repos --workspace=server
 *   npm run ingest:repos --workspace=server -- --limit 5        # quick check
 *   npm run ingest:repos --workspace=server -- --min-stars 200
 *
 * Needs GITHUB_TOKEN (a classic PAT with no scopes is enough — everything it
 * reads is public) plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, which it
 * picks up from server/.env like the API does.
 *
 * A full sweep is roughly 150 queries paced 2.2 seconds apart to stay inside
 * the search API's 30-per-minute limit, so expect about six minutes. Start with
 * `--limit 5` to confirm the credentials work before committing to that.
 */

import '../config/env.js';
import { ingestRepositories } from '../lib/ingest/repositories.js';
import { isSupabaseConfigured } from '../lib/supabase.js';

interface Flags {
  limit?: number;
  minStars?: number;
  perPage?: number;
  months?: number;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = Number(argv[i + 1]);

    if (!key?.startsWith('--')) {
      continue;
    }

    if (!Number.isFinite(value)) {
      throw new Error(`${key} needs a number`);
    }

    switch (key) {
      case '--limit':
        flags.limit = value;
        break;
      case '--min-stars':
        flags.minStars = value;
        break;
      case '--per-page':
        flags.perPage = value;
        break;
      case '--months':
        flags.months = value;
        break;
      default:
        throw new Error(`Unknown flag ${key}`);
    }

    i += 1;
  }

  return flags;
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      'GITHUB_TOKEN is not set. A classic PAT with no scopes is enough — the ' +
        'search API reads public data, and the token is only there for the rate limit.',
    );
  }

  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
        'in server/.env — ingestion writes through the service role.',
    );
  }

  const flags = parseFlags(process.argv.slice(2));
  const startedAt = Date.now();

  const summary = await ingestRepositories(token, {
    ...(flags.limit !== undefined ? { limit: flags.limit } : {}),
    ...(flags.minStars !== undefined ? { minStars: flags.minStars } : {}),
    ...(flags.perPage !== undefined ? { perPage: flags.perPage } : {}),
    ...(flags.months !== undefined ? { activeWithinMonths: flags.months } : {}),
    onProgress: (message) => console.log(message),
  });

  const seconds = Math.round((Date.now() - startedAt) / 1000);

  console.log(
    `\nDone in ${seconds}s\n` +
      `  queries      ${summary.queriesRun} ok, ${summary.queriesFailed} failed\n` +
      `  results      ${summary.reposSeen} hits\n` +
      `  skipped      ${summary.skippedUntaggable} with fewer than 2 recognisable technologies\n` +
      `  written      ${summary.reposWritten} unique repositories`,
  );

  if (summary.queriesFailed > 0) {
    console.warn(
      '\nSome queries failed. Re-running is safe — every row upserts on github_id.',
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
