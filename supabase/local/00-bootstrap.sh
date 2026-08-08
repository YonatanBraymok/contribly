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

  -- Stand-in for Supabase Auth's user table so FKs in the migrations resolve.
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    created_at timestamptz not null default now()
  );

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
