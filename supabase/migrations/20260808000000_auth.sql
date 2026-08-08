-- =============================================================================
-- Contribly — authentication
--
-- Sign-in is strictly GitHub OAuth via Supabase Auth. This migration covers the
-- two pieces that have to live in the database:
--
--   1. A profile row in public.users for every auth.users row, created by
--      trigger so it cannot be missed if the app-side callback fails.
--   2. Somewhere to keep the GitHub access token, reachable only by the
--      service role, so the profile-sync worker can call GitHub as the user.
--
-- Disabling every other sign-in method is a project setting, not SQL: in the
-- Supabase dashboard turn off Email under Authentication → Sign In / Providers
-- and leave GitHub as the only enabled provider.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Profile creation
--
-- Supabase writes the GitHub OAuth claims into auth.users.raw_user_meta_data.
-- For the GitHub provider that object carries `user_name`, `avatar_url` and
-- `provider_id` (the numeric GitHub account id, as a string).
--
-- security definer so the trigger can write to public.users regardless of which
-- role inserted into auth.users; the empty search_path forces every reference
-- below to be schema-qualified, which is what makes that safe.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, github_username, github_id, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'user_name',
      new.raw_user_meta_data ->> 'preferred_username'
    ),
    nullif(new.raw_user_meta_data ->> 'provider_id', '')::bigint,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- github_credentials
--
-- Supabase hands back the GitHub access token (`provider_token`) exactly once,
-- on the response to the initial code exchange — it is not part of the stored
-- session and is never refreshed. The auth callback forwards it here so that
-- later profile syncs get GitHub's authenticated rate limit (5,000 req/hour)
-- instead of the anonymous one (60 req/hour, shared per IP).
--
-- Split out of public.users deliberately: users may read and update their own
-- profile row, and a token must never be readable by the browser.
-- -----------------------------------------------------------------------------

create table if not exists public.github_credentials (
  user_id uuid primary key references public.users (id) on delete cascade,

  access_token text not null,
  -- Scopes we requested at sign-in. GitHub may grant fewer; reading the real
  -- set means checking the X-OAuth-Scopes header on a live API call, which the
  -- profile-sync worker is better placed to do than the auth callback.
  scopes text[] not null default '{}',

  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists github_credentials_set_updated_at on public.github_credentials;
create trigger github_credentials_set_updated_at
  before update on public.github_credentials
  for each row execute function public.set_updated_at();

-- RLS on with no policies at all. Under Postgres RLS that denies every row to
-- anon and authenticated; the service role bypasses RLS, so the API can still
-- read and write. The absence of policies below is deliberate — do not add one.
alter table public.github_credentials enable row level security;

-- Belt and braces: even without RLS these roles hold no privileges here.
revoke all on public.github_credentials from anon, authenticated;

-- Stated rather than inherited. Supabase's default privileges would grant this
-- anyway, but spelling it out makes the access model readable from the schema:
-- the service role, and nothing else, reaches this table.
grant select, insert, update, delete on public.github_credentials to service_role;
