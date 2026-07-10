-- Isolated, deadline-based Cram Plans.
-- Cram state and history intentionally live outside card_reviews/review_logs.

create table if not exists public.cram_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  deadline_at timestamptz not null,
  deadline_timezone text not null default 'UTC',
  deadline_has_time boolean not null default false,
  target_retention double precision not null
    check (target_retention between 0.70 and 0.97),
  daily_minutes integer not null check (daily_minutes between 1 and 1440),
  selection_spec jsonb not null default '{}'::jsonb,
  estimated_seconds_per_review double precision not null default 20
    check (estimated_seconds_per_review between 1 and 3600),
  started_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cram_plan_deck_profiles (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.cram_plans(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  fsrs_params jsonb,
  created_at timestamptz not null default now(),
  unique (plan_id, project_id)
);

create table if not exists public.cram_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.cram_plans(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  cloze_ord integer not null default 0 check (cloze_ord between 0 and 99),
  due timestamptz not null default now(),
  stability double precision not null default 0,
  difficulty double precision not null default 0,
  elapsed_days double precision not null default 0,
  scheduled_days double precision not null default 0,
  reps integer not null default 0,
  lapses integer not null default 0,
  state smallint not null default 0 check (state between 0 and 3),
  last_review timestamptz,
  learning_steps integer not null default 0,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, card_id, cloze_ord)
);

create table if not exists public.cram_review_logs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.cram_plans(id) on delete cascade,
  item_id uuid not null references public.cram_plan_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  cloze_ord integer not null default 0 check (cloze_ord between 0 and 99),
  rating smallint not null check (rating between 1 and 4),
  state smallint not null check (state between 0 and 3),
  due timestamptz not null,
  stability double precision not null,
  difficulty double precision not null,
  elapsed_days double precision not null,
  last_elapsed_days double precision not null,
  scheduled_days double precision not null,
  review timestamptz not null,
  response_ms integer check (response_ms is null or response_ms between 0 and 3600000),
  previous_state jsonb not null,
  next_state jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_cram_plans_user_status
  on public.cram_plans(user_id, status, deadline_at);
create index if not exists idx_cram_plan_items_plan_due
  on public.cram_plan_items(plan_id, due);
create index if not exists idx_cram_plan_items_card
  on public.cram_plan_items(card_id);
create index if not exists idx_cram_review_logs_plan_review
  on public.cram_review_logs(plan_id, review desc);
create index if not exists idx_cram_review_logs_item_review
  on public.cram_review_logs(item_id, review desc);

alter table public.cram_plans enable row level security;
alter table public.cram_plan_deck_profiles enable row level security;
alter table public.cram_plan_items enable row level security;
alter table public.cram_review_logs enable row level security;

create policy "Users manage own cram plans"
  on public.cram_plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own cram deck profiles"
  on public.cram_plan_deck_profiles for all
  using (
    exists (
      select 1 from public.cram_plans p
      where p.id = cram_plan_deck_profiles.plan_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.cram_plans p
      where p.id = cram_plan_deck_profiles.plan_id
        and p.user_id = auth.uid()
    )
  );

create policy "Users manage own cram plan items"
  on public.cram_plan_items for all
  using (
    exists (
      select 1 from public.cram_plans p
      where p.id = cram_plan_items.plan_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.cram_plans p
      where p.id = cram_plan_items.plan_id
        and p.user_id = auth.uid()
    )
  );

create policy "Users manage own cram review logs"
  on public.cram_review_logs for all
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.cram_plans p
      where p.id = cram_review_logs.plan_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.cram_plans p
      where p.id = cram_review_logs.plan_id
        and p.user_id = auth.uid()
    )
  );

create or replace function public.touch_cram_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_cram_plans_updated_at on public.cram_plans;
create trigger trg_cram_plans_updated_at
  before update on public.cram_plans
  for each row execute function public.touch_cram_updated_at();

drop trigger if exists trg_cram_plan_items_updated_at on public.cram_plan_items;
create trigger trg_cram_plan_items_updated_at
  before update on public.cram_plan_items
  for each row execute function public.touch_cram_updated_at();

-- Atomically advance one private Cram item and append its private history row.
-- The optimistic version check prevents two tabs from grading the same state.
create or replace function public.record_cram_review(
  p_plan_id uuid,
  p_item_id uuid,
  p_rating smallint,
  p_expected_version integer,
  p_next_state jsonb,
  p_log jsonb,
  p_response_ms integer default null
)
returns table(item_id uuid, new_version integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item public.cram_plan_items%rowtype;
  v_previous jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_rating < 1 or p_rating > 4 then
    raise exception 'Invalid rating' using errcode = '22023';
  end if;
  if p_response_ms is not null and (p_response_ms < 0 or p_response_ms > 3600000) then
    raise exception 'Invalid response time' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.cram_plans p
    where p.id = p_plan_id
      and p.user_id = v_user_id
      and p.status = 'active'
  ) then
    raise exception 'Active Cram Plan not found' using errcode = 'P0002';
  end if;

  select i.* into v_item
  from public.cram_plan_items i
  where i.id = p_item_id
    and i.plan_id = p_plan_id
  for update;

  if not found then
    raise exception 'Cram Plan item not found' using errcode = 'P0002';
  end if;
  if v_item.version <> p_expected_version then
    raise exception 'Cram Plan item changed' using errcode = '40001';
  end if;

  v_previous := jsonb_build_object(
    'due', v_item.due,
    'stability', v_item.stability,
    'difficulty', v_item.difficulty,
    'elapsed_days', v_item.elapsed_days,
    'scheduled_days', v_item.scheduled_days,
    'reps', v_item.reps,
    'lapses', v_item.lapses,
    'state', v_item.state,
    'last_review', v_item.last_review,
    'learning_steps', v_item.learning_steps
  );

  update public.cram_plan_items
  set due = (p_next_state->>'due')::timestamptz,
      stability = (p_next_state->>'stability')::double precision,
      difficulty = (p_next_state->>'difficulty')::double precision,
      elapsed_days = (p_next_state->>'elapsed_days')::double precision,
      scheduled_days = (p_next_state->>'scheduled_days')::double precision,
      reps = (p_next_state->>'reps')::integer,
      lapses = (p_next_state->>'lapses')::integer,
      state = (p_next_state->>'state')::smallint,
      last_review = nullif(p_next_state->>'last_review', '')::timestamptz,
      learning_steps = coalesce((p_next_state->>'learning_steps')::integer, 0),
      version = version + 1
  where id = p_item_id;

  insert into public.cram_review_logs (
    plan_id, item_id, user_id, card_id, cloze_ord, rating, state, due,
    stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days,
    review, response_ms, previous_state, next_state
  ) values (
    p_plan_id,
    p_item_id,
    v_user_id,
    v_item.card_id,
    v_item.cloze_ord,
    p_rating,
    (p_log->>'state')::smallint,
    (p_log->>'due')::timestamptz,
    (p_log->>'stability')::double precision,
    (p_log->>'difficulty')::double precision,
    (p_log->>'elapsed_days')::double precision,
    (p_log->>'last_elapsed_days')::double precision,
    (p_log->>'scheduled_days')::double precision,
    (p_log->>'review')::timestamptz,
    p_response_ms,
    v_previous,
    p_next_state
  );

  return query select p_item_id, p_expected_version + 1;
end;
$$;

revoke all on function public.record_cram_review(
  uuid, uuid, smallint, integer, jsonb, jsonb, integer
) from public;
grant execute on function public.record_cram_review(
  uuid, uuid, smallint, integer, jsonb, jsonb, integer
) to authenticated;
