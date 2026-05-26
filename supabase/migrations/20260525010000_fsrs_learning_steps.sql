-- ts-fsrs >= 5.x added the `learning_steps` field to Card. Persist it so
-- learning-step progression is preserved across review sessions.
alter table public.card_reviews
  add column if not exists learning_steps integer not null default 0;
