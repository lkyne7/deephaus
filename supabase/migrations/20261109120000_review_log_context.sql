-- Exam-prep reviews are becoming ordinary reviews of the real card. Each
-- recorded review now says where it was answered, which exam it counted
-- towards, and how long the answer took. Additive: clients that predate these
-- fields send none of them and their reviews are recorded as plain study.
--
-- exam_id has no foreign key yet; the exams table arrives with the Exams
-- release.
alter table public.review_logs
  add column if not exists context text not null default 'study'
    check (context in ('study', 'exam', 'cram')),
  add column if not exists exam_id uuid,
  add column if not exists response_ms integer
    check (response_ms between 0 and 3600000);

-- Same protocol as 20261103190000. The three fields ride in p_log, so the
-- signature is unchanged and apply_card_review_legacy still inserts the row.
-- They describe the answer, not the schedule, so a value this function cannot
-- use is dropped instead of rejecting the review.
create or replace function public.apply_card_review(p_user_id uuid,p_card_id uuid,p_cloze_ord smallint,p_expected_version integer,p_mutation_id uuid,p_review jsonb,p_log jsonb,p_response jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  current_row public.card_reviews%rowtype;
  prior_response jsonb;
  submitted_time timestamptz;
  raw_time timestamptz;
  effective_time timestamptz;
  receipt_time timestamptz;
  winner_time timestamptz;
  winner_id uuid;
  wins boolean;
  result jsonb;
  snapshot jsonb := coalesce(p_log->'next_state',p_review);
  log_context text := case when p_log->>'context' in ('study','exam','cram') then p_log->>'context' else 'study' end;
  log_exam_id uuid := case when p_log->>'exam_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (p_log->>'exam_id')::uuid end;
  -- Nested so the cast only runs on a JSON number.
  log_response_ms integer := case when jsonb_typeof(p_log->'response_ms')='number' then
    case when (p_log->>'response_ms')::numeric between 0 and 3600000 then round((p_log->>'response_ms')::numeric)::integer end end;
begin
  if auth.role() <> 'service_role' and auth.uid() is distinct from p_user_id then raise exception 'Authentication required' using errcode='42501'; end if;
  if not exists(select 1 from public.cards c join public.generation_jobs g on g.id=c.job_id join public.sources s on s.id=g.source_id where c.id=p_card_id and s.user_id=p_user_id) then raise exception 'Card not found' using errcode='42501'; end if;
  if not private.launch_feature_enabled('review_reconciliation',p_user_id) then
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_card_id::text||':'||p_cloze_ord::text,0));
    -- A replay returns the stored response and must not rewrite recorded history.
    perform 1 from public.review_logs where id=p_mutation_id and user_id=p_user_id;
    if found then
      return public.apply_card_review_legacy(p_user_id,p_card_id,p_cloze_ord,p_expected_version,p_mutation_id,p_review,p_log,p_response);
    end if;
    select * into current_row from public.card_reviews where user_id=p_user_id and card_id=p_card_id and cloze_ord=p_cloze_ord;
    result := public.apply_card_review_legacy(p_user_id,p_card_id,p_cloze_ord,p_expected_version,p_mutation_id,p_review,p_log,p_response);
    -- Snapshot what the server actually applied, not the client's claim.
    select to_jsonb(r) into snapshot from public.card_reviews r where user_id=p_user_id and card_id=p_card_id and cloze_ord=p_cloze_ord;
    submitted_time := coalesce((p_log->>'review')::timestamptz,clock_timestamp());
    raw_time := coalesce((p_log->>'raw_review')::timestamptz,submitted_time);
    effective_time := least(submitted_time,clock_timestamp());
    insert into public.review_events(id,user_id,kind,target_id,cloze_ord,raw_answered_at,answered_at,clock_adjusted,next_state,previous_state)
      values(p_mutation_id,p_user_id,'study',p_card_id,p_cloze_ord,raw_time,effective_time,raw_time<>effective_time,snapshot,to_jsonb(current_row))
      on conflict (id) do nothing;
    -- Every legacy review now has an event, so the row is no longer "newer than history".
    update public.card_reviews set winning_review_id=p_mutation_id where user_id=p_user_id and card_id=p_card_id and cloze_ord=p_cloze_ord;
    update public.review_logs set next_state=snapshot,previous_state=to_jsonb(current_row),raw_review=raw_time,
      context=log_context,exam_id=log_exam_id,response_ms=log_response_ms where id=p_mutation_id and user_id=p_user_id;
    return result;
  end if;
  if p_expected_version is null or p_expected_version < 0 or p_mutation_id is null or p_cloze_ord is null or p_cloze_ord < 0 or p_cloze_ord > 9 or coalesce((p_log->>'rating')::int,0) not between 1 and 4 then raise exception 'Invalid review' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_card_id::text||':'||p_cloze_ord::text,0));
  select * into current_row from public.card_reviews where user_id=p_user_id and card_id=p_card_id and cloze_ord=p_cloze_ord for update;
  select response_payload into prior_response from public.review_logs where id=p_mutation_id and user_id=p_user_id and card_id=p_card_id and cloze_ord=p_cloze_ord;
  if found then
    if current_row.winning_review_id=p_mutation_id and prior_response->>'reconciliation'='authoritative' then return prior_response; end if;
    return prior_response || jsonb_build_object('next_state',to_jsonb(current_row),'state',coalesce(current_row.state,0),'due',current_row.due,'scheduled_days',coalesce(current_row.scheduled_days,0),'winning_review_id',current_row.winning_review_id,'reconciliation',case when current_row.winning_review_id=p_mutation_id then 'authoritative' else 'history_only' end);
  end if;
  submitted_time := (p_log->>'review')::timestamptz;
  raw_time := coalesce((p_log->>'raw_review')::timestamptz,submitted_time);
  if raw_time is null or not isfinite(raw_time) or submitted_time is null or not isfinite(submitted_time) then raise exception 'Invalid answer time' using errcode='22023'; end if;
  effective_time := least(submitted_time,clock_timestamp());
  p_log := p_log || jsonb_build_object('review',effective_time);
  snapshot := jsonb_set(snapshot,'{last_review}',to_jsonb(effective_time));
  if submitted_time <> effective_time then snapshot := jsonb_set(snapshot,'{due}',to_jsonb((snapshot->>'due')::timestamptz+(effective_time-submitted_time))); end if;
  perform private.validate_review_schedule(snapshot);
  perform private.validate_review_schedule(p_log||'{"reps":0,"lapses":0}'::jsonb);
  select answered_at,id into winner_time,winner_id from public.review_events where user_id=p_user_id and kind='study' and target_id=p_card_id and cloze_ord=p_cloze_ord and not undone order by answered_at desc,id desc limit 1;
  winner_time := greatest(winner_time,current_row.last_review,'-infinity'::timestamptz);
  winner_id := coalesce(winner_id,'00000000-0000-0000-0000-000000000000'::uuid);
  wins := (effective_time,p_mutation_id) > (winner_time,winner_id);
  insert into public.review_events(id,user_id,kind,target_id,cloze_ord,raw_answered_at,answered_at,clock_adjusted,next_state,previous_state)
    values(p_mutation_id,p_user_id,'study',p_card_id,p_cloze_ord,raw_time,effective_time,raw_time<>effective_time,snapshot,to_jsonb(current_row)) returning received_at into receipt_time;
  result := coalesce(p_response,'{}'::jsonb)||jsonb_build_object('next_state',snapshot,'due',snapshot->>'due','review_id',p_mutation_id,'reconciliation',case when wins then 'authoritative' else 'history_only' end,'answered_at',effective_time,'raw_answered_at',raw_time,'received_at',receipt_time,'winning_review_id',case when wins then p_mutation_id else current_row.winning_review_id end,'clock_adjusted',raw_time<>effective_time);
  if wins then
    result := public.apply_card_review_legacy(p_user_id,p_card_id,p_cloze_ord,coalesce(current_row.version,0),p_mutation_id,snapshot,p_log,result);
    update public.card_reviews set winning_review_id=p_mutation_id where user_id=p_user_id and card_id=p_card_id and cloze_ord=p_cloze_ord;
    update public.review_logs set next_state=snapshot,previous_state=to_jsonb(current_row),raw_review=raw_time,
      context=log_context,exam_id=log_exam_id,response_ms=log_response_ms where id=p_mutation_id;
  else
    result := result||jsonb_build_object('next_state',to_jsonb(current_row),'state',current_row.state,'due',current_row.due,'scheduled_days',current_row.scheduled_days);
    insert into public.review_logs(id,card_id,user_id,cloze_ord,rating,state,due,stability,difficulty,elapsed_days,last_elapsed_days,scheduled_days,review,response_payload,base_version,next_state,previous_state,raw_review,context,exam_id,response_ms)
    values(p_mutation_id,p_card_id,p_user_id,p_cloze_ord,(p_log->>'rating')::smallint,(p_log->>'state')::smallint,(p_log->>'due')::timestamptz,(p_log->>'stability')::float8,(p_log->>'difficulty')::float8,(p_log->>'elapsed_days')::float8,(p_log->>'last_elapsed_days')::float8,(p_log->>'scheduled_days')::float8,effective_time,result,p_expected_version,snapshot,to_jsonb(current_row),raw_time,log_context,log_exam_id,log_response_ms);
  end if;
  return result;
end $$;
revoke all on function public.apply_card_review(uuid,uuid,smallint,integer,uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.apply_card_review(uuid,uuid,smallint,integer,uuid,jsonb,jsonb,jsonb) to authenticated,service_role;

notify pgrst, 'reload schema';
