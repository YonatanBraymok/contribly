# Contribly

AI-powered recommendations for your next open-source contribution.

Contribly analyzes a developer's GitHub profile — tech stack, commit history,
complexity level — alongside their explicitly stated learning goals, then uses
semantic search over a curated vector index to surface the repositories and
issues worth their next weekend.

## Stack

| Layer          | Choice                                                |
| -------------- | ----------------------------------------------------- |
| Frontend       | Next.js 16 (App Router), React 19, Tailwind CSS 4      |
| Backend        | Node.js + Express 5, TypeScript (ESM)                  |
| Database       | Supabase / PostgreSQL 17 with `pgvector`               |
| Infrastructure | Docker Compose                                         |

## Layout

```
contribly/
├── client/                 Next.js app
│   ├── src/app/            App Router routes
│   ├── src/app/onboarding/ First-run questionnaire
│   ├── src/components/     Shared UI
│   ├── src/lib/api.ts      Typed API client
│   └── Dockerfile          deps → dev → build → production
├── server/                 Express API
│   ├── src/app.ts          App factory (middleware + route mounting)
│   ├── src/index.ts        Entrypoint, graceful shutdown
│   ├── src/config/env.ts   Zod-validated environment
│   ├── src/routes/         Route modules
│   ├── src/middleware/     Error handling
│   ├── src/lib/supabase.ts Service-role Supabase client
│   ├── src/lib/github/     Minimal GitHub REST client
│   ├── src/lib/profile/    Profile analysis — see below
│   ├── src/lib/ingest/     Corpus ingestion from GitHub search
│   ├── src/scripts/        Fixture harness for tuning the heuristics
│   └── Dockerfile          deps → dev → build → production
├── supabase/
│   ├── migrations/         Schema, applied in filename order
│   └── local/              Local-only bootstrap (not run on hosted Supabase)
└── docker-compose.yml      db + server + client
```

npm workspaces tie `client` and `server` together, so a single `npm install` at
the root covers both.

## Getting started

```bash
cp .env.example .env
npm install
npm run docker:up          # db + API + client, with hot reload
```

| Service  | URL                     |
| -------- | ----------------------- |
| Client   | http://localhost:3000   |
| API      | http://localhost:4000   |
| Postgres | `localhost:54322`       |

If a port is already taken, set `WEB_PORT`, `API_PORT`, or `POSTGRES_PORT` in
`.env`.

### Without Docker

```bash
npm install
cp server/.env.example server/.env
cp client/.env.example client/.env.local
npm run dev                # runs both workspaces concurrently
```

## Database

Migrations live in `supabase/migrations/` and are plain, Supabase-native SQL.

- **Locally**, the `db` container runs `supabase/local/00-bootstrap.sh` on the
  first boot of an empty volume. It creates a minimal `auth` schema stand-in
  (hosted Supabase provides one; plain Postgres does not), then applies every
  migration in filename order. Re-run from scratch with `npm run docker:reset`.
- **Against a hosted project**, apply them with the Supabase CLI
  (`supabase db push`) or the SQL editor. Nothing in `supabase/local/` is ever
  applied there.

### Schema

| Table                | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `users`              | Profile: detected stack, complexity level, stated preferences, the `analysis` blob behind them, and the `profile_embedding` that will become the match query |
| `github_credentials` | The user's GitHub access token. Service-role only — RLS on, no policies |
| `repositories` | Curated corpus. `tech_tags` holds canonical technology names — the column v1 matching runs on — alongside an `embedding` for later |
| `issues`       | Individual contribution opportunities, embedded separately so a "good first issue" can surface on its own merits |

Both corpus tables carry a `vector(1536)` column indexed with HNSW over cosine
distance. Two RPCs wrap the search:

```sql
select * from match_repositories(query_embedding, match_threshold, match_count, filter_languages);
select * from match_issues(query_embedding, match_threshold, match_count, only_good_first_issue);
```

Call them from the API via `supabase.rpc('match_repositories', { ... })`.

> The `1536` dimension matches OpenAI `text-embedding-3-small`. Changing embedding
> models means changing both the column type and `EMBEDDING_DIMENSIONS`.

Row Level Security is on for all tables: profiles are readable and writable only
by their owner, the repository and issue corpus is public read-only, and
`github_credentials` is reachable by the service role alone — writes go through
the service role.

> RLS is only half of it. Postgres checks `GRANT`s **before** it evaluates a
> policy, so a table with policies but no grant is simply unreachable —
> PostgREST answers `42501 permission denied` and the policies never run. Some
> Supabase projects hand out those grants automatically via `ALTER DEFAULT
> PRIVILEGES` and some do not, so every grant is stated explicitly in
> `20260808000100_grants.sql`. Adding a table means adding its grants there.

## Authentication

Sign-in is **GitHub OAuth only** — there is no password path anywhere in the
codebase. Supabase Auth is the identity provider, so a session is a Supabase
JWT and `public.users.id` mirrors `auth.users.id`, which is what lets the RLS
policies compare against `auth.uid()` without a join.

### Setup

1. **Register a GitHub OAuth app** — GitHub → Settings → Developer settings →
   OAuth Apps → New. Set the *Authorization callback URL* to Supabase, not to
   Contribly:

   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

2. **Enable the provider** — Supabase dashboard → Authentication → Sign In /
   Providers → GitHub. Paste the client ID and secret. In the same screen,
   **turn Email off**, so GitHub is genuinely the only way in.

3. **Set the redirect allow-list** — Authentication → URL Configuration → add
   `http://localhost:3000/**` for local development, plus your deployed origin.

4. **Fill in the environment** — `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the client, `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` for the API.

> The `db` container is plain Postgres with an `auth` schema stand-in — there
> is no GoTrue in it, so OAuth cannot run against it. Point local development
> at a hosted Supabase project for auth; the container remains useful for
> schema work.

### The flow

```
/login                    "Continue with GitHub" (Server Action)
  -> github.com/login/oauth/authorize        consent screen
  -> <project>.supabase.co/auth/v1/callback  Supabase exchanges with GitHub
  -> /login/callback?code=...                exchangeCodeForSession sets cookies
       -> POST /api/v1/auth/session          profile sync + token capture
  -> /dashboard
```

`src/proxy.ts` guards every route. `/` and `/login` are public; everything else
redirects to `/login?next=<path>` without a session. It is named `proxy.ts`
because Next.js 16 deprecated the `middleware.ts` convention and renamed it.

### The GitHub token

Supabase returns GitHub's access token as `provider_token` **only** on the
response to the initial code exchange — it is not kept in the session and is
never refreshed. `/login/callback` forwards it to the API, which stores it in
`github_credentials` so the profile-sync worker can call GitHub as the user at
5,000 requests/hour rather than the anonymous 60.

That table has RLS enabled and **no policies**, which under Postgres denies
every row to `anon` and `authenticated`; only the service role reaches it. The
token is stored as-is — moving it to Supabase Vault is worth doing before this
holds real users.

Requested scopes are `read:user` and `user:email`, declared in
`client/src/lib/supabase/config.ts`. Neither grants repository write access or
reaches private repositories.

## Profile analysis

At first sign-in Contribly reads a developer's public GitHub activity and turns
it into something matchable: a detected stack, a language distribution, a
contribution level, and a set of interests. The user then confirms and extends
it through a four-step questionnaire.

**v1 is entirely deterministic.** Every number comes from arithmetic over
GitHub's REST responses plus a curated keyword table. That is not a placeholder
to apologise for — it is what makes the output explainable, replayable against
fixtures, and free of an external AI dependency. The AI phase replaces two
specific pieces, `taxonomy.ts` and the null embedding, not the architecture.

Design decisions and their reasoning are in
[`docs/profile-analysis-v1.md`](docs/profile-analysis-v1.md).

### What it reads

Six calls, ~39 requests, all public-data endpoints. The stored token is there
for the rate limit (5,000/hour rather than 60 shared per IP), not for access —
nothing here reaches anything `read:user` does not already allow.

| Endpoint | Yields |
| -------- | ------ |
| `GET /user` | Identity and account age |
| `GET /users/{login}/repos` | Repositories, topics, stars, push dates |
| `GET /repos/{owner}/{repo}/languages` | Byte counts, for the 30 most recently pushed |
| `GET /users/{login}/events/public` | ~90 days of pushes, PRs, reviews, comments |
| `GET /users/{login}/starred` | Interest signal |
| `GET /search/issues` | Merged PRs into repos the user does not own |

That last one is the most valuable number in the analysis: it is the only
direct evidence that someone has contributed to open source, which is the exact
behaviour being matched for. Everything else is a proxy for it.

Only the first two are load-bearing. The rest degrade individually and record
what failed in `analysis.sources`, which the dashboard surfaces — a sync that
lost the starred list is worth more than a sync that failed.

### What it derives

`server/src/lib/profile/` holds four pure modules — plain GitHub objects in,
plain data out, no Supabase and no `fetch`:

- **`languages.ts`** — share per language, weighted `sqrt(bytes)` against a
  12-month recency half-life, quartered for forks, boosted by recent pushes.
  The half-life is the load-bearing knob: someone who wrote Java until 2021 and
  TypeScript this month should read as a TypeScript developer, and their Java
  repos are usually much bigger.
- **`frameworks.ts`** + **`taxonomy.ts`** — GitHub says a repo is 62%
  TypeScript, not that it is a Next.js app. A ~130-entry alias table recovers
  the difference from topics, descriptions and stars. Two independent mentions
  are required, forks and repositories untouched for three years do not count as
  evidence, and stars alone can never claim experience.
- **`complexity.ts`** — six weighted components summing to 0–100, banded into
  `public.complexity_level`. Each records a plain-language note, because the
  dashboard has to answer "why did you call me intermediate?" with the actual
  arithmetic.
- **`interests.ts`** — topics from stars and forks, kept separate from the
  detected stack. Someone with forty Python repos who stars nothing but Rust is
  saying where they want to go.

Pure by design so `analyze-fixture.ts` can replay saved API responses through
the exact derivation the server runs. Every weight above is a guess until it is
checked against real accounts, and checking against the live API would be slow,
rate-limited and different every run:

```bash
export GITHUB_TOKEN=...    # a classic PAT, no scopes needed
npm run fixture:capture --workspace=server -- torvalds
npm run fixture:analyze --workspace=server -- torvalds
```

### Honesty about thin profiles

Under three public repositories and no recent events, the analysis sets
`confidence: 'low'` rather than asserting a level, and the dashboard says so.
Plenty of strong developers have empty public profiles because their work sits
behind a company firewall, and quietly labelling a principal engineer a beginner
is a worse failure than admitting we cannot tell. Confidence is also capped at
`medium` whenever any source failed.

For the same reason, a rate-limited `GET /search/issues` scores zero points but
reports that it could not be read — otherwise a failed request and a genuine
absence of contributions look identical, a 30-point swing with nothing to
distinguish them.

### How it runs

```
POST /api/v1/auth/session        (the token is captured here)
  └─ kickProfileSync(userId)     fire-and-forget
       sync_status = 'running' → analyse → 'ready' | 'failed'
```

In-process and in the background — no queue, no worker container. A single job
type that runs once per user per six hours does not earn a fourth service.

The failure mode that buys is real, and handled rather than hidden: an
in-process task dies with the process, leaving `sync_status = 'running'`
forever. `GET /api/v1/me` treats a run older than ten minutes as abandoned and
re-kicks it. When that stops being good enough, the answer is a worker
container, and nothing in the current design obstructs it.

Meanwhile the client polls `GET /api/v1/me`. Because the sync starts at the
OAuth callback, it runs *while* the user answers the questionnaire — twenty
seconds of GitHub calls disappear behind three questions they were going to
answer anyway.

### Stated preferences

The derived signals say what a developer has done; only the questionnaire says
what they want. `/onboarding` collects four things, all skippable and editable
later from the dashboard: a correction pass on the detected stack, languages
they want to work in, free-text learning goals, and why they are here plus how
much time and how much difficulty they want.

Two columns are easy to conflate and deliberately separate:

- `complexity_level` is what the analysis thinks they *are*.
- `difficulty_preference` is what they want to *take on*. An expert wanting a
  quiet weekend and a beginner spoiling for a fight both break if you merge
  these, and `repositories.contribution_difficulty` already exists to match
  against.

Editing the detected stack stamps `tech_stack_edited_at`, which permanently
hands that column from the sync to the user. Without it, every re-sync would
quietly undo the correction they just made.

## Recommendations

v1 recommends up to five repositories that share **at least two technologies**
with the developer's detected stack, best match first. No embeddings, no
ranking model — a set intersection, indexed and explainable, which is the
foundation the semantic version ranks on top of later.

### The vocabulary problem

A user's `tech_stack` holds canonical names — `React`, `Next.js`, `TypeScript` —
produced by `profile/taxonomy.ts`. A repository carries raw GitHub topics:
`reactjs`, `nextjs`, `react-js`. Those two sets never intersect, so the obvious
query returns nothing forever.

So ingestion runs every repository's topics through the *same* taxonomy and
stores the canonical result in `repositories.tech_tags`. Both sides end up
speaking one vocabulary, and matching collapses to an array overlap:

```sql
select * from recommend_repositories(
  p_tech_tags           => array['TypeScript','React','Docker'],
  p_min_overlap         => 2,
  p_limit               => 5,
  p_preferred_languages => array['TypeScript'],   -- tiebreak only
  p_difficulty          => 'beginner',            -- tiebreak only
  p_exclude_owner       => 'their-github-login'
);
```

`tech_stack` is user-editable, so matching is case-insensitive: a stored
generated column `tech_tags_lower` carries the GIN index while `tech_tags`
keeps the spelling worth displaying. Someone who types `react` into the stack
editor still matches React, and the response still reads "React".

### Ranking

A cascade rather than a blended score, because every tier is a sentence a user
can be told:

1. **How many of their technologies it touches.** The point of the feature.
2. A language they said they want to work in.
3. Pitched at the difficulty they asked for.
4. Has good first issues.
5. Stars — last, and only as a tiebreak. Leading with popularity would
   recommend the same five famous repositories to everybody.

Tiers 2 and 3 are the stated preferences from onboarding, and they only ever
reorder repositories that already qualify. Nothing gets onto the list because
someone said they would like to learn Rust; the two-technology rule runs against
what they actually hold.

Recommendations are computed per request rather than stored. The query is one
indexed array overlap over a few thousand rows, and a cached list that ignores a
stack the user corrected two minutes ago is worse than no cache.

### Zero results, three ways

Three quite different situations return nothing, and the API distinguishes them
because "no results" is useless advice when the fix is one click away:

| `status` | Means | What the page says |
| -------- | ----- | ------------------ |
| `insufficient_stack` | Fewer than two technologies on the profile | Invites them to add some, and points out that private work is the usual reason |
| `no_matches` | Real stack, real corpus, no overlap | Says the corpus is still small and offers the stack editor |
| `empty_corpus` | Nothing indexed | A setup note with the ingestion command — an operator problem, not a user one |

The first is the cold-start case from the profile analysis, and it is common:
plenty of strong developers have thin public profiles. Padding the page with
generic popular repositories would hide the one thing they need to do.

### Seeding the corpus

```bash
export GITHUB_TOKEN=...      # a classic PAT, no scopes needed
npm run ingest:repos --workspace=server -- --limit 5    # check credentials first
npm run ingest:repos --workspace=server                 # full sweep, ~5 minutes
```

126 searches, one per technology in the taxonomy plus one per major language,
paced 2.2s apart to stay inside the search API's 30-requests-per-minute limit —
two orders of magnitude tighter than the rest of GitHub's API. Re-running is
safe; every row upserts on `github_id`.

Two filters worth knowing about:

- **Every query requires `good-first-issues:>0`.** As much a product decision as
  a filter: a repository with no marked way in is a worse recommendation than a
  less popular one that has them, and it means `has_good_first_issues` is known
  rather than guessed. Widening the corpus is a second pass without it.
- **Repositories with fewer than two recognised technologies are dropped.** They
  could never satisfy a two-technology match, so storing them only adds rows.

`contribution_difficulty` is derived from star count alone and is a proxy for
project *weight* — how much context, process and review a change has to pass
through — not for issue difficulty. A 300-star tool takes a patch; a
200,000-star framework takes a proposal, a discussion and three reviewers.
Reading the issues themselves is what would make it real.

## API

| Method | Route                  | Auth     | Purpose                                          |
| ------ | ---------------------- | -------- | ------------------------------------------------ |
| `GET`  | `/health`              | —        | Liveness; backs the Docker healthcheck           |
| `GET`  | `/health/ready`        | —        | Readiness; 503 when Supabase is unconfigured     |
| `GET`  | `/api/v1`              | —        | API index                                        |
| `POST` | `/api/v1/auth/session` | Bearer   | Sync profile, store the GitHub token, start the analysis |
| `GET`  | `/api/v1/me`           | Bearer   | The signed-in developer's profile                |
| `POST` | `/api/v1/me/sync`      | Bearer   | Start a profile analysis; `?force=1` skips the throttle |
| `GET`  | `/api/v1/me/analysis`  | Bearer   | The full derivation behind the profile           |
| `PATCH`| `/api/v1/me/preferences` | Bearer | Onboarding answers and manual stack corrections  |
| `GET`  | `/api/v1/recommendations` | Bearer | Repositories sharing ≥2 technologies with the user's stack |

Feature routers mount onto `apiRouter` in `server/src/routes/index.ts`. Routes
marked Bearer run through `requireAuth`, which validates the Supabase session
JWT from the `Authorization` header.

## Scripts

| Command                | Effect                                      |
| ---------------------- | ------------------------------------------- |
| `npm run dev`          | Client + API concurrently                   |
| `npm run build`        | Build both workspaces                       |
| `npm run typecheck`    | Typecheck both workspaces                   |
| `npm run lint`         | Lint the client                              |
| `npm run docker:up`    | Build and start the stack                   |
| `npm run docker:down`  | Stop the stack                              |
| `npm run docker:reset` | Stop and drop the database volume           |
| `npm run fixture:capture --workspace=server -- <login>` | Save a GitHub account's API responses to `server/fixtures/` |
| `npm run fixture:analyze --workspace=server -- <login>` | Replay a fixture through the derivation |
| `npm run ingest:repos --workspace=server` | Seed `repositories` from GitHub search |

## Next steps

1. Tune the heuristics in `server/src/lib/profile/` against real fixtures, and
   run a real ingestion sweep. Every weight in the analysis is a defensible
   guess, and none has yet met a live GitHub response.
2. Issue ingestion, so `/repositories/[id]` can show specific work to pick up
   rather than only the repository that has it.
3. Widen the corpus: a second ingestion pass without the `good-first-issues:>0`
   qualifier, for developers past their first contribution.
4. Embeddings: assemble the profile text, fill `profile_embedding`, and let
   semantic similarity rank what the tech overlap has already shortlisted.
5. Move `github_credentials.access_token` into Supabase Vault.
