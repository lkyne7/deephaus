-- Accounts outside the review_reconciliation rollout went through
-- apply_card_review_legacy, which dropped the next/previous schedule snapshots
-- the client sends. restore_card_review reads only recorded events, so undo of
-- any such review could never restore a schedule (and, before
-- 20261103163000, failed retryably forever). Keep the legacy version-checked
-- protocol for applying the schedule, but record the same history the
-- reconciliation path does so undo and redo work for every account.
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
    update public.review_logs set next_state=snapshot,previous_state=to_jsonb(current_row),raw_review=raw_time where id=p_mutation_id and user_id=p_user_id;
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
    update public.review_logs set next_state=snapshot,previous_state=to_jsonb(current_row),raw_review=raw_time where id=p_mutation_id;
  else
    result := result||jsonb_build_object('next_state',to_jsonb(current_row),'state',current_row.state,'due',current_row.due,'scheduled_days',current_row.scheduled_days);
    insert into public.review_logs(id,card_id,user_id,cloze_ord,rating,state,due,stability,difficulty,elapsed_days,last_elapsed_days,scheduled_days,review,response_payload,base_version,next_state,previous_state,raw_review)
    values(p_mutation_id,p_card_id,p_user_id,p_cloze_ord,(p_log->>'rating')::smallint,(p_log->>'state')::smallint,(p_log->>'due')::timestamptz,(p_log->>'stability')::float8,(p_log->>'difficulty')::float8,(p_log->>'elapsed_days')::float8,(p_log->>'last_elapsed_days')::float8,(p_log->>'scheduled_days')::float8,effective_time,result,p_expected_version,snapshot,to_jsonb(current_row),raw_time);
  end if;
  return result;
end $$;
revoke all on function public.apply_card_review(uuid,uuid,smallint,integer,uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.apply_card_review(uuid,uuid,smallint,integer,uuid,jsonb,jsonb,jsonb) to authenticated,service_role;

-- Reviews recorded before this migration still have no snapshot. Their undo
-- stays history-only, but the device has already restored its own copy and
-- bumped the row version; bump it here too so the device's next review of the
-- card passes the legacy version check instead of conflicting forever.
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
  insert into public.card_reviews(card_id,user_id,cloze_ord,due,stability,difficulty,elapsed_days,scheduled_days,reps,lapses,state,last_review,learning_steps,version,winning_review_id)
  values(p_card_id,u,p_cloze_ord,(schedule->>'due')::timestamptz,(schedule->>'stability')::float8,(schedule->>'difficulty')::float8,
    (schedule->>'elapsed_days')::float8,(schedule->>'scheduled_days')::float8,(schedule->>'reps')::int,(schedule->>'lapses')::int,
    (schedule->>'state')::smallint,(schedule->>'last_review')::timestamptz,coalesce((schedule->>'learning_steps')::int,0),coalesce(current_row.version,0)+1,winner.id)
  on conflict(card_id,user_id,cloze_ord) do update set due=excluded.due,stability=excluded.stability,difficulty=excluded.difficulty,
    elapsed_days=excluded.elapsed_days,scheduled_days=excluded.scheduled_days,reps=excluded.reps,lapses=excluded.lapses,state=excluded.state,
    last_review=excluded.last_review,learning_steps=excluded.learning_steps,version=excluded.version,winning_review_id=excluded.winning_review_id;
  return schedule||jsonb_build_object('is_new',(schedule->>'state')::int=0);
end $$;
