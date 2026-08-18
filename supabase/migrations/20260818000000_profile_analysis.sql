-- =============================================================================
-- Contribly — profile analysis
--
-- Everything the first-login analysis needs to write, and everything the
-- onboarding questionnaire needs to store. Three groups of columns:
--
--   1. Sync lifecycle. The analysis runs in the background after sign-in, so
--      the client needs something to poll.
--   2. Stated preferences. The derived signals say what a developer *has*
--      done; only the questionnaire says what they *want*.
--   3. Explainability. The full derivation is kept so the dashboard can answer
--      "why did you call me intermediate?" with the actual arithmetic.
--
-- No new tables, so no additions to 20260808000100_grants.sql: these columns
-- inherit the grants and the owner-only RLS policies already on public.users.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Sync lifecycle
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'profile_sync_status') then
    create type public.profile_sync_status as enum (
      'pending',   -- never run
      'running',   -- in flight right now
      'ready',     -- completed; last_synced_at is meaningful
      'failed'     -- gave up; sync_error says why
    );
  end if;
end
$$;

alter table public.users
  add column if not exists sync_status public.profile_sync_status not null default 'pending',
  -- Also the staleness clock: a 'running' row whose start is far enough in the
  -- past belonged to a process that died, and gets re-kicked.
  add column if not exists sync_started_at timestamptz,
  add column if not exists sync_error text;

-- -----------------------------------------------------------------------------
-- Stated preferences — the onboarding questionnaire
-- -----------------------------------------------------------------------------

alter table public.users
  -- Languages they want to work in. Deliberately not tech_stack: plenty of
  -- people write one language all day and want to contribute in another.
  add column if not exists preferred_languages text[] not null default '{}',
  -- Free-form set, validated by the API rather than a check constraint so
  -- adding a goal is a deploy and not a migration.
  add column if not exists contribution_goals text[] not null default '{}',
  add column if not exists weekly_hours integer,
  -- What they want to take on, as opposed to complexity_level, which is what
  -- they are. An expert wanting a quiet weekend and a beginner spoiling for a
  -- fight both break if you conflate the two.
  add column if not exists difficulty_preference public.complexity_level,
  add column if not exists onboarding_completed_at timestamptz;

alter table public.users
  drop constraint if exists users_weekly_hours_range;
alter table public.users
  add constraint users_weekly_hours_range
  check (weekly_hours is null or (weekly_hours > 0 and weekly_hours <= 80));

-- -----------------------------------------------------------------------------
-- Explainability and override tracking
-- -----------------------------------------------------------------------------

alter table public.users
  -- The raw 0-100 behind complexity_level, kept so the band can be re-cut
  -- without re-running every sync.
  add column if not exists complexity_score integer,
  -- The whole derivation: per-language shares, framework evidence, interest
  -- topics, the complexity component breakdown, and which API calls succeeded.
  -- One jsonb blob rather than a dozen columns because the algorithm will churn
  -- for a while yet and the schema should not churn with it. Anything the
  -- matching query needs to filter on gets promoted to a real column later.
  add column if not exists analysis jsonb not null default '{}'::jsonb,
  -- Set when the user hand-edits their detected stack during onboarding. While
  -- it is null the sync owns tech_stack; once set, the sync stops writing that
  -- column and only updates analysis. Without this, every re-sync would quietly
  -- undo the correction the user just made.
  add column if not exists tech_stack_edited_at timestamptz;

alter table public.users
  drop constraint if exists users_complexity_score_range;
alter table public.users
  add constraint users_complexity_score_range
  check (complexity_score is null or (complexity_score between 0 and 100));

-- Finding everyone who still needs a first analysis, without scanning the ones
-- that are done. Partial because 'ready' is the steady state for most rows.
create index if not exists users_sync_status_idx
  on public.users (sync_status)
  where sync_status <> 'ready';
