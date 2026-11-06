-- Create page: stopping a generation run, and saving each deck's conversation.
-- Additive only: existing builds ignore the new column and table.

-- A stop request is a timestamp, not a job status, so generation_jobs keeps the
-- statuses offline clients know. The job stays non-terminal until its processor
-- has settled credits, which also leaves stale-job recovery working unchanged.
alter table public.generation_jobs
  add column if not exists cancel_requested_at timestamptz;

create table if not exists public.deck_conversations (
  project_id uuid primary key references public.projects(id) on delete cascade,
  conversation jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.deck_conversations enable row level security;

create policy "Users manage conversations for own decks"
  on public.deck_conversations for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = deck_conversations.project_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = deck_conversations.project_id and p.user_id = (select auth.uid())
    )
  );

-- RLS policies do not grant table access; see anki_export_job_explicit_grants.
grant select, insert, update on table public.deck_conversations to authenticated;
