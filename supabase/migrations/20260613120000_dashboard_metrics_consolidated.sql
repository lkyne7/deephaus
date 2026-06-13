-- Single round-trip dashboard metrics.
--
-- /api/stats/dashboard previously fanned out into ~11 separate PostgREST calls
-- (per-deck summaries, global state breakdown, total cards, 3x review_logs
-- counts, study days, …). Each call re-walks cards -> generation_jobs ->
-- sources and re-applies RLS, and on a cold cache the pile-up tripped the
-- Postgres statement timeout while holding pooler connections — starving the
-- review endpoint during study. This collapses all of it into one query the
-- planner can optimize together.

create or replace function public.get_dashboard_metrics(
  p_user_id uuid,
  p_now timestamptz,
  p_start_of_day timestamptz,
  p_recent_since timestamptz,
  p_streak_since timestamptz
)
returns jsonb
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
    left join public.card_reviews cr
      on cr.card_id = dc.card_id and cr.user_id = p_user_id
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
  ),
  last_reviews as (
    select s.project_id, max(rl.review) as last_review
    from public.review_logs rl
    inner join public.cards c on c.id = rl.card_id
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    where rl.user_id = p_user_id
    group by s.project_id
  ),
  -- Primary (lowest cloze_ord) review per card → global card-state breakdown.
  primary_review as (
    select distinct on (dc.card_id)
      dc.card_id,
      cr.state,
      coalesce(cr.suspended, false) as suspended
    from deck_cards dc
    left join public.card_reviews cr
      on cr.card_id = dc.card_id and cr.user_id = p_user_id
    order by dc.card_id, cr.cloze_ord asc nulls first
  ),
  state_breakdown as (
    select
      count(*) filter (where coalesce(state, 0) = 0)::bigint as state_new,
      count(*) filter (where state = 1)::bigint as state_learning,
      count(*) filter (where state = 2)::bigint as state_review,
      count(*) filter (where state = 3)::bigint as state_relearning
    from primary_review
    where suspended = false
  ),
  review_aggregates as (
    select
      count(*) filter (where rl.review >= p_start_of_day)::bigint as reviewed_today,
      count(*) filter (where rl.review >= p_recent_since)::bigint as recent_total,
      count(*) filter (where rl.review >= p_recent_since and rl.rating >= 2)::bigint as recent_passed,
      count(*) filter (where rl.review >= p_start_of_day and rl.state = 0)::bigint as cards_learned_today
    from public.review_logs rl
    where rl.user_id = p_user_id
      and rl.review >= least(p_recent_since, p_start_of_day)
  ),
  study_days as (
    select coalesce(
      array_agg(distinct (rl.review at time zone 'UTC')::date),
      array[]::date[]
    ) as days
    from public.review_logs rl
    where rl.user_id = p_user_id
      and rl.review >= p_streak_since
  ),
  per_deck as (
    select
      up.id as project_id,
      coalesce(cc.card_count, 0) as card_count,
      coalesce(dc.due_count, 0) as due_count,
      coalesce(nc.new_card_count, 0) as new_card_count,
      coalesce(nt.new_studied_today, 0) as new_studied_today,
      lr.last_review
    from user_projects up
    inner join card_counts cc on cc.project_id = up.id
    left join due_counts dc on dc.project_id = up.id
    left join new_cards nc on nc.project_id = up.id
    left join new_today nt on nt.project_id = up.id
    left join last_reviews lr on lr.project_id = up.id
  )
  select jsonb_build_object(
    'per_deck', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', pd.project_id,
        'card_count', pd.card_count,
        'due_count', pd.due_count,
        'new_card_count', pd.new_card_count,
        'new_studied_today', pd.new_studied_today,
        'last_review', pd.last_review
      ))
      from per_deck pd
    ), '[]'::jsonb),
    'state_breakdown', jsonb_build_object(
      'new', sb.state_new,
      'learning', sb.state_learning,
      'review', sb.state_review,
      'relearning', sb.state_relearning
    ),
    'total_cards', coalesce((select sum(card_count) from card_counts), 0),
    'reviewed_today', ra.reviewed_today,
    'recent_total', ra.recent_total,
    'recent_passed', ra.recent_passed,
    'cards_learned_today', ra.cards_learned_today,
    'study_days', to_jsonb(sd.days)
  )
  from state_breakdown sb, review_aggregates ra, study_days sd;
$$;

grant execute on function public.get_dashboard_metrics(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;

-- Supports the state-filtered "today" review-log counts (cards_learned_today,
-- new_studied_today) which previously had no covering index for the state
-- predicate.
create index if not exists idx_review_logs_user_state_review
  on public.review_logs (user_id, state, review);
