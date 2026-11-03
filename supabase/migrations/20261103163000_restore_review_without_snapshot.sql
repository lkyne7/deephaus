-- Undo of a review whose server log has no schedule snapshot can never succeed.
-- Treat it as a history-only undo instead of raising a retryable error, which
-- left devices retrying the upload forever and exhausted the PostgREST pool.
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
      -- The log row is on the server but carries no schedule snapshot (reviews
      -- uploaded before snapshots were stored). There is nothing to restore, so
      -- record the undo flag and keep the current schedule. Raising here made
      -- the device's upload queue retry the undo forever, and the retries held
      -- PostgREST connections until the pool was exhausted.
      if exists(select 1 from public.review_logs where id=p_log_id and user_id=u and card_id=p_card_id and cloze_ord=p_cloze_ord) then
        update public.review_logs set undone=p_undone where id=p_log_id and user_id=u;
        select * into current_row from public.card_reviews where user_id=u and card_id=p_card_id and cloze_ord=p_cloze_ord;
        if current_row.card_id is null then return jsonb_build_object('state',0,'is_new',true,'reps',0,'lapses',0); end if;
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
