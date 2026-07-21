drop function if exists public.get_review_leaderboard(timestamptz, integer, uuid);

create function public.get_review_leaderboard(
  period_start timestamptz default null,
  max_rows integer default 25,
  include_user_id uuid default null
)
returns table (
  user_id uuid,
  username text,
  review_count bigint,
  rank bigint
)
language sql
stable
security definer
set search_path = ''
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
         up.username,
         p.review_count,
         p.rank
  from picked p
  join public.user_profiles up on up.user_id = p.user_id
  order by p.rank, p.user_id;
$$;

revoke execute on function public.get_review_leaderboard(timestamptz, integer, uuid)
  from anon, authenticated, public;
