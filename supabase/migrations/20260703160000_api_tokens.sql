-- Personal access tokens for MCP and other external API clients.
-- Secrets are stored as SHA-256 hashes; only the token prefix is shown in the UI.

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  scopes text[] not null default array['study']::text[],
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_api_tokens_user_id on public.api_tokens(user_id);
create index if not exists idx_api_tokens_hash_active
  on public.api_tokens(token_hash)
  where revoked_at is null;

alter table public.api_tokens enable row level security;

-- Server-only table (same pattern as notion_connections).
-- Clients manage tokens via /api/tokens using session auth + service role.
