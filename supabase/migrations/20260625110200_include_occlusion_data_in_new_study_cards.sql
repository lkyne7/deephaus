-- Preserve image-occlusion metadata when fetching new study candidates.
--
-- New image-occlusion cards need their rect ordinals during queue expansion;
-- without occlusion_data they collapse into one non-ordinal review item.

drop function if exists public.fetch_new_study_cards(uuid, uuid, int);

create function public.fetch_new_study_cards(
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
  occlusion_data jsonb,
  sort_order int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.type,
    c.front,
    c.back,
    c.cloze_text,
    c.extra,
    c.occlusion_data,
    c.sort_order
  from public.cards c
  inner join public.generation_jobs gj on gj.id = c.job_id
  inner join public.sources s on s.id = gj.source_id
  left join public.card_reviews cr on cr.card_id = c.id and cr.user_id = p_user_id
  where s.project_id = p_deck_id
    and coalesce(cr.suspended, false) = false
    and (cr.card_id is null or cr.state = 0)
  order by c.sort_order
  limit greatest(p_limit, 0);
$$;

grant execute on function public.fetch_new_study_cards(uuid, uuid, int) to authenticated;
