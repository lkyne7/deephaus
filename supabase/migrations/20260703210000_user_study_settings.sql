-- Global FSRS / study defaults applied to new decks and decks that opt in
-- via projects.settings.useGlobalFsrsSettings.

create table if not exists public.user_study_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  desired_retention double precision not null default 0.9
    check (desired_retention >= 0.7 and desired_retention <= 0.97),
  new_cards_per_day integer not null default 10
    check (new_cards_per_day >= 0 and new_cards_per_day <= 200),
  updated_at timestamptz not null default now()
);

alter table public.user_study_settings enable row level security;

create policy "Users read own study settings"
  on public.user_study_settings for select
  using (auth.uid() = user_id);

create policy "Users insert own study settings"
  on public.user_study_settings for insert
  with check (auth.uid() = user_id);

create policy "Users update own study settings"
  on public.user_study_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own study settings"
  on public.user_study_settings for delete
  using (auth.uid() = user_id);

create or replace function public.touch_user_study_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_study_settings_updated_at on public.user_study_settings;
create trigger trg_user_study_settings_updated_at
  before update on public.user_study_settings
  for each row execute function public.touch_user_study_settings_updated_at();
