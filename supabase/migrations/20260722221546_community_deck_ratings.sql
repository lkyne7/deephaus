-- Community deck 5-star ratings: one rating per user per publication,
-- with denormalized averages on deck_publications for list/card display.

alter table public.deck_publications
  add column if not exists avg_rating numeric(3, 2) not null default 0,
  add column if not exists rating_count integer not null default 0;

alter table public.deck_publications
  drop constraint if exists deck_publications_avg_rating_check;

alter table public.deck_publications
  add constraint deck_publications_avg_rating_check
  check (avg_rating >= 0 and avg_rating <= 5);

alter table public.deck_publications
  drop constraint if exists deck_publications_rating_count_check;

alter table public.deck_publications
  add constraint deck_publications_rating_count_check
  check (rating_count >= 0);

create table if not exists public.publication_ratings (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.deck_publications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publication_id, user_id)
);

create index if not exists idx_publication_ratings_publication
  on public.publication_ratings(publication_id);

create index if not exists idx_publication_ratings_user
  on public.publication_ratings(user_id);

alter table public.publication_ratings enable row level security;

create policy "Authenticated users read publication ratings"
  on public.publication_ratings for select
  using (auth.uid() is not null);

create policy "Users insert own ratings"
  on public.publication_ratings for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.deck_publications dp
      where dp.id = publication_id
        and dp.publisher_id <> auth.uid()
    )
  );

create policy "Users update own ratings"
  on public.publication_ratings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own ratings"
  on public.publication_ratings for delete
  using (auth.uid() = user_id);

create or replace function public.sync_publication_rating_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  next_avg numeric(3, 2);
  next_count integer;
begin
  target_id := coalesce(NEW.publication_id, OLD.publication_id);

  select
    coalesce(round(avg(stars)::numeric, 2), 0),
    count(*)::integer
  into next_avg, next_count
  from public.publication_ratings
  where publication_id = target_id;

  update public.deck_publications
  set avg_rating = next_avg,
      rating_count = next_count,
      updated_at = now()
  where id = target_id;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

drop trigger if exists publication_ratings_stats_insert on public.publication_ratings;
create trigger publication_ratings_stats_insert
  after insert on public.publication_ratings
  for each row execute function public.sync_publication_rating_stats();

drop trigger if exists publication_ratings_stats_update on public.publication_ratings;
create trigger publication_ratings_stats_update
  after update of stars on public.publication_ratings
  for each row execute function public.sync_publication_rating_stats();

drop trigger if exists publication_ratings_stats_delete on public.publication_ratings;
create trigger publication_ratings_stats_delete
  after delete on public.publication_ratings
  for each row execute function public.sync_publication_rating_stats();
