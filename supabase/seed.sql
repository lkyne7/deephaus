-- Local development grants.
--
-- The schema migrations enable row-level security and create per-user policies
-- but rely on Supabase's historical behavior of auto-granting table privileges
-- to the `anon` / `authenticated` / `service_role` roles. Recent Supabase CLI
-- versions create a more restrictive default ACL for `postgres`-owned tables in
-- the `public` schema (only TRUNCATE/REFERENCES/TRIGGER), which leaves the API
-- unable to read or write its own tables ("permission denied for table ...").
--
-- This seed restores the standard privileges so the local stack matches the
-- hosted project. RLS policies (defined in the migrations) remain the security
-- boundary. The seed only runs locally via the Supabase CLI; it never touches a
-- hosted/production database.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- Ensure tables created by future migrations inherit the same privileges.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on routines to anon, authenticated, service_role;
