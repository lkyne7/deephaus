-- Notion integration: per-user OAuth connections, a "notion" source type,
-- and a display title on sources for the Notes library.

-- Per-user Notion OAuth connection. Tokens are server-only: RLS is enabled
-- with no policies, so only the service role can read/write rows. Clients
-- learn about connection state via /api/notion/status.
create table if not exists public.notion_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  bot_id text,
  workspace_id text,
  workspace_name text,
  workspace_icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notion_connections enable row level security;

-- Allow Notion pages as a source type.
alter table public.sources drop constraint if exists sources_type_check;
alter table public.sources add constraint sources_type_check
  check (type in ('text', 'pdf', 'docx', 'pptx', 'video', 'youtube', 'apkg', 'topic', 'notion'));

-- Human-readable source title for the Notes library.
alter table public.sources add column if not exists title text;

-- Backfill titles for uploaded files from the stored filename
-- (storage_path format: {userId}/{projectId}/{timestamp}-{filename}).
update public.sources
set title = nullif(regexp_replace(regexp_replace(storage_path, '^.*/', ''), '^\d+-', ''), '')
where title is null
  and storage_path is not null
  and type in ('pdf', 'docx', 'pptx', 'video');
