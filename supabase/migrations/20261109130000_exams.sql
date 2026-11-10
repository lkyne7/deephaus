-- Exams replace Cram Plans.
--
-- A cram plan kept a private copy of every card's memory. An exam keeps none:
-- it is a date, a target and a selection, and everything else is derived from
-- the cards' real memory (card_reviews) by the planner in @deephaus/scheduling.
-- Exam-prep reviews are ordinary reviews, recorded through apply_card_review
-- with context 'exam' (20261109120000).
--
-- Existing cram plans and their private history are dropped, not converted.

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  exam_at timestamptz not null,
  timezone text not null default 'UTC',
  has_time boolean not null default false,
  target_recall double precision not null default 0.9
    check (target_recall between 0.70 and 0.97),
  -- Null: the planner says how long each day needs.
  daily_minutes_cap integer check (daily_minutes_cap between 1 and 720),
  -- { deck_ids, source_ids, chunk_ids, tags, card_ids }. Resolved on every
  -- read, so cards added to a covered deck join the exam.
  selection_spec jsonb not null default '{}'::jsonb,
  -- Preferred study times as minutes after local midnight, for reminders.
  study_windows jsonb not null default '[]'::jsonb,
  -- The student's own report of how the exam went, 0 to 100.
  result_score double precision check (result_score between 0 and 100),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index exams_user_exam_at_idx on public.exams (user_id, exam_at);

alter table public.exams enable row level security;

create policy "Users manage own exams"
  on public.exams for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger trg_exams_updated_at
  before update on public.exams
  for each row execute function public.touch_updated_at();

create trigger prevent_deleted_account_writes
  before insert or update on public.exams
  for each row execute function private.prevent_deleted_account_writes();

grant select, insert, update, delete on public.exams to authenticated;
grant select on public.exams to powersync_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'powersync') then
    alter publication powersync add table public.exams;
  end if;
end
$$;

-- A review can now point at the exam it counted towards. Deleting the exam
-- keeps the review.
--
-- The exam id describes an answer; it must never be the reason an answer is
-- refused. A review can be recorded offline and arrive after its exam was
-- deleted, so an id that is not one of the reviewer's exams is cleared before
-- the foreign key is checked.
update public.review_logs set exam_id = null where exam_id is not null;

create or replace function private.clear_unknown_review_exam() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.exam_id is not null and not exists (
    select 1 from public.exams e where e.id = new.exam_id and e.user_id = new.user_id
  ) then
    new.exam_id := null;
  end if;
  return new;
end $$;
revoke all on function private.clear_unknown_review_exam() from public;

create trigger clear_unknown_review_exam
  before insert or update of exam_id on public.review_logs
  for each row execute function private.clear_unknown_review_exam();

alter table public.review_logs
  add constraint review_logs_exam_id_fkey
  foreign key (exam_id) references public.exams(id) on delete set null;

create index review_logs_exam_id_idx on public.review_logs (exam_id) where exam_id is not null;

-- Every unit (card, or one cloze/occlusion ordinal of it) a selection covers,
-- with its stored memory and today's grades, as one JSON array. One value
-- rather than a row set, so PostgREST's row cap cannot truncate a large exam.
--
-- Selection: the scoped filters (decks, sources, chunks, tags) narrow each
-- other; card_ids are added on top. A card with any suspended ordinal is left
-- out whole, as in Study Mode.
--
-- The ordinal expansion is the one in count_new_study_cards
-- (20261019120000), inline for the same reason: a helper cannot be inlined and
-- made a 20,000-card deck take seconds. Keep the copies identical.
create or replace function public.exam_units(
  p_user_id uuid,
  p_selection jsonb,
  p_day_start timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with spec as (
    select
      array(select jsonb_array_elements_text(
        case when jsonb_typeof(p_selection->'deck_ids') = 'array' then p_selection->'deck_ids' else '[]'::jsonb end
      ))::uuid[] as deck_ids,
      array(select jsonb_array_elements_text(
        case when jsonb_typeof(p_selection->'source_ids') = 'array' then p_selection->'source_ids' else '[]'::jsonb end
      ))::uuid[] as source_ids,
      array(select jsonb_array_elements_text(
        case when jsonb_typeof(p_selection->'chunk_ids') = 'array' then p_selection->'chunk_ids' else '[]'::jsonb end
      ))::uuid[] as chunk_ids,
      array(select jsonb_array_elements_text(
        case when jsonb_typeof(p_selection->'tags') = 'array' then p_selection->'tags' else '[]'::jsonb end
      ))::text[] as tags,
      array(select jsonb_array_elements_text(
        case when jsonb_typeof(p_selection->'card_ids') = 'array' then p_selection->'card_ids' else '[]'::jsonb end
      ))::uuid[] as card_ids
  ),
  picked as (
    select c.id, c.type, c.cloze_text, c.occlusion_data, c.sort_order, s.project_id
    from public.cards c
    inner join public.generation_jobs gj on gj.id = c.job_id
    inner join public.sources s on s.id = gj.source_id
    inner join public.projects p on p.id = s.project_id
    cross join spec
    where p.user_id = p_user_id
      and (
        (
          (
            cardinality(spec.deck_ids) > 0 or cardinality(spec.source_ids) > 0
            or cardinality(spec.chunk_ids) > 0 or cardinality(spec.tags) > 0
          )
          and (cardinality(spec.deck_ids) = 0 or s.project_id = any(spec.deck_ids))
          and (cardinality(spec.source_ids) = 0 or s.id = any(spec.source_ids))
          and (cardinality(spec.chunk_ids) = 0 or c.source_chunk_id = any(spec.chunk_ids))
          and (cardinality(spec.tags) = 0 or c.tags && spec.tags)
        )
        or c.id = any(spec.card_ids)
      )
      and not exists (
        select 1 from public.card_reviews cr
        where cr.card_id = c.id and cr.user_id = p_user_id and cr.suspended
      )
  ),
  units as (
    select k.id as card_id, k.project_id, k.sort_order, o.ord
    from picked k
    cross join lateral (
      select n::smallint as ord
      from generate_series(1, 9) as n
      where k.type = 'cloze'
        and strpos(lower(coalesce(k.cloze_text, '')), '{{c' || n || '::') > 0
      union all
      select io.ord from (
        select distinct least(greatest(
          case when jsonb_typeof(r.rect->'ord') = 'number'
            then floor((r.rect->>'ord')::numeric)::int
            else 1
          end, 1), 9)::smallint as ord
        from jsonb_array_elements(
          case when k.type = 'image-occlusion'
            and jsonb_typeof(k.occlusion_data->'rects') = 'array'
            then k.occlusion_data->'rects'
            else '[]'::jsonb
          end
        ) as r(rect)
        where jsonb_typeof(r.rect) = 'object'
          and r.rect->'enabled' is distinct from 'false'::jsonb
      ) io
      union all
      select 0::smallint
      where k.type <> 'cloze'
        and not exists (
          select 1
          from jsonb_array_elements(
            case when k.type = 'image-occlusion'
              and jsonb_typeof(k.occlusion_data->'rects') = 'array'
              then k.occlusion_data->'rects'
              else '[]'::jsonb
            end
          ) as r(rect)
          where jsonb_typeof(r.rect) = 'object'
            and r.rect->'enabled' is distinct from 'false'::jsonb
        )
    ) o
  ),
  today as (
    select l.card_id, l.cloze_ord, jsonb_agg(l.rating order by l.review) as ratings
    from public.review_logs l
    where l.user_id = p_user_id and l.review >= p_day_start and not l.undone
    group by l.card_id, l.cloze_ord
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'card_id', u.card_id,
        'cloze_ord', u.ord,
        'project_id', u.project_id,
        'review', case when cr.card_id is null then null else jsonb_build_object(
          'due', cr.due,
          'stability', cr.stability,
          'stability_fast', cr.stability_fast,
          'difficulty', cr.difficulty,
          'elapsed_days', cr.elapsed_days,
          'scheduled_days', cr.scheduled_days,
          'reps', cr.reps,
          'lapses', cr.lapses,
          'state', cr.state,
          'last_review', cr.last_review,
          'learning_steps', cr.learning_steps,
          'fsrs_version', cr.fsrs_version
        ) end,
        'today', coalesce(t.ratings, '[]'::jsonb)
      )
      order by u.project_id, u.sort_order, u.card_id, u.ord
    ),
    '[]'::jsonb
  )
  from units u
  left join public.card_reviews cr
    on cr.card_id = u.card_id and cr.user_id = p_user_id and cr.cloze_ord = u.ord
  left join today t on t.card_id = u.card_id and t.cloze_ord = u.ord;
$$;

revoke all on function public.exam_units(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.exam_units(uuid, jsonb, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cram Plans are gone.
-- ---------------------------------------------------------------------------

drop function if exists public.record_cram_review(uuid, uuid, smallint, integer, jsonb, jsonb, integer);
drop function if exists public.record_synced_cram_review(uuid, uuid, uuid, smallint, integer, jsonb, jsonb, integer);
drop function if exists public.record_synced_cram_review_legacy(uuid, uuid, uuid, smallint, integer, jsonb, jsonb, integer);

-- Dropping a table also removes it from the powersync publication.
drop table if exists public.cram_review_logs;
drop table if exists public.cram_plan_items;
drop table if exists public.cram_plan_deck_profiles;
drop table if exists public.cram_plans;

drop function if exists public.guard_cram_plan_item_review_version();
drop function if exists public.touch_cram_updated_at();

-- Cram answers lived in review_events alongside study answers; their targets
-- were cram items, which no longer exist.
delete from public.review_events where kind = 'cram';

-- The write guard looked up a row's owner through cram_plans for tables keyed
-- by plan_id. No such table remains.
create or replace function private.prevent_deleted_account_writes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  if tg_table_schema = 'storage' then
    begin owner_id := split_part(new.name, '/', 1)::uuid; exception when invalid_text_representation then return new; end;
  else
    owner_id := nullif(to_jsonb(new)->>'user_id','')::uuid;
    if owner_id is null and to_jsonb(new)->>'job_id' is not null then
      select s.user_id into owner_id from public.generation_jobs g join public.sources s on s.id=g.source_id where g.id=(to_jsonb(new)->>'job_id')::uuid;
    end if;
    if owner_id is null and to_jsonb(new)->>'source_id' is not null then
      select s.user_id into owner_id from public.sources s where s.id=(to_jsonb(new)->>'source_id')::uuid;
    end if;
    if owner_id is null and to_jsonb(new)->>'project_id' is not null then
      select p.user_id into owner_id from public.projects p where p.id=(to_jsonb(new)->>'project_id')::uuid;
    end if;
    if owner_id is null then owner_id := auth.uid(); end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||owner_id::text,0));
  if exists (select 1 from public.account_deletion_requests d where d.user_id = owner_id) then
    raise exception 'Account deletion is in progress' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.prevent_deleted_account_writes() from public;

notify pgrst, 'reload schema';
