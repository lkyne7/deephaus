-- Keep image-occlusion region data available to the browse/editor autosave flow.

drop function if exists public.browse_cards(uuid, uuid, text, text, int, int);

create function public.browse_cards(
  p_user_id uuid,
  p_deck_id uuid default null,
  p_tag text default null,
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  deck_id uuid,
  deck_name text,
  type text,
  front text,
  back text,
  cloze_text text,
  extra text,
  occlusion_data jsonb,
  tags text[],
  sort_order int,
  user_edited boolean,
  suspended boolean,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select
      c.id,
      p.id as deck_id,
      coalesce(p.deck_name, p.name) as deck_name,
      c.type,
      c.front,
      c.back,
      c.cloze_text,
      c.extra,
      c.occlusion_data,
      c.tags,
      c.sort_order,
      c.user_edited,
      coalesce(cr.suspended, false) as suspended
    from public.cards c
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    inner join public.projects p on p.id = s.project_id
    left join lateral (
      select bool_or(cr2.suspended) as suspended
      from public.card_reviews cr2
      where cr2.card_id = c.id
        and cr2.user_id = p_user_id
    ) cr on true
    where p.user_id = p_user_id
      and (p_deck_id is null or p.id = p_deck_id)
      and (p_tag is null or p_tag = any(c.tags))
      and (
        p_search is null
        or btrim(p_search) = ''
        or coalesce(c.front, '') ilike '%' || p_search || '%'
        or coalesce(c.back, '') ilike '%' || p_search || '%'
        or coalesce(c.cloze_text, '') ilike '%' || p_search || '%'
        or coalesce(c.extra, '') ilike '%' || p_search || '%'
      )
  )
  select
    scoped.*,
    count(*) over() as total_count
  from scoped
  order by deck_name, sort_order, id
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

grant execute on function public.browse_cards(uuid, uuid, text, text, int, int) to authenticated;
