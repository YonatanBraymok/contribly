/**
 * A very small GitHub REST client.
 *
 * Scope on purpose: the profile analysis makes six kinds of call, all of them
 * reads of public data. Octokit would bring a plugin system, a throttling
 * strategy and a GraphQL client to do that, so this stays hand-rolled until
 * something actually needs the rest of it.
 *
 * The token exists for the rate limit, not for access. Every endpoint in
 * endpoints.ts is readable anonymously; authenticating lifts 60 requests/hour
 * (shared per IP, which in a container means shared across all users) to 5,000
 * per user. Nothing here reaches anything `read:user` does not already allow.
 */

const API_BASE = 'https://api.github.com';

/** GitHub pins breaking changes to a date; unset, you get whatever is current. */
const API_VERSION = '2022-11-28';

/** GitHub rejects requests without one, and asks that it identify the app. */
const USER_AGENT = 'contribly-profile-sync';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * How long we are willing to sit out a secondary rate limit. GitHub's
 * `retry-after` is usually a few seconds; anything longer means the sync should
 * fail and be retried later rather than hold a socket open.
 */
const MAX_RETRY_AFTER_SECONDS = 30;

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }

  /** The token is dead or was revoked — no retry will fix it. */
  get isAuthFailure(): boolean {
    return this.status === 401;
  }

  /** Deleted account, renamed user, or a repo that went private mid-sync. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export class GitHubRateLimitError extends GitHubError {
  constructor(
    path: string,
    readonly resetAt: Date | null,
  ) {
    super(429, 'GitHub rate limit exhausted', path);
    this.name = 'GitHubRateLimitError';
  }
}

type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  searchParams?: Record<string, QueryValue>;
}

function buildUrl(path: string, searchParams?: Record<string, QueryValue>): string {
  const url = new URL(path, API_BASE);

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GitHubClient {
  constructor(private readonly token: string) {}

  /**
   * One request, with a single retry when GitHub asks us to back off.
   *
   * The retry is deliberately not a loop. A secondary rate limit that survives
   * one `retry-after` means we are being told to slow down more than a sync can
   * usefully wait for, and failing lets the 6-hour throttle try again later.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = buildUrl(path, options.searchParams);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': API_VERSION,
          'User-Agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      // 403 and 429 both carry rate-limit meanings. `x-ratelimit-remaining: 0`
      // is the primary limit, which resets on the hour — far too long to wait,
      // so it is terminal. Anything else with a retry-after is a secondary
      // limit, and those clear in seconds.
      if (response.status === 403 || response.status === 429) {
        const remaining = response.headers.get('x-ratelimit-remaining');

        if (remaining === '0') {
          const reset = Number(response.headers.get('x-ratelimit-reset'));
          throw new GitHubRateLimitError(
            path,
            Number.isFinite(reset) ? new Date(reset * 1000) : null,
          );
        }

        const retryAfter = Number(response.headers.get('retry-after'));
        const canRetry =
          attempt === 0 &&
          Number.isFinite(retryAfter) &&
          retryAfter > 0 &&
          retryAfter <= MAX_RETRY_AFTER_SECONDS;

        if (canRetry) {
          await sleep(retryAfter * 1000);
          continue;
        }
      }

      throw new GitHubError(
        response.status,
        `GitHub responded ${response.status} ${response.statusText}`,
        path,
      );
    }

    // Unreachable: the loop either returns, continues once, or throws.
    throw new GitHubError(500, 'GitHub request retry exhausted', path);
  }

  /**
   * Walks up to `pages` pages, stopping early on a short page.
   *
   * Bounded rather than exhaustive by design. A user with 800 repositories
   * tells us nothing in pages 3-8 that pages 1-2 did not, and the analysis
   * already sorts by most recently pushed, so the interesting rows come first.
   */
  async paginate<T>(
    path: string,
    { pages, perPage = 100, searchParams }: { pages: number; perPage?: number; searchParams?: Record<string, QueryValue> },
  ): Promise<T[]> {
    const collected: T[] = [];

    for (let page = 1; page <= pages; page += 1) {
      const batch = await this.request<T[]>(path, {
        searchParams: { ...searchParams, per_page: perPage, page },
      });

      if (!Array.isArray(batch)) {
        break;
      }

      collected.push(...batch);

      if (batch.length < perPage) {
        break;
      }
    }

    return collected;
  }
}

/**
 * Runs `fn` over `items` with a fixed number in flight.
 *
 * GitHub asks for no more than 100 concurrent requests and starts issuing
 * secondary rate limits well before that when the calls come in a burst. Five
 * keeps a 30-repo language sweep comfortably inside the limits while still
 * finishing in about a second.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;

      const item = items[index];
      if (item === undefined) {
        continue;
      }

      results[index] = await fn(item, index);
    }
  });

  await Promise.all(workers);

  return results;
}
