-- Keep audit tombstones out of dashboard counts, quotas, streaks and leaderboards.

create or replace function public.count_new_reviews_today_for_deck(
  p_deck_id uuid,
  p_user_id uuid,
  p_start_of_day timestamptz
)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::bigint
  from (select * from public.review_logs where not undone) rl
  inner join public.cards c on c.id = rl.card_id
  inner join public.generation_jobs gj on gj.id = c.job_id
  inner join public.sources s on s.id = gj.source_id
  where s.project_id = p_deck_id
    and rl.user_id = p_user_id
    and rl.state = 0
    and rl.review >= p_start_of_day;
$$;

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
  new_studied_today bigint,
  last_review timestamptz
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
    from (select * from public.review_logs where not undone) rl
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
    from (select * from public.review_logs where not undone) rl
    inner join public.cards c on c.id = rl.card_id
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    where rl.user_id = p_user_id
    group by s.project_id
  )
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
  left join last_reviews lr on lr.project_id = up.id;
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
    from (select * from public.review_logs where not undone) rl
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
    from (select * from public.review_logs where not undone) rl
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

create or replace function public.get_user_study_days(
  p_user_id uuid,
  p_since timestamptz
)
returns table (day date)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct (rl.review at time zone 'UTC')::date as day
  from (select * from public.review_logs where not undone) rl
  where rl.user_id = p_user_id
    and rl.review >= p_since;
$$;

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
    from (select * from public.review_logs where not undone) rl
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
    from (select * from public.review_logs where not undone) rl
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
    from (select * from public.review_logs where not undone) rl
    where rl.user_id = p_user_id
      and rl.review >= least(p_recent_since, p_start_of_day)
  ),
  study_days as (
    select coalesce(
      array_agg(distinct (rl.review at time zone 'UTC')::date),
      array[]::date[]
    ) as days
    from (select * from public.review_logs where not undone) rl
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

create or replace function public.get_review_leaderboard(
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
    from (select * from public.review_logs where not undone) rl
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

-- Count only active events, including exact-event undo/redo updates.
create or replace function public.sync_user_review_log_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid; delta integer;
begin
  owner_id := case when TG_OP = 'DELETE' then OLD.user_id else NEW.user_id end;
  -- Cascading account removal must not recreate or modify its counters.
  if exists(select 1 from public.account_deletion_requests where user_id=owner_id) then return null; end if;
  delta := case when TG_OP = 'INSERT' then case when NEW.undone then 0 else 1 end
    when TG_OP = 'DELETE' then case when OLD.undone then 0 else -1 end
    else (case when NEW.undone then 0 else 1 end) - (case when OLD.undone then 0 else 1 end) end;
  if delta <> 0 then
    insert into public.user_stats(user_id,review_log_count) values(owner_id,greatest(delta,0))
    on conflict(user_id) do update set review_log_count=greatest(0,public.user_stats.review_log_count+delta),updated_at=now();
  end if;
  return null;
end;
$$;
drop trigger if exists review_logs_user_stats_count on public.review_logs;
create trigger review_logs_user_stats_count after insert or delete or update of undone on public.review_logs
for each row execute function public.sync_user_review_log_count();
revoke execute on function public.sync_user_review_log_count() from anon, authenticated, public;
update public.user_stats s set review_log_count=(select count(*) from public.review_logs l where l.user_id=s.user_id and not l.undone),updated_at=now()
where not exists(select 1 from public.account_deletion_requests d where d.user_id=s.user_id);
notify pgrst, 'reload schema';
