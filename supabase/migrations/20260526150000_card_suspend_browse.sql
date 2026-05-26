-- Per-user card suspend state + browse helpers.

alter table public.card_reviews
  add column if not exists suspended boolean not null default false;

create index if not exists idx_card_reviews_user_suspended
  on public.card_reviews(user_id, suspended)
  where suspended = true;

-- Exclude suspended cards from new-card study helpers.
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
    and coalesce(cr.suspended, false) = false
    and (cr.card_id is null or cr.state = 0);
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
    and coalesce(cr.suspended, false) = false
    and (cr.card_id is null or cr.state = 0)
  order by c.sort_order
  limit greatest(p_limit, 0);
$$;

create or replace function public.browse_cards(
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
      c.tags,
      c.sort_order,
      c.user_edited,
      coalesce(cr.suspended, false) as suspended
    from public.cards c
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    inner join public.projects p on p.id = s.project_id
    left join public.card_reviews cr on cr.card_id = c.id and cr.user_id = p_user_id
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

create or replace function public.browse_card_tags(p_user_id uuid, p_deck_id uuid default null)
returns table (tag text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct t.tag
  from public.cards c
  inner join public.generation_jobs gj on gj.id = c.job_id
  inner join public.sources s on s.id = gj.source_id
  inner join public.projects p on p.id = s.project_id
  cross join lateral unnest(c.tags) as t(tag)
  where p.user_id = p_user_id
    and (p_deck_id is null or p.id = p_deck_id)
  order by t.tag;
$$;

grant execute on function public.browse_cards(uuid, uuid, text, text, int, int) to authenticated;
grant execute on function public.browse_card_tags(uuid, uuid) to authenticated;
