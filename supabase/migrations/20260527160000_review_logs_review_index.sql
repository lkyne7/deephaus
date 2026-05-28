-- Speed up dashboard streak / heatmap / fsrs_log_count queries.
--
-- The existing idx_review_logs_user_created indexes on `created_at`, but the
-- streak query (apps/web/src/lib/fsrs/stats.ts) orders by `review`, and the
-- heatmap RPC filters by `review`. Without this index Postgres falls back to
-- a sequential scan + sort over the user's review_logs.

create index if not exists idx_review_logs_user_review
  on public.review_logs (user_id, review desc);
