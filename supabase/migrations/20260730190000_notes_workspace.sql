-- Notes workspace: standalone, nestable notes.
--
-- Sources gain direct user ownership so notes can exist without a deck,
-- plus Notion-style organization fields (nesting, ordering, icon, favorite).

alter table public.sources
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.sources
  add column if not exists parent_id uuid references public.sources(id) on delete set null;
alter table public.sources
  add column if not exists position double precision not null default 0;
alter table public.sources
  add column if not exists icon text;
alter table public.sources
  add column if not exists is_favorite boolean not null default false;

-- Backfill ownership from the owning deck.
update public.sources s
set user_id = p.user_id
from public.projects p
where p.id = s.project_id
  and s.user_id is null;

-- Keep user_id populated for insert paths that only provide project_id.
create or replace function public.sources_set_user_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null and new.project_id is not null then
    select p.user_id into new.user_id
    from public.projects p
    where p.id = new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sources_set_user_id on public.sources;
create trigger sources_set_user_id
  before insert on public.sources
  for each row execute function public.sources_set_user_id();

alter table public.sources alter column user_id set not null;
alter table public.sources alter column project_id drop not null;

create index if not exists idx_sources_user_id on public.sources(user_id);
create index if not exists idx_sources_parent_id on public.sources(parent_id);

-- Ownership is now direct; the project join no longer covers deckless notes.
drop policy if exists "Users manage sources via project" on public.sources;
drop policy if exists "Users manage own sources" on public.sources;
create policy "Users manage own sources"
  on public.sources for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
