-- Offline uploads write review logs directly through the Data API. Ensure a
-- user cannot attach a synthetic review to another user's card and inflate
-- leaderboard or retention metrics.

drop policy if exists "Users manage own review logs" on public.review_logs;

create policy "Users manage own review logs"
  on public.review_logs for all
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.cards c
      join public.generation_jobs j on j.id = c.job_id
      join public.sources s on s.id = j.source_id
      join public.projects p on p.id = s.project_id
      where c.id = review_logs.card_id and p.user_id = auth.uid()
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
      where c.id = review_logs.card_id and p.user_id = auth.uid()
    )
  );

-- Trigger functions are internal implementation details, not public RPCs.
revoke execute on function public.invalidate_source_chunks()
  from public, anon, authenticated;

-- Pin the new generic trigger function to trusted built-in names.
alter function public.touch_updated_at() set search_path = pg_catalog;
