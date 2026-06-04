-- Due review count for study hub (PostgREST cannot count with nested deck filters).

create or replace function public.count_due_study_cards(
  p_deck_id uuid,
  p_user_id uuid,
  p_now timestamptz
)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::bigint
  from public.card_reviews cr
  inner join public.cards c on c.id = cr.card_id
  inner join public.generation_jobs gj on gj.id = c.job_id
  inner join public.sources s on s.id = gj.source_id
  where s.project_id = p_deck_id
    and cr.user_id = p_user_id
    and cr.suspended = false
    and cr.state <> 0
    and cr.due <= p_now;
$$;

grant execute on function public.count_due_study_cards(uuid, uuid, timestamptz) to authenticated;
