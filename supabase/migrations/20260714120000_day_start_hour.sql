-- Anki-style "next day starts at" rollover for study scheduling. Reviews done
-- before this hour count toward the previous study day. The timezone column
-- lets the server compute the rollover boundary in the user's local time.

alter table public.user_study_settings
  add column if not exists day_start_hour integer not null default 4
    check (day_start_hour >= 0 and day_start_hour <= 23),
  add column if not exists timezone text;
