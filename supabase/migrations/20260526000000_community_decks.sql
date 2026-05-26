-- Community deck sharing: publish decks, subscribe with follow or fork sync.

create table if not exists public.deck_publications (
  id uuid primary key default gen_random_uuid(),
  publisher_id uuid not null references auth.users(id) on delete cascade,
  source_project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  version integer not null default 1,
  card_count integer not null default 0,
  subscriber_count integer not null default 0,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_project_id)
);

create table if not exists public.publication_cards (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.deck_publications(id) on delete cascade,
  type text not null check (type in ('basic', 'cloze')),
  front text,
  back text,
  cloze_text text,
  extra text,
  tags text[] not null default '{}',
  sort_order integer not null default 0
);

create table if not exists public.deck_subscriptions (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.deck_publications(id) on delete cascade,
  subscriber_id uuid not null references auth.users(id) on delete cascade,
  sync_mode text not null check (sync_mode in ('follow', 'fork')),
  local_project_id uuid not null references public.projects(id) on delete cascade,
  publication_version integer not null default 1,
  subscribed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publication_id, subscriber_id)
);

create index if not exists idx_deck_publications_publisher on public.deck_publications(publisher_id);
create index if not exists idx_deck_publications_title on public.deck_publications(title);
create index if not exists idx_publication_cards_publication on public.publication_cards(publication_id);
create index if not exists idx_deck_subscriptions_subscriber on public.deck_subscriptions(subscriber_id);
create index if not exists idx_deck_subscriptions_publication on public.deck_subscriptions(publication_id);
create index if not exists idx_deck_subscriptions_local_project on public.deck_subscriptions(local_project_id);

alter table public.deck_publications enable row level security;
alter table public.publication_cards enable row level security;
alter table public.deck_subscriptions enable row level security;

-- Anyone signed in can browse published decks.
create policy "Authenticated users read publications"
  on public.deck_publications for select
  using (auth.uid() is not null);

create policy "Publishers manage own publications"
  on public.deck_publications for insert
  with check (
    auth.uid() = publisher_id
    and exists (
      select 1 from public.projects p
      where p.id = source_project_id and p.user_id = auth.uid()
    )
  );

create policy "Publishers update own publications"
  on public.deck_publications for update
  using (auth.uid() = publisher_id)
  with check (auth.uid() = publisher_id);

create policy "Publishers delete own publications"
  on public.deck_publications for delete
  using (auth.uid() = publisher_id);

create policy "Authenticated users read publication cards"
  on public.publication_cards for select
  using (auth.uid() is not null);

create policy "Publishers manage publication cards"
  on public.publication_cards for all
  using (
    exists (
      select 1 from public.deck_publications dp
      where dp.id = publication_cards.publication_id and dp.publisher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.deck_publications dp
      where dp.id = publication_cards.publication_id and dp.publisher_id = auth.uid()
    )
  );

create policy "Subscribers read own subscriptions"
  on public.deck_subscriptions for select
  using (auth.uid() = subscriber_id);

create policy "Subscribers manage own subscriptions"
  on public.deck_subscriptions for insert
  with check (auth.uid() = subscriber_id);

create policy "Subscribers update own subscriptions"
  on public.deck_subscriptions for update
  using (auth.uid() = subscriber_id)
  with check (auth.uid() = subscriber_id);

create policy "Subscribers delete own subscriptions"
  on public.deck_subscriptions for delete
  using (auth.uid() = subscriber_id);

create or replace function public.sync_publication_subscriber_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    update public.deck_publications
    set subscriber_count = subscriber_count + 1,
        updated_at = now()
    where id = NEW.publication_id;
    return NEW;
  elsif TG_OP = 'DELETE' then
    update public.deck_publications
    set subscriber_count = greatest(subscriber_count - 1, 0),
        updated_at = now()
    where id = OLD.publication_id;
    return OLD;
  end if;
  return null;
end;
$$;

create trigger deck_subscriptions_count_insert
  after insert on public.deck_subscriptions
  for each row execute function public.sync_publication_subscriber_count();

create trigger deck_subscriptions_count_delete
  after delete on public.deck_subscriptions
  for each row execute function public.sync_publication_subscriber_count();
