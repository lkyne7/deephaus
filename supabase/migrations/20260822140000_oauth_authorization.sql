-- OAuth 2.1 authorization server storage for the hosted MCP endpoint.
-- Access tokens are minted into api_tokens (kind='oauth') so the existing
-- PAT verification path (hashing, Pro gate, scopes, expiry, rate limit)
-- applies unchanged. All tables are server-only: RLS enabled, no policies —
-- same pattern as api_tokens.

-- Dynamically registered OAuth clients (RFC 7591). CIMD clients (URL
-- client_ids) are validated live against their metadata document and are
-- not stored here.
create table if not exists public.oauth_clients (
  client_id uuid primary key default gen_random_uuid(),
  client_name text not null,
  redirect_uris text[] not null,
  logo_uri text,
  created_at timestamptz not null default now()
);

-- Single-use authorization codes (stored hashed, ~60s TTL).
create table if not exists public.oauth_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  client_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  scopes text[] not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_oauth_codes_expires_at on public.oauth_codes(expires_at);

-- Rotating refresh tokens (stored hashed). api_token_id points at the
-- currently valid access-token row; rotation revokes both and issues a
-- fresh pair.
create table if not exists public.oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  client_name text not null,
  scopes text[] not null,
  api_token_id uuid references public.api_tokens(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_oauth_refresh_tokens_user_id on public.oauth_refresh_tokens(user_id);

-- Distinguish OAuth-minted access tokens from manually created PATs.
alter table public.api_tokens
  add column if not exists kind text not null default 'pat'
    check (kind in ('pat', 'oauth'));

alter table public.api_tokens
  add column if not exists client_id text;

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_refresh_tokens enable row level security;
