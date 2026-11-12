-- Review order and limits, after Anki's deck options.
--
-- Study defaults gain four options; decks keep their own copies in
-- projects.settings (JSON, no schema change). See packages/shared/src/review-order.ts.
--
--   space_out_siblings   once one gap of a card is studied, its other gaps wait
--                        for the next study day (Anki's "bury siblings")
--   new_card_position    new cards after, mixed with, or before reviews
--   review_sort_order    due date, lowest recall first, or random
--   max_reviews_per_day  review cards per deck per study day; null for no limit
--
-- powersync/sync-streams.yaml syncs the new columns to the phone, and
-- packages/local-db mirrors the deck summary below against SQLite.

alter table public.user_study_settings
  add column if not exists space_out_siblings boolean not null default true,
  add column if not exists new_card_position text not null default 'after'
    check (new_card_position in ('after', 'mixed', 'before')),
  add column if not exists review_sort_order text not null default 'due'
    check (review_sort_order in ('due', 'retrievability', 'random')),
  add column if not exists max_reviews_per_day integer
    check (max_reviews_per_day is null or max_reviews_per_day between 0 and 9999);

-- Deck summaries gain what the study queue needs to count a day the way it
-- serves one: due learning and review cards apart, review and new counts
-- with siblings spaced out, and reviews already done today (for the cap).
--
-- Spacing matches arrangeStudyQueue in @deephaus/scheduling: a card whose
-- other gap was graded today (a review log since the day began) shows no
-- review or new gap, and a card shows at most one of them, a due review
-- before a new gap. Cards being learned are never held back.
--
-- The new p_project_ids filter (null for every deck) lets one deck's page use
-- the same counts. Adding a parameter and columns needs drop + create; callers
-- read columns by name and pass parameters by name, so builds on either side
-- of this migration keep working.
drop function if exists public.get_study_deck_summaries(uuid, timestamptz, timestamptz);

create function public.get_study_deck_summaries(
  p_user_id uuid,
  p_now timestamptz,
  p_start_of_day timestamptz,
  p_project_ids uuid[] default null
)
returns table (
  project_id uuid,
  card_count bigint,
  due_count bigint,
  new_card_count bigint,
  new_studied_today bigint,
  last_review timestamptz,
  learning_due_count bigint,
  review_due_count bigint,
  review_due_cards_spaced bigint,
  new_cards_spaced bigint,
  reviews_today bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with user_projects as (
    select id from public.projects
    where user_id = p_user_id
      and (p_project_ids is null or id = any(p_project_ids))
  ),
  deck_cards as (
    select s.project_id, c.id as card_id, c.type, c.cloze_text, c.occlusion_data
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
  -- (card, gap) pairs graded since the day began (undone grades don't count).
  studied_today as (
    select distinct rl.card_id, rl.cloze_ord
    from public.review_logs rl
    inner join deck_cards dc on dc.card_id = rl.card_id
    where rl.user_id = p_user_id
      and not rl.undone
      and rl.review >= p_start_of_day
  ),
  due_rows as (
    select dc.project_id, cr.card_id, cr.cloze_ord, cr.state
    from public.card_reviews cr
    inner join deck_cards dc on dc.card_id = cr.card_id
    where cr.user_id = p_user_id
      and cr.suspended = false
      and cr.state <> 0
      and cr.due <= p_now
  ),
  due_counts as (
    select
      dr.project_id,
      count(*)::bigint as due_count,
      count(*) filter (where dr.state in (1, 3))::bigint as learning_due_count,
      count(*) filter (where dr.state = 2)::bigint as review_due_count,
      count(distinct dr.card_id) filter (
        where dr.state = 2
          and not exists (
            select 1 from studied_today st
            where st.card_id = dr.card_id and st.cloze_ord <> dr.cloze_ord
          )
      )::bigint as review_due_cards_spaced
    from due_rows dr
    group by dr.project_id
  ),
  new_cards as (
    select dc.project_id, count(*)::bigint as new_card_count
    from deck_cards dc
    left join public.card_reviews cr on cr.card_id = dc.card_id and cr.user_id = p_user_id
    where cr.card_id is null or cr.state = 0
    group by dc.project_id
  ),
  -- Cards with a gap never studied, as count_new_study_cards finds them, less
  -- those spacing holds back today. Keep the gap predicate identical to
  -- count_new_study_cards (20261019120000_per_ordinal_new_study_cards.sql).
  new_spaced as (
    select dc.project_id, count(*)::bigint as new_cards_spaced
    from deck_cards dc
    where not (
        exists (
          select 1 from public.card_reviews cr
          where cr.card_id = dc.card_id and cr.user_id = p_user_id and cr.suspended
        )
        and not exists (
          select 1 from public.card_reviews cr
          where cr.card_id = dc.card_id and cr.user_id = p_user_id and not cr.suspended
        )
      )
      and not exists (select 1 from studied_today st where st.card_id = dc.card_id)
      and not exists (
        select 1 from due_rows dr where dr.card_id = dc.card_id and dr.state = 2
      )
      and exists (
        select 1
        from (
          select n::smallint as ord
          from generate_series(1, 9) as n
          where dc.type = 'cloze'
            and strpos(lower(coalesce(dc.cloze_text, '')), '{{c' || n || '::') > 0
          union all
          select io.ord from (
            select distinct least(greatest(
              case when jsonb_typeof(r.rect->'ord') = 'number'
                then floor((r.rect->>'ord')::numeric)::int
                else 1
              end, 1), 9)::smallint as ord
            from jsonb_array_elements(
              case when dc.type = 'image-occlusion'
                and jsonb_typeof(dc.occlusion_data->'rects') = 'array'
                then dc.occlusion_data->'rects'
                else '[]'::jsonb
              end
            ) as r(rect)
            where jsonb_typeof(r.rect) = 'object'
              and r.rect->'enabled' is distinct from 'false'::jsonb
          ) io
          union all
          select 0::smallint
          where dc.type <> 'cloze'
            and not exists (
              select 1
              from jsonb_array_elements(
                case when dc.type = 'image-occlusion'
                  and jsonb_typeof(dc.occlusion_data->'rects') = 'array'
                  then dc.occlusion_data->'rects'
                  else '[]'::jsonb
                end
              ) as r(rect)
              where jsonb_typeof(r.rect) = 'object'
                and r.rect->'enabled' is distinct from 'false'::jsonb
            )
        ) o
        where not exists (
          select 1 from public.card_reviews cr
          where cr.card_id = dc.card_id
            and cr.user_id = p_user_id
            and cr.cloze_ord = o.ord
            and (cr.suspended or cr.state <> 0)
        )
      )
    group by dc.project_id
  ),
  logs_today as (
    select
      dc.project_id,
      count(*) filter (where rl.state = 0)::bigint as new_studied_today,
      count(*) filter (where rl.state = 2)::bigint as reviews_today
    from public.review_logs rl
    inner join deck_cards dc on dc.card_id = rl.card_id
    where rl.user_id = p_user_id
      and not rl.undone
      and rl.review >= p_start_of_day
    group by dc.project_id
  ),
  last_reviews as (
    select dc.project_id, max(rl.review) as last_review
    from public.review_logs rl
    inner join deck_cards dc on dc.card_id = rl.card_id
    where rl.user_id = p_user_id
      and not rl.undone
    group by dc.project_id
  )
  select
    up.id as project_id,
    coalesce(cc.card_count, 0) as card_count,
    coalesce(du.due_count, 0) as due_count,
    coalesce(nc.new_card_count, 0) as new_card_count,
    coalesce(lt.new_studied_today, 0) as new_studied_today,
    lr.last_review,
    coalesce(du.learning_due_count, 0) as learning_due_count,
    coalesce(du.review_due_count, 0) as review_due_count,
    coalesce(du.review_due_cards_spaced, 0) as review_due_cards_spaced,
    coalesce(ns.new_cards_spaced, 0) as new_cards_spaced,
    coalesce(lt.reviews_today, 0) as reviews_today
  from user_projects up
  inner join card_counts cc on cc.project_id = up.id
  left join due_counts du on du.project_id = up.id
  left join new_cards nc on nc.project_id = up.id
  left join logs_today lt on lt.project_id = up.id
  left join last_reviews lr on lr.project_id = up.id
  left join new_spaced ns on ns.project_id = up.id;
$$;

grant execute on function public.get_study_deck_summaries(uuid, timestamptz, timestamptz, uuid[])
  to authenticated;
