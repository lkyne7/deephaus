-- Saved study-window explanations, hints and follow-up threads: one row per
-- user per card, so reopening Explain or Hint is free and the phone can read
-- them offline. Rows are written by the /api/cards/[id]/explain routes under
-- the user's own session; clients only read them (PowerSync syncs them down).
-- Additive only: existing builds ignore the new table.

create table if not exists public.card_explanations (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Hash of the card's text when the explanation was written; a mismatch marks
  -- it stale instead of silently regenerating (and charging) again.
  content_hash text not null,
  explanation jsonb,
  -- Keyed by cloze ordinal ("0" for basic cards), each an array of up to 3 hints.
  hints jsonb not null default '{}'::jsonb,
  -- Follow-up messages, capped by the API.
  thread jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, user_id)
);

create index if not exists card_explanations_user_idx
  on public.card_explanations (user_id, updated_at desc);

alter table public.card_explanations enable row level security;

create policy "Users read own card explanations"
  on public.card_explanations
  for select
  using (auth.uid() = user_id);

create policy "Users create explanations for own cards"
  on public.card_explanations
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.cards c
      join public.generation_jobs j on j.id = c.job_id
      join public.sources s on s.id = j.source_id
      join public.projects p on p.id = s.project_id
      where c.id = card_explanations.card_id and p.user_id = auth.uid()
    )
  );

create policy "Users update explanations for own cards"
  on public.card_explanations
  for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.cards c
      join public.generation_jobs j on j.id = c.job_id
      join public.sources s on s.id = j.source_id
      join public.projects p on p.id = s.project_id
      where c.id = card_explanations.card_id and p.user_id = auth.uid()
    )
  );

-- RLS policies do not grant table access; see anki_export_job_explicit_grants.
grant select, insert, update on table public.card_explanations to authenticated;

create trigger prevent_deleted_account_writes
  before insert or update on public.card_explanations
  for each row execute function private.prevent_deleted_account_writes();

create trigger trg_card_explanations_updated_at
  before update on public.card_explanations
  for each row execute function public.touch_updated_at();

-- Sync to clients (read-only there). The publication is created by
-- powersync_offline_prep; guard so a database without it still migrates.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'powersync_role') then
    grant select on public.card_explanations to powersync_role;
  end if;
  if exists (select 1 from pg_publication where pubname = 'powersync')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = 'card_explanations'
    ) then
    alter publication powersync add table public.card_explanations;
  end if;
end
$$;
