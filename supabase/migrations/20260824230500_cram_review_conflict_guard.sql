-- PowerSync uploads cram item changes through PostgREST rather than the
-- record_cram_review RPC. Require the same one-version transition at the
-- table boundary so a stale offline device cannot overwrite a newer grade.

create or replace function public.guard_cram_plan_item_review_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_review_state_changed boolean;
begin
  v_review_state_changed :=
    row(
      new.due,
      new.stability,
      new.difficulty,
      new.elapsed_days,
      new.scheduled_days,
      new.learning_steps,
      new.reps,
      new.lapses,
      new.state,
      new.last_review
    ) is distinct from row(
      old.due,
      old.stability,
      old.difficulty,
      old.elapsed_days,
      old.scheduled_days,
      old.learning_steps,
      old.reps,
      old.lapses,
      old.state,
      old.last_review
    );

  if v_review_state_changed and new.version <> old.version + 1 then
    raise exception 'Cram Plan item changed' using errcode = '40001';
  end if;

  if not v_review_state_changed and new.version <> old.version then
    raise exception 'Cram Plan item version changed without a review'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_cram_plan_item_review_version
  on public.cram_plan_items;

create trigger trg_guard_cram_plan_item_review_version
  before update on public.cram_plan_items
  for each row execute function public.guard_cram_plan_item_review_version();

-- PowerSync review transactions are replayed through this RPC instead of
-- issuing an item PATCH and log INSERT separately. The local log UUID makes
-- retries idempotent, while the expected version preserves the online RPC's
-- optimistic concurrency behavior.
create or replace function public.record_synced_cram_review(
  p_plan_id uuid,
  p_item_id uuid,
  p_log_id uuid,
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

  if exists (
    select 1
    from public.cram_review_logs l
    where l.id = p_log_id
      and l.user_id = v_user_id
  ) then
    return query
      select p_item_id, i.version
      from public.cram_plan_items i
      where i.id = p_item_id
        and i.plan_id = p_plan_id;
    return;
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
    'learning_steps', v_item.learning_steps,
    'version', v_item.version
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
    id, plan_id, item_id, user_id, card_id, cloze_ord, rating, state, due,
    stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days,
    review, response_ms, previous_state, next_state
  ) values (
    p_log_id,
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

revoke all on function public.record_synced_cram_review(
  uuid, uuid, uuid, smallint, integer, jsonb, jsonb, integer
) from public;

grant execute on function public.record_synced_cram_review(
  uuid, uuid, uuid, smallint, integer, jsonb, jsonb, integer
) to authenticated;
