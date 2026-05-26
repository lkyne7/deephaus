-- FSRS (Free Spaced Repetition Scheduler) review state, per (card, user).
-- Mirrors the fields of ts-fsrs's Card struct so we can hydrate / serialize
-- without translation.

create table if not exists public.card_reviews (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  due timestamptz not null default now(),
  stability double precision not null default 0,
  difficulty double precision not null default 0,
  elapsed_days double precision not null default 0,
  scheduled_days double precision not null default 0,
  reps integer not null default 0,
  lapses integer not null default 0,
  -- ts-fsrs State enum: 0=New, 1=Learning, 2=Review, 3=Relearning
  state smallint not null default 0 check (state between 0 and 3),
  last_review timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, user_id)
);

-- Append-only audit log of every grade, for history & future FSRS optimization.
create table if not exists public.review_logs (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- ts-fsrs Rating: 1=Again, 2=Hard, 3=Good, 4=Easy
  rating smallint not null check (rating between 1 and 4),
  state smallint not null check (state between 0 and 3),
  due timestamptz not null,
  stability double precision not null,
  difficulty double precision not null,
  elapsed_days double precision not null,
  last_elapsed_days double precision not null,
  scheduled_days double precision not null,
  review timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_card_reviews_user_due
  on public.card_reviews(user_id, due);
create index if not exists idx_card_reviews_card_user
  on public.card_reviews(card_id, user_id);
create index if not exists idx_review_logs_user_created
  on public.review_logs(user_id, created_at desc);
create index if not exists idx_review_logs_card_user
  on public.review_logs(card_id, user_id);

alter table public.card_reviews enable row level security;
alter table public.review_logs enable row level security;

-- The user must (a) own this row and (b) own the deck the card belongs to.
create policy "Users manage own card reviews"
  on public.card_reviews for all
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.cards c
      join public.generation_jobs j on j.id = c.job_id
      join public.sources s on s.id = j.source_id
      join public.projects p on p.id = s.project_id
      where c.id = card_reviews.card_id and p.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.cards c
      join public.generation_jobs j on j.id = c.job_id
      join public.sources s on s.id = j.source_id
      join public.projects p on p.id = s.project_id
      where c.id = card_reviews.card_id and p.user_id = auth.uid()
    )
  );

create policy "Users manage own review logs"
  on public.review_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at fresh on card_reviews rewrites.
create or replace function public.touch_card_reviews_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_card_reviews_updated_at on public.card_reviews;
create trigger trg_card_reviews_updated_at
  before update on public.card_reviews
  for each row execute function public.touch_card_reviews_updated_at();
