-- Per-user FSRS parameters fitted from the user's own review history. Until
-- enough reviews exist (or the user has run the optimizer), the scheduler
-- falls back to ts-fsrs's built-in defaults.

create table if not exists public.user_fsrs_params (
  user_id uuid primary key references auth.users(id) on delete cascade,
  params double precision[] not null,
  log_count integer not null default 0,
  optimized_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_fsrs_params enable row level security;

create policy "Users read own fsrs params"
  on public.user_fsrs_params for select
  using (auth.uid() = user_id);

create policy "Users upsert own fsrs params"
  on public.user_fsrs_params for insert
  with check (auth.uid() = user_id);

create policy "Users update own fsrs params"
  on public.user_fsrs_params for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own fsrs params"
  on public.user_fsrs_params for delete
  using (auth.uid() = user_id);

create or replace function public.touch_user_fsrs_params_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_fsrs_params_updated_at on public.user_fsrs_params;
create trigger trg_user_fsrs_params_updated_at
  before update on public.user_fsrs_params
  for each row execute function public.touch_user_fsrs_params_updated_at();
