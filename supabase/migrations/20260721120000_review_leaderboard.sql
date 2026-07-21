-- Cross-user review leaderboard. Aggregates review_logs across all users and
-- joins auth.users for display metadata, so it must run with elevated rights.
-- Execution is restricted to the service role; the API layer strips emails
-- before anything reaches the client.

create or replace function public.get_review_leaderboard(
  period_start timestamptz default null,
  max_rows integer default 25,
  include_user_id uuid default null
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  review_count bigint,
  rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with counts as (
    select rl.user_id, count(*)::bigint as review_count
    from public.review_logs rl
    where period_start is null or rl.review >= period_start
    group by rl.user_id
  ),
  ranked as (
    select c.user_id,
           c.review_count,
           rank() over (order by c.review_count desc) as rank
    from counts c
  ),
  picked as (
    (select r.user_id, r.review_count, r.rank
     from ranked r
     order by r.rank, r.user_id
     limit greatest(max_rows, 1))
    union
    select r.user_id, r.review_count, r.rank
    from ranked r
    where include_user_id is not null and r.user_id = include_user_id
  )
  select p.user_id,
         coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') as full_name,
         u.email::text as email,
         p.review_count,
         p.rank
  from picked p
  join auth.users u on u.id = p.user_id
  order by p.rank, p.user_id;
$$;

revoke execute on function public.get_review_leaderboard(timestamptz, integer, uuid)
  from anon, authenticated, public;
