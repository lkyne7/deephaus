-- API token hardening: optional expiry + real scopes.
-- Scopes: 'study' (read/queue/review/stats) and 'write' (create/update/delete).
-- Existing tokens predate scope enforcement and were used for both, so they
-- are backfilled with both scopes to avoid breaking working connections.

alter table public.api_tokens
  add column if not exists expires_at timestamptz;

update public.api_tokens
  set scopes = array['study', 'write']::text[]
  where not ('write' = any(scopes));

alter table public.api_tokens
  alter column scopes set default array['study', 'write']::text[];

create index if not exists idx_api_tokens_expires_at
  on public.api_tokens(expires_at)
  where expires_at is not null;
