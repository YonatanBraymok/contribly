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
| `users`              | Profile: detected stack, complexity level, learning goals, and the `profile_embedding` used as the match query |
| `github_credentials` | The user's GitHub access token. Service-role only — RLS on, no policies |
| `repositories` | Curated corpus with an `embedding` over description + topics + language |
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

Row Level Security is on for all three tables: profiles are readable and
writable only by their owner, while the repository and issue corpus is public
read-only — writes go through the service role.

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
/auth                     "Continue with GitHub" (Server Action)
  -> github.com/login/oauth/authorize        consent screen
  -> <project>.supabase.co/auth/v1/callback  Supabase exchanges with GitHub
  -> /auth/callback?code=...                 exchangeCodeForSession sets cookies
       -> POST /api/v1/auth/session          profile sync + token capture
  -> /dashboard
```

`src/proxy.ts` guards every route. `/` and `/auth` are public; everything else
redirects to `/auth?next=<path>` without a session. It is named `proxy.ts`
because Next.js 16 deprecated the `middleware.ts` convention and renamed it.

### The GitHub token

Supabase returns GitHub's access token as `provider_token` **only** on the
response to the initial code exchange — it is not kept in the session and is
never refreshed. `/auth/callback` forwards it to the API, which stores it in
`github_credentials` so the profile-sync worker can call GitHub as the user at
5,000 requests/hour rather than the anonymous 60.

That table has RLS enabled and **no policies**, which under Postgres denies
every row to `anon` and `authenticated`; only the service role reaches it. The
token is stored as-is — moving it to Supabase Vault is worth doing before this
holds real users.

Requested scopes are `read:user` and `user:email`, declared in
`client/src/lib/supabase/config.ts`. Neither grants repository write access or
reaches private repositories.

## API

| Method | Route                  | Auth     | Purpose                                          |
| ------ | ---------------------- | -------- | ------------------------------------------------ |
| `GET`  | `/health`              | —        | Liveness; backs the Docker healthcheck           |
| `GET`  | `/health/ready`        | —        | Readiness; 503 when Supabase is unconfigured     |
| `GET`  | `/api/v1`              | —        | API index                                        |
| `POST` | `/api/v1/auth/session` | Bearer   | Sync profile and store the GitHub token          |
| `GET`  | `/api/v1/me`           | Bearer   | The signed-in developer's profile                |

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

## Next steps

1. A profile-sync worker that derives `tech_stack` and `complexity_level` from
   commit history, using the token in `github_credentials`.
2. An ingestion job that indexes repositories and issues into the vector tables.
3. `POST /api/v1/recommendations` — embed the profile, call the match RPCs, and
   rerank.
4. Move `github_credentials.access_token` into Supabase Vault.
