#!/bin/bash
# =============================================================================
# Local-only database bootstrap (docker-compose).
#
# Hosted Supabase provides the `auth` schema, `auth.users`, and `auth.uid()`.
# A plain Postgres container does not, so this creates minimal stand-ins before
# applying the migrations. That keeps every file in supabase/migrations/ purely
# Supabase-native — nothing here is ever run against the hosted project.
#
# Runs once, on first boot of an empty data volume.
# =============================================================================
set -euo pipefail

echo "[bootstrap] creating local auth shim"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
  create schema if not exists auth;

  -- Supabase ships these roles; plain Postgres does not. Migrations that grant
  -- or revoke against them fail outright without these, so create them first.
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit bypassrls;
    end if;
  end
  $$;

  -- Stand-in for Supabase Auth's user table so FKs in the migrations resolve.
  -- raw_user_meta_data mirrors where Supabase puts the OAuth provider claims;
  -- public.handle_new_user() reads it, so the column has to exist locally too.
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  -- Supabase grants these roles blanket table privileges in public and leans on
  -- RLS to filter rows. Mirroring that locally is what makes a migration's
  -- `revoke` meaningful here — without it nothing is granted in the first place,
  -- every table looks locked down, and a missing policy would slip through.
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public
    grant select, insert, update, delete on tables to anon, authenticated, service_role;

  -- Stand-in for Supabase's auth.uid(). Reads the same GUC PostgREST sets, so
  -- RLS policies behave locally the way they do in production.
  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
EOSQL

echo "[bootstrap] applying supabase/migrations"

for migration in /migrations/*.sql; do
  [ -e "$migration" ] || continue
  echo "[bootstrap]   -> $(basename "$migration")"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$migration"
done

echo "[bootstrap] done"
