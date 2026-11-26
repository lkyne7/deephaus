-- browse_cards: sort the card browser the ways Anki's browser does. p_sort is
-- one of packages/shared card-sort.ts's CardSort values; anything else falls
-- back to deck order, as before. The phone's local query
-- (packages/local-db/src/queries/browse.ts) sorts the same way.
--
-- A card with several blanks has one card_reviews row per blank, so its due
-- date is the soonest of them, its lapses the total, its difficulty the
-- highest. New rows (state 0) have no due date or difficulty worth sorting by.
--
-- The new argument has a default, so calls without it (the deployed apps)
-- still resolve. The return type is unchanged.

drop function if exists public.browse_cards(uuid, uuid, text, text, int, int);

create or replace function public.browse_cards(
  p_user_id uuid,
  p_deck_id uuid default null,
  p_tag text default null,
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default 'deck'
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
  tags text[],
  sort_order int,
  user_edited boolean,
  suspended boolean,
  source_ref text,
  source_quote text,
  occlusion_data jsonb,
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
      c.tags,
      c.sort_order,
      c.user_edited,
      coalesce(cr.suspended, false) as suspended,
      c.source_ref,
      c.source_quote,
      c.occlusion_data,
      c.created_at as sort_created,
      -- The question as read: a cloze that opens on a blank sorts by its answer.
      lower(
        case
          when q.text like '{{c%::%' then substr(q.text, strpos(q.text, '::') + 2)
          else q.text
        end
      ) as sort_text,
      cr.due as sort_due,
      cr.lapses as sort_lapses,
      cr.difficulty as sort_difficulty
    from public.cards c
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    inner join public.projects p on p.id = s.project_id
    cross join lateral (
      select btrim(coalesce(nullif(c.cloze_text, ''), c.front, '')) as text
    ) q
    left join lateral (
      select
        bool_or(cr2.suspended) as suspended,
        min(cr2.due) filter (where cr2.state <> 0) as due,
        sum(cr2.lapses) as lapses,
        max(cr2.difficulty) filter (where cr2.state <> 0) as difficulty
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
    scoped.id,
    scoped.deck_id,
    scoped.deck_name,
    scoped.type,
    scoped.front,
    scoped.back,
    scoped.cloze_text,
    scoped.extra,
    scoped.tags,
    scoped.sort_order,
    scoped.user_edited,
    scoped.suspended,
    scoped.source_ref,
    scoped.source_quote,
    scoped.occlusion_data,
    count(*) over() as total_count
  from scoped
  order by
    case when p_sort = 'newest' then scoped.sort_created end desc nulls last,
    case when p_sort = 'oldest' then scoped.sort_created end asc nulls last,
    case when p_sort = 'alpha' then scoped.sort_text end asc nulls last,
    case when p_sort = 'due' then scoped.sort_due end asc nulls last,
    case when p_sort = 'lapses' then coalesce(scoped.sort_lapses, 0) end desc,
    case when p_sort = 'difficulty' then scoped.sort_difficulty end desc nulls last,
    scoped.deck_name,
    scoped.sort_order,
    scoped.id
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

grant execute on function public.browse_cards(uuid, uuid, text, text, int, int, text) to authenticated;
