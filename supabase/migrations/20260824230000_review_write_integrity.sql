-- Make online card review submissions atomic, concurrency-safe, and
-- idempotent. The API supplies a stable mutation UUID which is also the
-- review_logs primary key, so an ambiguous retry returns the first result
-- instead of grading the card a second time.

alter table public.card_reviews
  add column if not exists version integer not null default 0
  check (version >= 0);

alter table public.review_logs
  add column if not exists response_payload jsonb,
  add column if not exists base_version integer not null default 0
  check (base_version >= 0);

create or replace function public.apply_card_review(
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
        version = version + 1
    where id = v_review_id;
  else
    if p_expected_version <> 0 then
      raise exception 'Card review changed' using errcode = '40001';
    end if;

    insert into public.card_reviews (
      id, card_id, user_id, cloze_ord, due, stability, difficulty, elapsed_days,
      scheduled_days, learning_steps, reps, lapses, state, last_review, version
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
      1
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

revoke all on function public.apply_card_review(
  uuid, uuid, smallint, integer, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.apply_card_review(
  uuid, uuid, smallint, integer, uuid, jsonb, jsonb, jsonb
) to authenticated, service_role;
