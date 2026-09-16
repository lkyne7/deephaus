-- Trigger functions are invoked by their owning triggers, never by API clients.
revoke execute on function public.sources_set_user_id() from public, anon, authenticated;
revoke execute on function public.sync_publication_rating_stats() from public, anon, authenticated;
revoke execute on function public.sync_publication_subscriber_count() from public, anon, authenticated;

-- These timestamp triggers use only built-in functions. Pin resolution even
-- when invoked from a session with a user-controlled search path.
alter function public.touch_card_reviews_updated_at() set search_path = pg_catalog;
alter function public.touch_user_fsrs_params_updated_at() set search_path = pg_catalog;
alter function public.touch_user_study_settings_updated_at() set search_path = pg_catalog;
