-- Cover the remaining Cram foreign keys flagged by Supabase's performance advisor.

create index if not exists idx_cram_plan_deck_profiles_project
  on public.cram_plan_deck_profiles(project_id);

create index if not exists idx_cram_plan_items_project
  on public.cram_plan_items(project_id);

create index if not exists idx_cram_review_logs_user
  on public.cram_review_logs(user_id);

create index if not exists idx_cram_review_logs_card
  on public.cram_review_logs(card_id);
