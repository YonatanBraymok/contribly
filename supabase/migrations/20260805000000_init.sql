-- =============================================================================
-- Contribly — initial schema
--
-- Establishes the semantic-search foundation: pgvector, the user profile that
-- drives matching, and the curated repository/issue corpus that gets matched
-- against.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------

-- Supabase convention: extensions live in their own schema, not public.
create schema if not exists extensions;

-- Semantic search over embeddings.
create extension if not exists vector with schema extensions;
-- gen_random_uuid()
create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'complexity_level') then
    create type public.complexity_level as enum (
      'beginner',
      'intermediate',
      'advanced',
      'expert'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'issue_state') then
    create type public.issue_state as enum ('open', 'closed');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Shared triggers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- users
--
-- One row per authenticated developer. `id` mirrors auth.users(id) so RLS can
-- compare against auth.uid() without a join.
-- -----------------------------------------------------------------------------

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,

  email text,
  github_username text unique,
  github_id bigint unique,
  avatar_url text,

  -- Derived from commit history: languages, frameworks, tooling.
  tech_stack text[] not null default '{}',
  -- Richer breakdown, e.g. {"TypeScript": 0.62, "Go": 0.21}.
  language_proficiency jsonb not null default '{}'::jsonb,
  complexity_level public.complexity_level not null default 'beginner',

  -- Explicitly stated by the user; steers matching beyond past behaviour.
  learning_goals text[] not null default '{}',
  -- Embedding of (tech_stack + learning_goals), i.e. the match query vector.
  profile_embedding extensions.vector(1536),

  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_tech_stack_idx
  on public.users using gin (tech_stack);

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- repositories
--
-- The curated corpus. `embedding` encodes description + topics + language so a
-- profile vector can be matched against it by cosine distance.
-- -----------------------------------------------------------------------------

create table if not exists public.repositories (
  id uuid primary key default gen_random_uuid(),

  github_id bigint not null unique,
  full_name text not null unique,          -- "owner/name"
  owner text not null,
  name text not null,
  description text,
  html_url text not null,
  homepage text,

  primary_language text,
  topics text[] not null default '{}',
  license text,

  stars integer not null default 0,
  forks integer not null default 0,
  open_issues_count integer not null default 0,

  -- Signals used to rank "is this a good place to contribute right now?"
  contribution_difficulty public.complexity_level,
  has_good_first_issues boolean not null default false,
  has_contributing_guide boolean not null default false,
  last_commit_at timestamptz,

  -- Exact text that was embedded; lets us re-embed on model changes.
  embedding_source text,
  embedding extensions.vector(1536),

  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- HNSW over cosine distance — the index backing semantic search.
create index if not exists repositories_embedding_idx
  on public.repositories using hnsw (embedding extensions.vector_cosine_ops);

create index if not exists repositories_topics_idx
  on public.repositories using gin (topics);
create index if not exists repositories_primary_language_idx
  on public.repositories (primary_language);
create index if not exists repositories_stars_idx
  on public.repositories (stars desc);

drop trigger if exists repositories_set_updated_at on public.repositories;
create trigger repositories_set_updated_at
  before update on public.repositories
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- issues
--
-- Individual contribution opportunities. Embedded separately from their repo so
-- a "good first issue" can surface on its own merits.
-- -----------------------------------------------------------------------------

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories (id) on delete cascade,

  github_id bigint not null unique,
  number integer not null,
  title text not null,
  body text,
  html_url text not null,

  labels text[] not null default '{}',
  is_good_first_issue boolean not null default false,
  is_help_wanted boolean not null default false,
  state public.issue_state not null default 'open',

  comments_count integer not null default 0,
  github_created_at timestamptz,

  embedding extensions.vector(1536),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (repository_id, number)
);

create index if not exists issues_embedding_idx
  on public.issues using hnsw (embedding extensions.vector_cosine_ops);

create index if not exists issues_repository_id_idx
  on public.issues (repository_id);
create index if not exists issues_labels_idx
  on public.issues using gin (labels);
-- Partial index: the overwhelming majority of queries want open beginner work.
create index if not exists issues_good_first_open_idx
  on public.issues (is_good_first_issue)
  where state = 'open' and is_good_first_issue;

drop trigger if exists issues_set_updated_at on public.issues;
create trigger issues_set_updated_at
  before update on public.issues
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Semantic search RPCs
--
-- Called from the API via supabase.rpc(...). The distance operator is `<=>`
-- (cosine), so similarity is 1 - distance.
-- -----------------------------------------------------------------------------

create or replace function public.match_repositories(
  query_embedding extensions.vector(1536),
  match_threshold double precision default 0.5,
  match_count integer default 10,
  filter_languages text[] default null
)
returns table (
  id uuid,
  full_name text,
  description text,
  html_url text,
  primary_language text,
  topics text[],
  stars integer,
  contribution_difficulty public.complexity_level,
  similarity double precision
)
language sql
stable
set search_path = ''
as $$
  select
    r.id,
    r.full_name,
    r.description,
    r.html_url,
    r.primary_language,
    r.topics,
    r.stars,
    r.contribution_difficulty,
    1 - (r.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.repositories r
  where r.embedding is not null
    and (filter_languages is null or r.primary_language = any (filter_languages))
    and 1 - (r.embedding operator(extensions.<=>) query_embedding) > match_threshold
  order by r.embedding operator(extensions.<=>) query_embedding
  limit least(match_count, 100);
$$;

create or replace function public.match_issues(
  query_embedding extensions.vector(1536),
  match_threshold double precision default 0.5,
  match_count integer default 20,
  only_good_first_issue boolean default false
)
returns table (
  id uuid,
  repository_id uuid,
  repository_full_name text,
  title text,
  html_url text,
  labels text[],
  is_good_first_issue boolean,
  similarity double precision
)
language sql
stable
set search_path = ''
as $$
  select
    i.id,
    i.repository_id,
    r.full_name as repository_full_name,
    i.title,
    i.html_url,
    i.labels,
    i.is_good_first_issue,
    1 - (i.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.issues i
  join public.repositories r on r.id = i.repository_id
  where i.embedding is not null
    and i.state = 'open'
    and (not only_good_first_issue or i.is_good_first_issue)
    and 1 - (i.embedding operator(extensions.<=>) query_embedding) > match_threshold
  order by i.embedding operator(extensions.<=>) query_embedding
  limit least(match_count, 100);
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- Profiles are private to their owner. The repository/issue corpus is public
-- read-only; only the service role (used by the ingestion worker) may write.
-- -----------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.repositories enable row level security;
alter table public.issues enable row level security;

drop policy if exists "Users can read own profile" on public.users;
create policy "Users can read own profile"
  on public.users for select
  using ((select auth.uid()) = id);

drop policy if exists "Users can insert own profile" on public.users;
create policy "Users can insert own profile"
  on public.users for insert
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update own profile" on public.users;
create policy "Users can update own profile"
  on public.users for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Repositories are readable by everyone" on public.repositories;
create policy "Repositories are readable by everyone"
  on public.repositories for select
  using (true);

drop policy if exists "Issues are readable by everyone" on public.issues;
create policy "Issues are readable by everyone"
  on public.issues for select
  using (true);
