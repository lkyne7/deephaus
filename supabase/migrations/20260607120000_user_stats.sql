-- Maintained per-user counters so dashboard stats avoid scanning all review_logs.

create table if not exists public.user_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  review_log_count bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.user_stats enable row level security;

drop policy if exists "Users read own stats" on public.user_stats;

create policy "Users read own stats"
  on public.user_stats for select
  using (auth.uid() = user_id);

-- Backfill from existing history (one-time).
insert into public.user_stats (user_id, review_log_count)
select user_id, count(*)::bigint
from public.review_logs
group by user_id
on conflict (user_id) do update
  set review_log_count = excluded.review_log_count,
      updated_at = now();

create or replace function public.sync_user_review_log_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.user_stats (user_id, review_log_count)
    values (NEW.user_id, 1)
    on conflict (user_id) do update
      set review_log_count = public.user_stats.review_log_count + 1,
          updated_at = now();
    return NEW;
  elsif TG_OP = 'DELETE' then
    update public.user_stats
    set review_log_count = greatest(0, review_log_count - 1),
        updated_at = now()
    where user_id = OLD.user_id;
    return OLD;
  end if;
  return null;
end;
$$;

drop trigger if exists review_logs_user_stats_count on public.review_logs;

create trigger review_logs_user_stats_count
  after insert or delete on public.review_logs
  for each row
  execute function public.sync_user_review_log_count();

-- Trigger functions fire as the table owner regardless of grants; this one is
-- SECURITY DEFINER, so keep it off the public PostgREST RPC surface.
revoke execute on function public.sync_user_review_log_count() from anon, authenticated, public;
