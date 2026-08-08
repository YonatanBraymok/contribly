-- =============================================================================
-- Contribly — table privileges
--
-- Postgres checks GRANTs before it ever looks at row level security. A table
-- with policies but no grant is unreachable: PostgREST returns 42501,
-- "permission denied", and the policies never get a say.
--
-- Supabase projects normally hand out these grants through ALTER DEFAULT
-- PRIVILEGES, so tables created in `public` pick them up for free. That is not
-- true everywhere — newer projects tighten it — and depending on it means the
-- schema does not describe its own access rules. Everything is spelled out
-- here instead, which also makes the intended model reviewable in one place.
--
-- The split, in short:
--   service_role   full access; bypasses RLS. The API and workers use this.
--   authenticated  granted, then filtered by the policies in the init migration.
--   anon           read-only on the public corpus, nothing else.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- users — private to their owner
--
-- Policies cover select, insert and update for the owning user; there is
-- deliberately no delete policy, and no delete grant to match. Removing an
-- account happens through auth.users, which cascades.
-- -----------------------------------------------------------------------------

grant select, insert, update on public.users to authenticated;
grant select, insert, update, delete on public.users to service_role;

-- Never readable by signed-out visitors, whatever the policies say.
revoke all on public.users from anon;

-- -----------------------------------------------------------------------------
-- repositories / issues — the public corpus
--
-- Readable by everyone, per the policies in the init migration. Writes are the
-- ingestion worker's job and go through the service role.
-- -----------------------------------------------------------------------------

grant select on public.repositories to anon, authenticated;
grant select on public.issues to anon, authenticated;

grant select, insert, update, delete on public.repositories to service_role;
grant select, insert, update, delete on public.issues to service_role;

-- -----------------------------------------------------------------------------
-- Search RPCs
--
-- These are security invoker, so the caller's own grants above still decide
-- which rows come back. Execute is granted to PUBLIC by default; stating it
-- keeps the function usable if that default is ever revoked project-wide.
-- -----------------------------------------------------------------------------

grant execute on function public.match_repositories(
  extensions.vector, double precision, integer, text[]
) to anon, authenticated, service_role;

grant execute on function public.match_issues(
  extensions.vector, double precision, integer, boolean
) to anon, authenticated, service_role;
