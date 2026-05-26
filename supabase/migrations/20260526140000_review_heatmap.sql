-- Daily review counts for dashboard heatmap.

create or replace function public.review_counts_by_day(
  p_user_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns table (day date, count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select (review at time zone 'UTC')::date as day, count(*)::bigint
  from public.review_logs
  where user_id = p_user_id
    and review >= p_start
    and review <= p_end
  group by 1
  order by 1;
$$;

grant execute on function public.review_counts_by_day(uuid, timestamptz, timestamptz) to authenticated;
