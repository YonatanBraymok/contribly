# Profile analysis — v1

The plan for README "Next steps" #1: turn a fresh GitHub sign-in into a profile
Contribly can match against.

Four decisions frame everything below.

| Decision | Choice | Consequence |
| --- | --- | --- |
| GitHub data | Public activity only; `read:user` + `user:email` unchanged | The consent screen stays easy to say yes to. Users whose work is all private get a thin profile — the questionnaire carries them. |
| Embeddings | Deferred; `profile_embedding` stays null | No third-party AI dependency, no key to manage. Matching v1 runs on SQL filters, not `match_repositories()`. |
| Execution | In-process background task, client polls | No queue, no Redis, no fourth container. Costs a self-healing rule for syncs killed by a restart. |
| Onboarding | Four steps, skippable | ~60 seconds. Derived signals say what the user *has* done; only the questionnaire says what they *want*. |

The through-line: **v1 is deterministic**. Every number below comes from
arithmetic over GitHub's REST responses plus a curated keyword table. That is
not a limitation to apologise for — it is what makes the output explainable,
testable against fixtures, and cheap to re-run. The AI phase replaces two
specific pieces (`taxonomy.ts` and the null embedding), not the architecture.

---

## 1. What we read from GitHub

All endpoints are public-data endpoints, called with the user's stored token
purely for the 5,000 req/hour limit rather than for extra access.

| # | Endpoint | Yields | Calls |
| --- | --- | --- | --- |
| 1 | `GET /user` | login, name, bio, public_repos, followers, `created_at` | 1 |
| 2 | `GET /users/{login}/repos?type=owner&sort=pushed&per_page=100` | repo list with `topics`, `language`, `fork`, `stargazers_count`, `pushed_at` | 1–2 |
| 3 | `GET /repos/{owner}/{name}/languages` | byte counts per language, for the 30 most recently pushed non-archived repos | ≤30 |
| 4 | `GET /users/{login}/events/public?per_page=100` | 3 pages ≈ 300 events ≈ 90 days of Push / PullRequest / Issues / IssueComment / PullRequestReview / Watch / Fork | 3 |
| 5 | `GET /users/{login}/starred?per_page=100` | 2 pages of starred repos — languages and topics | 2 |
| 6 | `GET /search/issues?q=author:{login}+type:pr+is:merged+-user:{login}` | `total_count` — merged PRs into repos the user does not own | 1 |

≈ 39 calls per sync. Two notes that matter:

**Why `/users/{login}/repos` and not `/user/repos`.** The public-user endpoint
needs no scope at all, so the call cannot start failing if the granted scopes
ever narrow. It returns exactly what we are allowed to analyse anyway.

**Endpoint 6 is the single most valuable call.** Merged PRs into *other people's*
repositories is the only direct evidence that someone has actually contributed
to open source — which is the precise thing Contribly matches for. Everything
else is a proxy for it. `-user:{login}` is what excludes their own projects.

**Failure policy:** each source is independently optional. A 404 on the starred
list degrades the interests signal; it does not fail the sync. Only endpoints 1
and 2 are load-bearing — without them the sync fails and says so.

Concurrency is capped at 5 in-flight requests to stay clear of GitHub's
secondary rate limits, with one retry on `403` + `Retry-After`.

## 2. What we derive

### `language_proficiency` — a normalised distribution

For each repo, sum per-language bytes weighted by four factors:

```
contribution(repo, lang) =
    sqrt(bytes(repo, lang))              # damp the one 400k-line monorepo
  * 0.5 ^ (months_since_pushed / 12)     # 12-month half-life
  * (repo.fork    ? 0.25 : 1.0)          # a fork may be nobody's work
  * (1 + 0.15 * min(push_events, 10))    # recent commits prove real typing
```

Sum across repos, normalise to 1.0, drop anything under 2%, keep the top 10.

`sqrt` rather than raw bytes because a single vendored `Jupyter Notebook` or a
generated client otherwise swallows the whole distribution. The half-life is the
important knob: a developer who wrote Java in 2021 and TypeScript this month
should read as a TypeScript developer, and a linear recency weight is not
aggressive enough to make that happen.

GitHub's linguist already strips vendored and generated files from endpoint 3,
so the usual `HTML`/`CSS` false positives are mostly handled upstream.

### `tech_stack` — languages plus frameworks

GitHub does not tell us someone uses Next.js. v1 infers it from three signals
run through one curated keyword table:

- repo `topics` — user-declared, highest precision
- repo descriptions — noisier, matched only on the canonical table
- starred repos' topics — reveals tooling they read but have not shipped

`server/src/lib/profile/taxonomy.ts` maps aliases to canonical names
(`nextjs`/`next.js`/`next` → `Next.js`), ~150 entries across web, backend,
ML, infra and tooling. A framework enters `tech_stack` at **two independent
mentions**, which is what keeps a single aspirational star from claiming
someone is a Kubernetes engineer.

Final `tech_stack` = languages at ≥5% share + qualifying frameworks, capped at 15.

> This file is the honest seam where the AI phase lands. Replacing a hand-written
> alias table with a model that reads a README is a drop-in swap of one module.

### `complexity_level` — a scored heuristic, not a vibe

A 0–100 score from six components, banded into the existing enum:

| Component | Max | Bands |
| --- | --- | --- |
| External merged PRs | 30 | 0→0, 1–2→10, 3–9→18, 10–29→25, 30+→30 |
| Sustained activity | 20 | active months in the last 12 × 1.67 |
| Language breadth | 15 | 1 lang→3, 2→7, 3–4→11, 5+→15 (counting ≥3% share) |
| Project ownership | 20 | log-scaled on max stars across non-fork repos |
| Account maturity | 10 | 2 pts/year since `created_at`, capped at 5 years |
| Collaboration | 5 | reviews + issue comments on repos they do not own |

**Bands:** `0–24 beginner`, `25–49 intermediate`, `50–74 advanced`, `75–100 expert`.

External PRs carry the most weight because they measure the target behaviour
directly. Account maturity is capped deliberately low — a ten-year-old dormant
account is not an expert, and letting age dominate would be the single most
insulting failure mode this scorer has.

**Cold-start guard.** Under 3 public repos *and* zero events in the window, we do
not assert a level: the score is stored, the band is `beginner`, and
`analysis.confidence` is set to `low`. The UI then leans on the questionnaire
answer instead of the derived band. This case is common — plenty of strong
developers have empty public profiles — and getting it wrong loudly is worse
than admitting we cannot tell.

The full component breakdown is persisted, so the dashboard can answer "why did
you call me intermediate?" with the actual arithmetic. Users will ask.

### Interests — what they want, not what they have

Topics and languages from starred and forked repos, ranked by frequency and
kept separate from `tech_stack`. Someone with 40 Python repos who stars nothing
but Rust is telling us where they want to go, and that is exactly the signal a
recommendation engine should act on.

### The `ProfileAnalysis` shape

Persisted whole into a new `analysis jsonb` column:

```ts
interface ProfileAnalysis {
  version: 1;
  generated_at: string;
  confidence: 'low' | 'medium' | 'high';
  github: {
    account_created_at: string;
    public_repos: number; followers: number;
    non_fork_repos: number; max_stars: number;
    external_merged_prs: number;
    active_months_last_year: number;
    events_analysed: number; events_window_days: number;
  };
  languages: { name: string; share: number; bytes: number; repos: number }[];
  frameworks: { name: string; mentions: number; sources: string[] }[];
  interests: { topic: string; count: number }[];
  complexity: {
    score: number;
    level: 'beginner'|'intermediate'|'advanced'|'expert';
    components: Record<string, { points: number; max: number; note: string }>;
  };
  sources: { endpoint: string; ok: boolean; error?: string }[];
}
```

One jsonb blob rather than twelve columns: the algorithm will churn hard over
the next few weeks and the schema should not churn with it. Anything the
matching query needs to *filter* on gets promoted to a real column later.

## 3. Schema changes

One migration, `supabase/migrations/20260818000000_profile_analysis.sql`.

```sql
create type public.sync_status as enum ('pending','running','ready','failed');

alter table public.users
  -- sync lifecycle
  add column sync_status public.sync_status not null default 'pending',
  add column sync_started_at timestamptz,
  add column sync_error text,
  -- questionnaire (what they want)
  add column preferred_languages text[] not null default '{}',
  add column contribution_goals text[] not null default '{}',
  add column weekly_hours integer,
  add column difficulty_preference public.complexity_level,
  add column onboarding_completed_at timestamptz,
  -- explainability + override tracking
  add column complexity_score integer,
  add column analysis jsonb not null default '{}'::jsonb,
  add column tech_stack_edited_at timestamptz;
```

Three things worth calling out.

**`difficulty_preference` is not `complexity_level`.** One is what the developer
*is*, the other is what they want to *take on*. An expert looking for a relaxing
weekend and a beginner who wants a challenge both break if you conflate them —
and `repositories.contribution_difficulty` already exists to match against.

**`tech_stack_edited_at` prevents clobbering.** The user edits their detected
stack in onboarding; the next sync must not silently overwrite it. Rule: the
worker always writes `analysis.frameworks`/`analysis.languages`, but writes the
`tech_stack` column only when `tech_stack_edited_at is null`. The dashboard can
still surface "we now also detect Rust — add it?" from the analysis blob.

**No new grants needed** — these are columns on `public.users`, already covered
by `20260808000100_grants.sql`. Adding a *table* would need a grants entry; this
does not. The existing owner-only RLS policies cover the new columns unchanged.

## 4. Execution model

```
POST /api/v1/auth/session          (already exists — token captured here)
  └─ if last_synced_at is null → kickSync(userId)   fire-and-forget

kickSync:
  guard: already in the in-memory running set?      → no-op
  guard: synced < 6h ago and not forced?            → no-op
  users.sync_status = 'running', sync_started_at = now()
  ├─ analyze()  →  users.{tech_stack, language_proficiency, complexity_level,
  │                       complexity_score, analysis, last_synced_at}
  │                sync_status = 'ready'
  └─ on throw  →  sync_status = 'failed', sync_error = <message>
```

The client polls `GET /api/v1/me` until `sync_status` leaves `running`.

**The honest caveat:** an in-process task dies with the container. The mitigation
is one rule in `GET /api/v1/me` — if `sync_status = 'running'` and
`sync_started_at` is older than 10 minutes, treat the run as stale and re-kick
it. Cheap, self-healing, and no job table.

Concurrency is bounded by an in-memory `Set<userId>` of active runs. That is
per-process, so it is a correctness guard for a single API container and a
best-effort one behind a load balancer — acceptable while the operation is
idempotent and 6-hour-throttled. When it stops being acceptable, the fix is the
worker container, and this design does not obstruct it.

### Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/me/sync` | 202 + current status; `?force=1` bypasses the 6h throttle |
| `GET` | `/api/v1/me` | extended with `sync_status`, questionnaire fields, analysis summary |
| `GET` | `/api/v1/me/analysis` | the full `analysis` blob, for the "why" UI |
| `PATCH` | `/api/v1/me/preferences` | questionnaire answers + `tech_stack` override |

### Files

```
server/src/lib/github/
  client.ts        fetch wrapper: auth, pagination, rate-limit handling, retry
  endpoints.ts     the six typed calls above
server/src/lib/profile/
  taxonomy.ts      alias → canonical framework/tool table
  languages.ts     the proficiency formula          (pure)
  complexity.ts    the scorer and its bands         (pure)
  interests.ts     topic aggregation                (pure)
  analyze.ts       fetch → derive → ProfileAnalysis
  sync.ts          run lifecycle and persistence
server/src/routes/profile.routes.ts
```

The four pure modules take plain GitHub response objects and return plain data —
no Supabase, no fetch. That is what makes section 6 possible.

## 5. Client

New route `/onboarding`, four steps. `/dashboard` (a Server Component that
already fetches the profile) redirects there when `onboarding_completed_at` is
null. The check stays out of `proxy.ts` — that file runs on nearly every request
and already pays for one Supabase round trip.

| Step | Asks | Writes |
| --- | --- | --- |
| 1 | *Nothing* — "reading your GitHub profile…", polling `GET /me` | — |
| 2 | Confirm/edit the detected stack | `tech_stack`, `tech_stack_edited_at` |
| 3 | Languages to work in + free-text goals | `preferred_languages`, `learning_goals` |
| 4 | Why you're here (learn new tech / deepen stack / first contribution / give back), hours per week, difficulty appetite | `contribution_goals`, `weekly_hours`, `difficulty_preference` |

The sequencing is the point: the sync is kicked at `POST /auth/session`, so it
runs **while the user answers steps 2–4**. Twenty seconds of GitHub calls
disappear behind a questionnaire the user is filling in anyway, and step 2 is
already populated by the time they reach it. If the sync is still running at
step 2, that step shows a skeleton and lets them move on — it is never a wall.

The dashboard then grows: proficiency bars from `language_proficiency`, the
complexity band with its component breakdown behind a disclosure, interests as a
distinct section, and a re-sync button hitting `?force=1`.

## 6. Tuning and verification

The repo has no test framework, and v1 should not drag one in. What it should
add is `server/scripts/analyze-fixture.ts`: capture one real account's six API
responses to JSON, then run the pure modules over that fixture and print the
resulting `ProfileAnalysis`. Heuristics get tuned in a second with no network
and no rate limit, and the fixtures become the regression suite the day a test
runner arrives.

Three fixtures worth capturing: a heavy OSS contributor, a working developer with
few external PRs, and a near-empty account — the last one being the cold-start
path that is easiest to get wrong and hardest to notice.

## 7. Build order

1. Migration + regenerate the `Profile` types on both sides.
2. `github/client.ts` + `endpoints.ts`, verified against one real token.
3. The four pure derivation modules + the fixture script. **Tune here** — this
   is where the product quality actually lives, and it is fast to iterate.
4. `analyze.ts`, `sync.ts`, routes, and the kick from `POST /auth/session`.
5. `/onboarding`, then the dashboard extension.

Steps 1–3 are the substance; 4–5 are wiring.

## 8. Explicitly out of scope for v1

- `profile_embedding` — stays null until the AI phase.
- Recommendations themselves. v1 produces the profile; matching is the next
  piece, and with embeddings deferred its first cut is a SQL filter over
  `preferred_languages` × `difficulty_preference` × `has_good_first_issues`.
- Private-repo signals, contribution history snapshots, org affiliation,
  README-content analysis, and any scheduled re-sync beyond the 6-hour throttle.
