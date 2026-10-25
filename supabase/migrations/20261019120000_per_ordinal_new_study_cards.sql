-- New-card discovery per (card, ordinal).
--
-- fetch_new_study_cards / count_new_study_cards joined card_reviews per card,
-- so once c1 of a cloze note (or C1 of an image occlusion) was studied the
-- card dropped out of the new queue even though c2/C2 had never been seen.
-- New image-occlusion candidates also came back without occlusion_data, so the
-- queue could not expand them into one item per ordinal.
--
-- A card is a new candidate when at least one of its study ordinals has no
-- review row, or only a non-suspended state=0 row, and the card is not
-- suspended as a whole (it has review rows and every one is suspended).
-- packages/local-db/src/queries/study.ts mirrors this against SQLite.

-- Study ordinals for a card, matching expandCardToQueueItems in
-- @deephaus/scheduling: cloze -> distinct {{cN::}} for N in 1..9; image
-- occlusion -> distinct ord (default 1) of enabled rects, or 0 when none;
-- anything else -> 0.
create or replace function public.study_card_ordinals(
  p_type text,
  p_cloze_text text,
  p_occlusion_data jsonb
)
returns table (ord smallint)
language sql
immutable
security invoker
set search_path = public
as $$
  with io_ords as (
    select distinct least(greatest(
      case when jsonb_typeof(r.rect->'ord') = 'number'
        then floor((r.rect->>'ord')::numeric)::int
        else 1
      end, 1), 9)::smallint as ord
    from jsonb_array_elements(
      case when p_type = 'image-occlusion'
        and jsonb_typeof(p_occlusion_data->'rects') = 'array'
        then p_occlusion_data->'rects'
        else '[]'::jsonb
      end
    ) as r(rect)
    where jsonb_typeof(r.rect) = 'object'
      and r.rect->'enabled' is distinct from 'false'::jsonb
  )
  select n::smallint
  from generate_series(1, 9) as n
  where p_type = 'cloze'
    and strpos(lower(coalesce(p_cloze_text, '')), '{{c' || n || '::') > 0
  union all
  select io_ords.ord from io_ords
  union all
  select 0::smallint
  where p_type <> 'cloze'
    and not exists (select 1 from io_ords);
$$;

create or replace function public.study_card_has_new_ordinal(
  p_card_id uuid,
  p_user_id uuid,
  p_type text,
  p_cloze_text text,
  p_occlusion_data jsonb
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    not (
      exists (
        select 1 from public.card_reviews cr
        where cr.card_id = p_card_id and cr.user_id = p_user_id and cr.suspended
      )
      and not exists (
        select 1 from public.card_reviews cr
        where cr.card_id = p_card_id and cr.user_id = p_user_id and not cr.suspended
      )
    )
    and exists (
      select 1
      from public.study_card_ordinals(p_type, p_cloze_text, p_occlusion_data) o
      where not exists (
        select 1 from public.card_reviews cr
        where cr.card_id = p_card_id
          and cr.user_id = p_user_id
          and cr.cloze_ord = o.ord
          and (cr.suspended or cr.state <> 0)
      )
    );
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
  where s.project_id = p_deck_id
    and public.study_card_has_new_ordinal(c.id, p_user_id, c.type, c.cloze_text, c.occlusion_data);
$$;

-- The return type gains occlusion_data, which requires drop + create. Callers
-- read columns by name, so the old and new web builds both work against it.
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
  select c.id, c.type, c.front, c.back, c.cloze_text, c.extra, c.occlusion_data, c.sort_order
  from public.cards c
  inner join public.generation_jobs gj on gj.id = c.job_id
  inner join public.sources s on s.id = gj.source_id
  where s.project_id = p_deck_id
    and public.study_card_has_new_ordinal(c.id, p_user_id, c.type, c.cloze_text, c.occlusion_data)
  order by c.sort_order, c.id
  limit greatest(p_limit, 0);
$$;

grant execute on function public.study_card_ordinals(text, text, jsonb) to authenticated;
grant execute on function public.study_card_has_new_ordinal(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.count_new_study_cards(uuid, uuid) to authenticated;
grant execute on function public.fetch_new_study_cards(uuid, uuid, int) to authenticated;
