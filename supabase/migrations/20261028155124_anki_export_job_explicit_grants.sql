-- RLS policies do not grant table access. Make the existing export-job API
-- independent of Supabase's legacy automatic grants for new public tables.
-- Enqueue uses INSERT ... RETURNING; polling/download and stale-job recovery
-- use SELECT/UPDATE with the existing per-user RLS policies.
grant select, insert, update on table public.anki_export_jobs to authenticated;

-- Inline exports and the worker update progress/results and read expired jobs.
-- Claiming stays behind the existing service-role-only claim_anki_export_job RPC.
grant select, update on table public.anki_export_jobs to service_role;

-- Deliberately additive: no anonymous access, DELETE, blanket/default grants,
-- or changes to policies, RPC permissions, storage, or existing project grants.
