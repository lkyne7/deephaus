-- Targeted query helpers for study queue and deck browse counts.

create or replace function public.count_cards_by_projects(p_project_ids uuid[])
returns table (project_id uuid, card_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select s.project_id, count(c.id)::bigint
  from public.cards c
  inner join public.generation_jobs gj on gj.id = c.job_id
  inner join public.sources s on s.id = gj.source_id
  where s.project_id = any (p_project_ids)
  group by s.project_id;
$$;

create or replace function public.count_new_study_cards(p_deck_id uuid, p_user_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::bigint
  from public.cards c
  inner join public.generation_jobs gj on gj.id = c.job_id
  inner join public.sources s on s.id = gj.source_id
  left join public.card_reviews cr on cr.card_id = c.id and cr.user_id = p_user_id
  where s.project_id = p_deck_id
    and (cr.card_id is null or cr.state = 0);
$$;

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
  from public.review_logs rl
  inner join public.cards c on c.id = rl.card_id
  inner join public.generation_jobs gj on gj.id = c.job_id
  inner join public.sources s on s.id = gj.source_id
  where s.project_id = p_deck_id
    and rl.user_id = p_user_id
    and rl.state = 0
    and rl.review >= p_start_of_day;
$$;

create or replace function public.fetch_new_study_cards(
  p_deck_id uuid,
  p_user_id uuid,
  p_limit int
)
returns table (
  id uuid,
  type text,
  front text,
  back text,
  cloze_text text,
  extra text,
  sort_order int
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, c.type, c.front, c.back, c.cloze_text, c.extra, c.sort_order
  from public.cards c
  inner join public.generation_jobs gj on gj.id = c.job_id
  inner join public.sources s on s.id = gj.source_id
  left join public.card_reviews cr on cr.card_id = c.id and cr.user_id = p_user_id
  where s.project_id = p_deck_id
    and (cr.card_id is null or cr.state = 0)
  order by c.sort_order
  limit greatest(p_limit, 0);
$$;

grant execute on function public.count_cards_by_projects(uuid[]) to authenticated;
grant execute on function public.count_new_study_cards(uuid, uuid) to authenticated;
grant execute on function public.count_new_reviews_today_for_deck(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.fetch_new_study_cards(uuid, uuid, int) to authenticated;
