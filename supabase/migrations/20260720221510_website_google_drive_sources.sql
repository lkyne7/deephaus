-- Website and Google Drive source support.
--
-- Google OAuth credentials are server-only. RLS is deliberately enabled with
-- no policies, so only the service role can read or mutate connection rows.
create table if not exists public.google_drive_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  account_email text,
  account_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_drive_connections enable row level security;

-- External canonical URL is separate from storage_path. Drive imports keep an
-- exported extraction artifact in private storage while linking back to Drive.
alter table public.sources
  add column if not exists external_url text;

alter table public.sources drop constraint if exists sources_type_check;
alter table public.sources add constraint sources_type_check
  check (
    type in (
      'text',
      'pdf',
      'docx',
      'pptx',
      'xlsx',
      'video',
      'youtube',
      'apkg',
      'topic',
      'notion',
      'website'
    )
  );
