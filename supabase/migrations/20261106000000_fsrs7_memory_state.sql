-- FSRS-7: a second ("fast") memory trace per card, and a record of which model
-- produced each card's memory. Additive: builds that predate FSRS-7 keep
-- working, and the states they write are recorded as FSRS-6.
--
-- A card's FSRS-7 memory can only be rebuilt by replaying its review history,
-- so nothing here converts existing rows. Clients do that as cards are reviewed,
-- and cards without complete history stay on FSRS-6.

alter table public.card_reviews
  add column if not exists stability_fast double precision,
  add column if not exists fsrs_version smallint not null default 6
    check (fsrs_version in (6, 7));

alter table public.cram_plan_items
  add column if not exists stability_fast double precision,
  add column if not exists fsrs_version smallint not null default 6
    check (fsrs_version in (6, 7));

-- FSRS-7 has its own 34 weights; FSRS-6 weights cannot be converted. `params`
-- stays the user's FSRS-6 fit, for the cards that remain on FSRS-6, and becomes
-- optional so a user can have FSRS-7 weights alone.
alter table public.user_fsrs_params
  add column if not exists fsrs7_params double precision[],
  add column if not exists fsrs7_log_count integer,
  add column if not exists fsrs7_optimized_at timestamptz;
alter table public.user_fsrs_params alter column params drop not null;

create or replace function private.validate_review_schedule(s jsonb) returns void
language plpgsql set search_path='' as $$
declare k text; n double precision;
begin
  if s is null or jsonb_typeof(s)<>'object' or s->>'due' is null or not isfinite((s->>'due')::timestamptz)
    or coalesce((s->>'state')::int,-1) not between 0 and 3 then raise exception 'Invalid schedule' using errcode='22023'; end if;
  foreach k in array array['stability','difficulty','elapsed_days','scheduled_days','reps','lapses'] loop
    n := (s->>k)::float8;
    if n is null or n<0 or n>100000000 or n='NaN'::float8 or (k='difficulty' and n>10)
      or (k in ('reps','lapses') and n<>trunc(n)) then raise exception 'Invalid schedule' using errcode='22023'; end if;
  end loop;
  if coalesce((s->>'learning_steps')::int,0)<0 then raise exception 'Invalid schedule' using errcode='22023'; end if;
  -- Optional: absent on states written by FSRS-6 clients.
  n := (s->>'stability_fast')::float8;
  if n is not null and (n<0 or n>100000000 or n='NaN'::float8) then raise exception 'Invalid schedule' using errcode='22023'; end if;
  if s->>'fsrs_version' is not null and (s->>'fsrs_version')::int not in (6,7) then raise exception 'Invalid schedule' using errcode='22023'; end if;
end $$;
revoke all on function private.validate_review_schedule(jsonb) from public;

create or replace function public.apply_card_review_legacy(
  p_user_id uuid,
  p_card_id uuid,
  p_cloze_ord smallint,
  p_expected_version integer,
  p_mutation_id uuid,
  p_review jsonb,
  p_log jsonb,
  p_response jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing_response jsonb;
  v_review_id uuid;
  v_current_version integer;
  v_stability_fast double precision := (p_review->>'stability_fast')::double precision;
  -- Clients that predate FSRS-7 send neither field, so their states are FSRS-6.
  v_fsrs_version smallint := case
    when v_stability_fast is not null and (p_review->>'fsrs_version')::integer = 7 then 7
    else 6
  end;
begin
  if auth.role() <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_expected_version < 0 then
    raise exception 'Invalid review version' using errcode = '22023';
  end if;

  select rl.response_payload
    into v_existing_response
  from public.review_logs rl
  where rl.id = p_mutation_id
    and rl.user_id = p_user_id;

  if found then
    return v_existing_response;
  end if;

  -- Serialize first-review inserts as well as updates for one card ordinal.
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_user_id::text || ':' || p_card_id::text || ':' || p_cloze_ord::text,
      0
    )
  );

  -- A concurrent retry may have committed while this call waited on the lock.
  select rl.response_payload
    into v_existing_response
  from public.review_logs rl
  where rl.id = p_mutation_id
    and rl.user_id = p_user_id;

  if found then
    return v_existing_response;
  end if;

  select cr.id, cr.version
    into v_review_id, v_current_version
  from public.card_reviews cr
  where cr.card_id = p_card_id
    and cr.user_id = p_user_id
    and cr.cloze_ord = p_cloze_ord
  for update;

  if found then
    if v_current_version <> p_expected_version then
      raise exception 'Card review changed' using errcode = '40001';
    end if;

    update public.card_reviews
    set due = (p_review->>'due')::timestamptz,
        stability = (p_review->>'stability')::double precision,
        difficulty = (p_review->>'difficulty')::double precision,
        elapsed_days = (p_review->>'elapsed_days')::double precision,
        scheduled_days = (p_review->>'scheduled_days')::double precision,
        learning_steps = coalesce((p_review->>'learning_steps')::integer, 0),
        reps = (p_review->>'reps')::integer,
        lapses = (p_review->>'lapses')::integer,
        state = (p_review->>'state')::smallint,
        last_review = nullif(p_review->>'last_review', '')::timestamptz,
        stability_fast = v_stability_fast,
        fsrs_version = v_fsrs_version,
        version = version + 1
    where id = v_review_id;
  else
    if p_expected_version <> 0 then
      raise exception 'Card review changed' using errcode = '40001';
    end if;

    insert into public.card_reviews (
      id, card_id, user_id, cloze_ord, due, stability, difficulty, elapsed_days,
      scheduled_days, learning_steps, reps, lapses, state, last_review, version,
      stability_fast, fsrs_version
    ) values (
      coalesce(nullif(p_review->>'id', '')::uuid, gen_random_uuid()),
      p_card_id,
      p_user_id,
      p_cloze_ord,
      (p_review->>'due')::timestamptz,
      (p_review->>'stability')::double precision,
      (p_review->>'difficulty')::double precision,
      (p_review->>'elapsed_days')::double precision,
      (p_review->>'scheduled_days')::double precision,
      coalesce((p_review->>'learning_steps')::integer, 0),
      (p_review->>'reps')::integer,
      (p_review->>'lapses')::integer,
      (p_review->>'state')::smallint,
      nullif(p_review->>'last_review', '')::timestamptz,
      1,
      v_stability_fast,
      v_fsrs_version
    );
  end if;

  insert into public.review_logs (
    id, card_id, user_id, cloze_ord, rating, state, due, stability,
    difficulty, elapsed_days, last_elapsed_days, scheduled_days, review,
    response_payload, base_version
  ) values (
    p_mutation_id,
    p_card_id,
    p_user_id,
    p_cloze_ord,
    (p_log->>'rating')::smallint,
    (p_log->>'state')::smallint,
    (p_log->>'due')::timestamptz,
    (p_log->>'stability')::double precision,
    (p_log->>'difficulty')::double precision,
    (p_log->>'elapsed_days')::double precision,
    (p_log->>'last_elapsed_days')::double precision,
    (p_log->>'scheduled_days')::double precision,
    (p_log->>'review')::timestamptz,
    p_response,
    p_expected_version
  );

  return p_response;
end;
$$;

create or replace function public.restore_card_review(p_card_id uuid,p_cloze_ord smallint,p_log_id uuid,p_undone boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid(); target public.review_events%rowtype; winner public.review_events%rowtype; schedule jsonb; current_row public.card_reviews%rowtype;
begin
  if u is null or p_log_id is null or p_undone is null then raise exception 'A verified review ID is required' using errcode='42501'; end if;
  if not exists(select 1 from public.cards c join public.generation_jobs g on g.id=c.job_id join public.sources s on s.id=g.source_id where c.id=p_card_id and s.user_id=u) then raise exception 'Card not found' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text||':'||p_card_id::text||':'||p_cloze_ord::text,0));
  select * into target from public.review_events where id=p_log_id and user_id=u and kind='study' and target_id=p_card_id and cloze_ord=p_cloze_ord for update;
  if not found then
    -- Legacy queues contain the original response; import only that user's recorded snapshots.
    insert into public.review_events(id,user_id,kind,target_id,cloze_ord,raw_answered_at,answered_at,next_state,previous_state)
      select id,user_id,'study',card_id,cloze_ord,review,least(review,clock_timestamp()),coalesce(next_state,response_payload->'next_state'),coalesce(previous_state,response_payload->'previous_state')
      from public.review_logs where id=p_log_id and user_id=u and card_id=p_card_id and cloze_ord=p_cloze_ord and coalesce(next_state,response_payload->'next_state') is not null
      returning * into target;
    if not found then
      if exists(select 1 from public.review_logs where id=p_log_id and user_id=u and card_id=p_card_id and cloze_ord=p_cloze_ord) then
        update public.review_logs set undone=p_undone where id=p_log_id and user_id=u;
        update public.card_reviews set version=version+1 where user_id=u and card_id=p_card_id and cloze_ord=p_cloze_ord returning * into current_row;
        if not found then return jsonb_build_object('state',0,'is_new',true,'reps',0,'lapses',0); end if;
        return jsonb_build_object('state',current_row.state,'due',current_row.due,'reps',current_row.reps,'lapses',current_row.lapses,
          'is_new',current_row.state=0,'reconciliation','history_only');
      end if;
      raise exception 'This review needs to sync before undo is available' using errcode='40001';
    end if;
  end if;
  select * into current_row from public.card_reviews where user_id=u and card_id=p_card_id and cloze_ord=p_cloze_ord for update;
  update public.review_events set undone=p_undone where id=p_log_id;
  update public.review_logs set undone=p_undone where id=p_log_id and user_id=u;
  select * into winner from public.review_events where user_id=u and kind='study' and target_id=p_card_id and cloze_ord=p_cloze_ord and not undone order by answered_at desc,id desc limit 1;
  -- A newer legacy review not represented in events remains authoritative.
  if current_row.winning_review_id is null and current_row.last_review > target.answered_at then
    return jsonb_build_object('state',current_row.state,'due',current_row.due,'reps',current_row.reps,'lapses',current_row.lapses,'is_new',false);
  end if;
  if winner.id is not null then schedule := winner.next_state;
  else select previous_state into schedule from public.review_events where user_id=u and kind='study' and target_id=p_card_id and cloze_ord=p_cloze_ord order by received_at,id limit 1;
  end if;
  if schedule is null or schedule='null'::jsonb or schedule->>'due' is null then
    delete from public.card_reviews where user_id=u and card_id=p_card_id and cloze_ord=p_cloze_ord;
    return jsonb_build_object('state',0,'is_new',true,'reps',0,'lapses',0);
  end if;
  -- Snapshots taken before FSRS-7 carry neither field: they are FSRS-6 states.
  insert into public.card_reviews(card_id,user_id,cloze_ord,due,stability,difficulty,elapsed_days,scheduled_days,reps,lapses,state,last_review,learning_steps,version,winning_review_id,stability_fast,fsrs_version)
  values(p_card_id,u,p_cloze_ord,(schedule->>'due')::timestamptz,(schedule->>'stability')::float8,(schedule->>'difficulty')::float8,
    (schedule->>'elapsed_days')::float8,(schedule->>'scheduled_days')::float8,(schedule->>'reps')::int,(schedule->>'lapses')::int,
    (schedule->>'state')::smallint,(schedule->>'last_review')::timestamptz,coalesce((schedule->>'learning_steps')::int,0),coalesce(current_row.version,0)+1,winner.id,
    (schedule->>'stability_fast')::float8,
    case when (schedule->>'stability_fast') is not null and (schedule->>'fsrs_version')::int=7 then 7 else 6 end)
  on conflict(card_id,user_id,cloze_ord) do update set due=excluded.due,stability=excluded.stability,difficulty=excluded.difficulty,
    elapsed_days=excluded.elapsed_days,scheduled_days=excluded.scheduled_days,reps=excluded.reps,lapses=excluded.lapses,state=excluded.state,
    last_review=excluded.last_review,learning_steps=excluded.learning_steps,version=excluded.version,winning_review_id=excluded.winning_review_id,
    stability_fast=excluded.stability_fast,fsrs_version=excluded.fsrs_version;
  return schedule||jsonb_build_object('is_new',(schedule->>'state')::int=0);
end $$;

create or replace function public.record_synced_cram_review_legacy(
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
  v_stability_fast double precision := (p_next_state->>'stability_fast')::double precision;
  v_fsrs_version smallint := case
    when v_stability_fast is not null and (p_next_state->>'fsrs_version')::integer = 7 then 7
    else 6
  end;
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
    'stability_fast', v_item.stability_fast,
    'fsrs_version', v_item.fsrs_version,
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
      stability_fast = v_stability_fast,
      fsrs_version = v_fsrs_version,
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

-- The fast trace and model are part of an item's review state.
create or replace function public.guard_cram_plan_item_review_version() returns trigger
language plpgsql set search_path=public as $$
begin
  if row(new.due,new.stability,new.difficulty,new.elapsed_days,new.scheduled_days,new.learning_steps,new.reps,new.lapses,new.state,new.last_review,new.stability_fast,new.fsrs_version)
    is distinct from row(old.due,old.stability,old.difficulty,old.elapsed_days,old.scheduled_days,old.learning_steps,old.reps,old.lapses,old.state,old.last_review,old.stability_fast,old.fsrs_version)
    and new.version<>old.version+1 then raise exception 'Cram Plan item changed' using errcode='40001'; end if;
  if new.version not in (old.version,old.version+1) then raise exception 'Invalid Cram version' using errcode='40001'; end if;
  return new;
end $$;

notify pgrst, 'reload schema';
