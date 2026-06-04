-- Batched queue stats for dashboard + study hub (avoids loading every card/review in Node).

create or replace function public.get_study_deck_summaries(
  p_user_id uuid,
  p_now timestamptz,
  p_start_of_day timestamptz
)
returns table (
  project_id uuid,
  card_count bigint,
  due_count bigint,
  new_card_count bigint,
  new_studied_today bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with user_projects as (
    select id from public.projects where user_id = p_user_id
  ),
  deck_cards as (
    select s.project_id, c.id as card_id
    from public.cards c
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    where s.project_id in (select id from user_projects)
  ),
  card_counts as (
    select project_id, count(*)::bigint as card_count
    from deck_cards
    group by project_id
  ),
  due_counts as (
    select s.project_id, count(*)::bigint as due_count
    from public.card_reviews cr
    inner join public.cards c on c.id = cr.card_id
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    where cr.user_id = p_user_id
      and cr.suspended = false
      and cr.state <> 0
      and cr.due <= p_now
    group by s.project_id
  ),
  new_cards as (
    select dc.project_id, count(*)::bigint as new_card_count
    from deck_cards dc
    left join public.card_reviews cr on cr.card_id = dc.card_id and cr.user_id = p_user_id
    where cr.card_id is null or cr.state = 0
    group by dc.project_id
  ),
  new_today as (
    select s.project_id, count(*)::bigint as new_studied_today
    from public.review_logs rl
    inner join public.cards c on c.id = rl.card_id
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    where rl.user_id = p_user_id
      and rl.state = 0
      and rl.review >= p_start_of_day
    group by s.project_id
  )
  select
    up.id as project_id,
    coalesce(cc.card_count, 0) as card_count,
    coalesce(dc.due_count, 0) as due_count,
    coalesce(nc.new_card_count, 0) as new_card_count,
    coalesce(nt.new_studied_today, 0) as new_studied_today
  from user_projects up
  inner join card_counts cc on cc.project_id = up.id
  left join due_counts dc on dc.project_id = up.id
  left join new_cards nc on nc.project_id = up.id
  left join new_today nt on nt.project_id = up.id;
$$;

create or replace function public.get_dashboard_queue_snapshot(
  p_user_id uuid,
  p_now timestamptz,
  p_start_of_day timestamptz
)
returns table (
  project_id uuid,
  card_count bigint,
  due_count bigint,
  new_card_count bigint,
  new_studied_today bigint,
  state_new bigint,
  state_learning bigint,
  state_review bigint,
  state_relearning bigint,
  last_review timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with user_projects as (
    select id, name, deck_name, settings
    from public.projects
    where user_id = p_user_id
  ),
  deck_cards as (
    select s.project_id, c.id as card_id
    from public.cards c
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    where s.project_id in (select id from user_projects)
  ),
  primary_review as (
    select distinct on (dc.card_id)
      dc.project_id,
      dc.card_id,
      cr.state,
      coalesce(cr.suspended, false) as suspended,
      cr.due
    from deck_cards dc
    left join public.card_reviews cr on cr.card_id = dc.card_id and cr.user_id = p_user_id
    order by dc.card_id, cr.cloze_ord asc nulls first
  ),
  active_cards as (
    select *
    from primary_review
    where suspended = false
  ),
  per_deck as (
    select
      project_id,
      count(*)::bigint as card_count,
      count(*) filter (where coalesce(state, 0) = 0)::bigint as state_new,
      count(*) filter (where state = 1)::bigint as state_learning,
      count(*) filter (where state = 2)::bigint as state_review,
      count(*) filter (where state = 3)::bigint as state_relearning,
      count(*) filter (
        where coalesce(state, 0) <> 0 and due is not null and due <= p_now
      )::bigint as due_count,
      count(*) filter (where coalesce(state, 0) = 0)::bigint as new_card_count
    from active_cards
    group by project_id
  ),
  new_today as (
    select s.project_id, count(*)::bigint as new_studied_today
    from public.review_logs rl
    inner join public.cards c on c.id = rl.card_id
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    where rl.user_id = p_user_id
      and rl.state = 0
      and rl.review >= p_start_of_day
    group by s.project_id
  ),
  last_reviews as (
    select s.project_id, max(rl.review) as last_review
    from public.review_logs rl
    inner join public.cards c on c.id = rl.card_id
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    where rl.user_id = p_user_id
    group by s.project_id
  )
  select
    up.id as project_id,
    coalesce(pd.card_count, 0) as card_count,
    coalesce(pd.due_count, 0) as due_count,
    coalesce(pd.new_card_count, 0) as new_card_count,
    coalesce(nt.new_studied_today, 0) as new_studied_today,
    coalesce(pd.state_new, 0) as state_new,
    coalesce(pd.state_learning, 0) as state_learning,
    coalesce(pd.state_review, 0) as state_review,
    coalesce(pd.state_relearning, 0) as state_relearning,
    lr.last_review
  from user_projects up
  left join per_deck pd on pd.project_id = up.id
  left join new_today nt on nt.project_id = up.id
  left join last_reviews lr on lr.project_id = up.id;
$$;

grant execute on function public.get_study_deck_summaries(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.get_dashboard_queue_snapshot(uuid, timestamptz, timestamptz) to authenticated;
