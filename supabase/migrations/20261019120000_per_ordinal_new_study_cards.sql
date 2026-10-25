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
--
-- Study ordinals match expandCardToQueueItems in @deephaus/scheduling:
-- cloze -> distinct {{cN::}} for N in 1..9; image occlusion -> distinct ord
-- (default 1) of enabled rects, or 0 when none; anything else -> 0.
--
-- The check is written inline in both functions rather than as helper
-- functions: a helper with `set search_path` cannot be inlined, and calling it
-- once per card made a 20,000-card deck take ~11 s instead of ~0.1 s.
-- Keep the two copies of the predicate identical.

-- An earlier version of this migration (applied to launch-staging only)
-- defined per-card helpers; remove them if present.
drop function if exists public.study_card_has_new_ordinal(uuid, uuid, text, text, jsonb);
drop function if exists public.study_card_ordinals(text, text, jsonb);

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
    and not (
      exists (
        select 1 from public.card_reviews cr
        where cr.card_id = c.id and cr.user_id = p_user_id and cr.suspended
      )
      and not exists (
        select 1 from public.card_reviews cr
        where cr.card_id = c.id and cr.user_id = p_user_id and not cr.suspended
      )
    )
    and exists (
      select 1
      from (
        select n::smallint as ord
        from generate_series(1, 9) as n
        where c.type = 'cloze'
          and strpos(lower(coalesce(c.cloze_text, '')), '{{c' || n || '::') > 0
        union all
        select io.ord from (
          select distinct least(greatest(
            case when jsonb_typeof(r.rect->'ord') = 'number'
              then floor((r.rect->>'ord')::numeric)::int
              else 1
            end, 1), 9)::smallint as ord
          from jsonb_array_elements(
            case when c.type = 'image-occlusion'
              and jsonb_typeof(c.occlusion_data->'rects') = 'array'
              then c.occlusion_data->'rects'
              else '[]'::jsonb
            end
          ) as r(rect)
          where jsonb_typeof(r.rect) = 'object'
            and r.rect->'enabled' is distinct from 'false'::jsonb
        ) io
        union all
        select 0::smallint
        where c.type <> 'cloze'
          and not exists (
            select 1
            from jsonb_array_elements(
              case when c.type = 'image-occlusion'
                and jsonb_typeof(c.occlusion_data->'rects') = 'array'
                then c.occlusion_data->'rects'
                else '[]'::jsonb
              end
            ) as r(rect)
            where jsonb_typeof(r.rect) = 'object'
              and r.rect->'enabled' is distinct from 'false'::jsonb
          )
      ) o
      where not exists (
        select 1 from public.card_reviews cr
        where cr.card_id = c.id
          and cr.user_id = p_user_id
          and cr.cloze_ord = o.ord
          and (cr.suspended or cr.state <> 0)
      )
    );
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
    and not (
      exists (
        select 1 from public.card_reviews cr
        where cr.card_id = c.id and cr.user_id = p_user_id and cr.suspended
      )
      and not exists (
        select 1 from public.card_reviews cr
        where cr.card_id = c.id and cr.user_id = p_user_id and not cr.suspended
      )
    )
    and exists (
      select 1
      from (
        select n::smallint as ord
        from generate_series(1, 9) as n
        where c.type = 'cloze'
          and strpos(lower(coalesce(c.cloze_text, '')), '{{c' || n || '::') > 0
        union all
        select io.ord from (
          select distinct least(greatest(
            case when jsonb_typeof(r.rect->'ord') = 'number'
              then floor((r.rect->>'ord')::numeric)::int
              else 1
            end, 1), 9)::smallint as ord
          from jsonb_array_elements(
            case when c.type = 'image-occlusion'
              and jsonb_typeof(c.occlusion_data->'rects') = 'array'
              then c.occlusion_data->'rects'
              else '[]'::jsonb
            end
          ) as r(rect)
          where jsonb_typeof(r.rect) = 'object'
            and r.rect->'enabled' is distinct from 'false'::jsonb
        ) io
        union all
        select 0::smallint
        where c.type <> 'cloze'
          and not exists (
            select 1
            from jsonb_array_elements(
              case when c.type = 'image-occlusion'
                and jsonb_typeof(c.occlusion_data->'rects') = 'array'
                then c.occlusion_data->'rects'
                else '[]'::jsonb
              end
            ) as r(rect)
            where jsonb_typeof(r.rect) = 'object'
              and r.rect->'enabled' is distinct from 'false'::jsonb
          )
      ) o
      where not exists (
        select 1 from public.card_reviews cr
        where cr.card_id = c.id
          and cr.user_id = p_user_id
          and cr.cloze_ord = o.ord
          and (cr.suspended or cr.state <> 0)
      )
    )
  order by c.sort_order, c.id
  limit greatest(p_limit, 0);
$$;

grant execute on function public.count_new_study_cards(uuid, uuid) to authenticated;
grant execute on function public.fetch_new_study_cards(uuid, uuid, int) to authenticated;
