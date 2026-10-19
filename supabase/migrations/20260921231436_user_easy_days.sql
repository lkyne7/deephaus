-- Personal weekly preferences, Monday first. Existing RLS remains in force.
alter table public.user_study_settings
  add column easy_days jsonb not null default '["normal","normal","normal","normal","normal","normal","normal"]'::jsonb
  constraint user_study_settings_easy_days_check check (
    jsonb_typeof(easy_days) = 'array'
    and jsonb_array_length(easy_days) = 7
    and easy_days <@ '["minimum","reduced","normal"]'::jsonb
    and easy_days @> '["normal"]'::jsonb
  );
comment on column public.user_study_settings.easy_days is
  'Monday-first review load preferences. Applies to future regular reviews across all decks.';
