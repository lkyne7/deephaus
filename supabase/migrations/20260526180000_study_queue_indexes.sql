-- Study queue: speed up deck-scoped review lookups and due filtering.

create index if not exists idx_card_reviews_user_due_state
  on public.card_reviews(user_id, due, state)
  where suspended = false;

create index if not exists idx_cards_job_sort
  on public.cards(job_id, sort_order);
