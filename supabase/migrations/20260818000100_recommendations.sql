-- =============================================================================
-- Contribly — recommendations
--
-- v1 matching is a set intersection, not a vector search: recommend
-- repositories that share at least two technologies with the developer's
-- detected stack. `profile_embedding` stays null and match_repositories() stays
-- unused until the AI phase; this is the foundation underneath it.
--
-- The problem that makes this need schema at all: a user's tech_stack holds
-- canonical names ("React", "Next.js", "TypeScript") produced by
-- server/src/lib/profile/taxonomy.ts, while a repository carries raw GitHub
-- topics ("reactjs", "nextjs", "react-js"). Those never intersect. So ingestion
-- runs every repository's topics through the *same* taxonomy and stores the
-- canonical result in `tech_tags`, which is what makes both sides speak one
-- vocabulary — and what makes the match a plain array operation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- repositories — canonical tags and liveness
-- -----------------------------------------------------------------------------

alter table public.repositories
  -- Canonical technology names: the primary language plus every topic the
  -- taxonomy recognised. Raw `topics` is kept alongside it, unchanged — one
  -- column is what GitHub said, the other is what we can match on.
  add column if not exists tech_tags text[] not null default '{}',
  -- GitHub search can exclude archived repositories, but a repository can be
  -- archived after we ingest it, and recommending somewhere that stopped
  -- accepting contributions is the single most useless thing this can do.
  add column if not exists archived boolean not null default false;

-- -----------------------------------------------------------------------------
-- Case-insensitive matching
--
-- `tech_stack` is user-editable. Someone who types "react" into the stack
-- editor means React, and an array overlap is case-sensitive — so the raw `&&`
-- prefilter silently matched nothing, however carefully the rest of the query
-- then compared case-insensitively.
--
-- Lowercasing inside the WHERE clause would fix it and throw away the index.
-- A stored generated column fixes it and keeps one: `tech_tags` holds the
-- canonical spelling to display, `tech_tags_lower` is what the index and the
-- overlap actually use.
-- -----------------------------------------------------------------------------

create or replace function public.lower_array(arr text[])
returns text[]
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select array(select lower(x) from unnest(arr) as x);
$$;

alter table public.repositories
  add column if not exists tech_tags_lower text[]
  generated always as (public.lower_array(tech_tags)) stored;

-- The whole match runs through this: `&&` for the overlap, GIN for the speed.
create index if not exists repositories_tech_tags_lower_idx
  on public.repositories using gin (tech_tags_lower);

-- -----------------------------------------------------------------------------
-- recommend_repositories
--
-- Returns repositories sharing at least `p_min_overlap` technologies with the
-- caller's stack, best match first.
--
-- Ordering is a deliberate cascade rather than a single blended score. Every
-- tier is one sentence a user can be told — "it matches three of your
-- technologies, it is in a language you said you want, and it has good first
-- issues" — which a weighted sum could not be. A score comes later, with the
-- embeddings that justify one.
-- -----------------------------------------------------------------------------

create or replace function public.recommend_repositories(
  p_tech_tags text[],
  p_min_overlap integer default 2,
  p_limit integer default 5,
  p_preferred_languages text[] default null,
  p_difficulty public.complexity_level default null,
  -- The developer's own GitHub login. Recommending someone their own project
  -- is the kind of mistake that costs trust in everything else on the page.
  p_exclude_owner text default null
)
returns table (
  id uuid,
  full_name text,
  description text,
  html_url text,
  primary_language text,
  topics text[],
  tech_tags text[],
  stars integer,
  open_issues_count integer,
  contribution_difficulty public.complexity_level,
  has_good_first_issues boolean,
  last_commit_at timestamptz,
  matched_tech text[],
  overlap integer
)
language sql
stable
set search_path = ''
as $$
  with candidates as (
    select
      r.*,
      -- Compared case-insensitively but returned in the repository's own
      -- spelling: tech_stack is user-editable, and someone who types "react"
      -- into the stack editor should still match, while the UI should still
      -- read "React".
      array(
        select t
        from unnest(r.tech_tags) as t
        where lower(t) in (select lower(u) from unnest(p_tech_tags) as u)
      ) as matched
    from public.repositories r
    where r.tech_tags_lower && public.lower_array(p_tech_tags)
      and not r.archived
      and (p_exclude_owner is null or lower(r.owner) <> lower(p_exclude_owner))
  )
  select
    c.id,
    c.full_name,
    c.description,
    c.html_url,
    c.primary_language,
    c.topics,
    c.tech_tags,
    c.stars,
    c.open_issues_count,
    c.contribution_difficulty,
    c.has_good_first_issues,
    c.last_commit_at,
    c.matched,
    cardinality(c.matched)
  from candidates c
  where cardinality(c.matched) >= p_min_overlap
  order by
    -- 1. How much of their stack this actually touches. The whole point.
    cardinality(c.matched) desc,
    -- 2. A language they said they want to work in.
    coalesce(c.primary_language = any(coalesce(p_preferred_languages, '{}')), false) desc,
    -- 3. Pitched at the difficulty they asked for.
    coalesce(c.contribution_difficulty = p_difficulty, false) desc,
    -- 4. Somewhere with a marked way in.
    c.has_good_first_issues desc,
    -- 5. Popularity last, as a tiebreak only. Leading with it would recommend
    --    the same five famous repositories to everybody.
    c.stars desc
  limit least(p_limit, 25);
$$;

grant execute on function public.lower_array(text[])
  to anon, authenticated, service_role;

grant execute on function public.recommend_repositories(
  text[], integer, integer, text[], public.complexity_level, text
) to anon, authenticated, service_role;
