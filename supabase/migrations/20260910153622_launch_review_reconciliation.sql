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
end $$;
revoke all on function private.validate_review_schedule(jsonb) from public;

-- Additive rollout: disabled until server + client compatibility checks pass.
create table public.launch_features(name text primary key, enabled boolean not null default false);
insert into public.launch_features values ('review_reconciliation', false);
alter table public.launch_features enable row level security;
grant select on public.launch_features to authenticated;
create policy "Read rollout configuration" on public.launch_features for select to authenticated using (true);
grant all on public.launch_features to service_role;

create table public.launch_feature_users(name text references public.launch_features(name) on delete cascade,user_id uuid references auth.users(id) on delete cascade,primary key(name,user_id));
alter table public.launch_feature_users enable row level security;
grant select on public.launch_feature_users to authenticated;
grant all on public.launch_feature_users to service_role;
create policy "Read own rollout eligibility" on public.launch_feature_users for select to authenticated using(user_id=(select auth.uid()));
create or replace function private.launch_feature_enabled(feature text,owner_id uuid) returns boolean
language sql security definer set search_path='' as $$
 select coalesce((select enabled from public.launch_features where name=feature),false)
 or exists(select 1 from public.launch_feature_users where name=feature and user_id=owner_id);
$$;
revoke all on function private.launch_feature_enabled(text,uuid) from public;

create table public.review_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('study','cram')),
  target_id uuid not null,
  cloze_ord smallint not null default 0,
  raw_answered_at timestamptz not null,
  answered_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  clock_adjusted boolean not null default false,
  next_state jsonb not null,
  previous_state jsonb,
  undone boolean not null default false
);
create index review_events_winner on public.review_events(user_id,kind,target_id,cloze_ord,answered_at desc,id desc) where not undone;
alter table public.review_events enable row level security;
revoke all on public.review_events from anon, authenticated;
grant select on public.review_events to authenticated;
grant all on public.review_events to service_role;
create policy "Own review events" on public.review_events for select to authenticated using (user_id=(select auth.uid()));
alter table public.card_reviews add column winning_review_id uuid;
alter table public.cram_plan_items add column winning_review_id uuid;
alter table public.review_logs add column next_state jsonb, add column previous_state jsonb, add column raw_review timestamptz;
alter table public.cram_review_logs add column raw_review timestamptz;
create trigger prevent_deleted_account_writes before insert or update on public.review_events for each row execute function private.prevent_deleted_account_writes();

-- Keep historical protocol callable by the wrapper while flags are off.
alter function public.apply_card_review(uuid,uuid,smallint,integer,uuid,jsonb,jsonb,jsonb) rename to apply_card_review_legacy;
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
    result := public.apply_card_review_legacy(p_user_id,p_card_id,p_cloze_ord,p_expected_version,p_mutation_id,p_review,p_log,p_response);
    update public.card_reviews set winning_review_id=null where user_id=p_user_id and card_id=p_card_id and cloze_ord=p_cloze_ord;
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

alter function public.record_synced_cram_review(uuid,uuid,uuid,smallint,integer,jsonb,jsonb,integer) rename to record_synced_cram_review_legacy;
create or replace function public.record_synced_cram_review(p_plan_id uuid,p_item_id uuid,p_log_id uuid,p_rating smallint,p_expected_version integer,p_next_state jsonb,p_log jsonb,p_response_ms integer default null)
returns table(item_id uuid,new_version integer,reconciliation text) language plpgsql security definer set search_path=public,pg_temp as $$
declare
  u uuid := auth.uid(); current_item public.cram_plan_items%rowtype;
  submitted_time timestamptz;
  raw_time timestamptz; effective_time timestamptz; last_time timestamptz; last_id uuid; wins boolean;
begin
  if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not private.launch_feature_enabled('review_reconciliation',u) then
    return query select legacy.*, 'authoritative'::text from public.record_synced_cram_review_legacy(p_plan_id,p_item_id,p_log_id,p_rating,p_expected_version,p_next_state,p_log,p_response_ms) legacy;
    update public.cram_plan_items set winning_review_id=null where id=p_item_id; return;
  end if;
  if not exists(select 1 from public.cram_plans where id=p_plan_id and user_id=u and status='active') then raise exception 'Active plan not found' using errcode='42501'; end if;
  select * into current_item from public.cram_plan_items where id=p_item_id and plan_id=p_plan_id for update;
  if not found then raise exception 'Item not found' using errcode='42501'; end if;
  if exists(select 1 from public.cram_review_logs where id=p_log_id and user_id=u) then return query select p_item_id,current_item.version,case when current_item.winning_review_id=p_log_id then 'authoritative'::text else 'history_only'::text end; return; end if;
  if coalesce(p_rating,0) not between 1 and 4 or p_log_id is null then raise exception 'Invalid review' using errcode='22023'; end if;
  submitted_time := (p_log->>'review')::timestamptz;
  raw_time := coalesce((p_log->>'raw_review')::timestamptz,submitted_time);
  if raw_time is null or not isfinite(raw_time) or submitted_time is null or not isfinite(submitted_time) then raise exception 'Invalid answer time' using errcode='22023'; end if;
  effective_time := least(submitted_time,clock_timestamp());
  p_log := p_log || jsonb_build_object('review',effective_time);
  p_next_state := jsonb_set(p_next_state,'{last_review}',to_jsonb(effective_time));
  if submitted_time <> effective_time then p_next_state := jsonb_set(p_next_state,'{due}',to_jsonb((p_next_state->>'due')::timestamptz+(effective_time-submitted_time))); end if;
  perform private.validate_review_schedule(p_next_state);
  perform private.validate_review_schedule(p_log||'{"reps":0,"lapses":0}'::jsonb);
  if p_response_ms is not null and (p_response_ms<0 or p_response_ms>3600000) then raise exception 'Invalid response time' using errcode='22023'; end if;
  select answered_at,id into last_time,last_id from public.review_events where user_id=u and kind='cram' and target_id=p_item_id and not undone order by answered_at desc,id desc limit 1;
  wins := (effective_time,p_log_id) > (greatest(last_time,current_item.last_review,'-infinity'::timestamptz),coalesce(last_id,'00000000-0000-0000-0000-000000000000'::uuid));
  insert into public.review_events(id,user_id,kind,target_id,cloze_ord,raw_answered_at,answered_at,clock_adjusted,next_state,previous_state)
    values(p_log_id,u,'cram',p_item_id,current_item.cloze_ord,raw_time,effective_time,raw_time<>effective_time,p_next_state,to_jsonb(current_item));
  if wins then
    return query select legacy.*, 'authoritative'::text from public.record_synced_cram_review_legacy(p_plan_id,p_item_id,p_log_id,p_rating,current_item.version,p_next_state,p_log,p_response_ms) legacy;
    update public.cram_plan_items set winning_review_id=p_log_id where id=p_item_id;
    update public.cram_review_logs set raw_review=raw_time where id=p_log_id;
  else
    insert into public.cram_review_logs(id,plan_id,item_id,user_id,card_id,cloze_ord,rating,state,due,stability,difficulty,elapsed_days,last_elapsed_days,scheduled_days,review,response_ms,previous_state,next_state,raw_review)
      values(p_log_id,p_plan_id,p_item_id,u,current_item.card_id,current_item.cloze_ord,p_rating,(p_log->>'state')::smallint,(p_log->>'due')::timestamptz,(p_log->>'stability')::float8,(p_log->>'difficulty')::float8,(p_log->>'elapsed_days')::float8,(p_log->>'last_elapsed_days')::float8,(p_log->>'scheduled_days')::float8,effective_time,p_response_ms,to_jsonb(current_item),p_next_state,raw_time);
    return query select p_item_id,current_item.version,case when current_item.winning_review_id=p_log_id then 'authoritative'::text else 'history_only'::text end;
  end if;
end $$;
revoke all on function public.record_synced_cram_review(uuid,uuid,uuid,smallint,integer,jsonb,jsonb,integer) from public,anon;
grant execute on function public.record_synced_cram_review(uuid,uuid,uuid,smallint,integer,jsonb,jsonb,integer) to authenticated;

-- Old online clients enter the same reconciliation path; new clients supply stable UUIDs.
create or replace function public.record_cram_review(p_plan_id uuid,p_item_id uuid,p_rating smallint,p_expected_version integer,p_next_state jsonb,p_log jsonb,p_response_ms integer default null)
returns table(item_id uuid,new_version integer) language sql security invoker set search_path=public as $$
 select r.item_id,r.new_version from public.record_synced_cram_review(p_plan_id,p_item_id,gen_random_uuid(),p_rating,p_expected_version,p_next_state,p_log,p_response_ms) r;
$$;

alter table public.review_logs add column undone boolean not null default false;
-- Undo is a tombstone on the exact event, never "delete whichever review is newest".
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
    if not found then raise exception 'This review needs to sync before undo is available' using errcode='40001'; end if;
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
revoke all on function public.restore_card_review(uuid,smallint,uuid,boolean) from public,anon;
grant execute on function public.restore_card_review(uuid,smallint,uuid,boolean) to authenticated;

-- Helper implementations are callable only from the verified wrappers.
revoke execute on function public.apply_card_review_legacy(uuid,uuid,smallint,integer,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke execute on function public.record_synced_cram_review_legacy(uuid,uuid,uuid,smallint,integer,jsonb,jsonb,integer) from public,anon,authenticated;

create or replace function public.guard_cram_plan_item_review_version() returns trigger
language plpgsql set search_path=public as $$
begin
  if row(new.due,new.stability,new.difficulty,new.elapsed_days,new.scheduled_days,new.learning_steps,new.reps,new.lapses,new.state,new.last_review)
    is distinct from row(old.due,old.stability,old.difficulty,old.elapsed_days,old.scheduled_days,old.learning_steps,old.reps,old.lapses,old.state,old.last_review)
    and new.version<>old.version+1 then raise exception 'Cram Plan item changed' using errcode='40001'; end if;
  if new.version not in (old.version,old.version+1) then raise exception 'Invalid Cram version' using errcode='40001'; end if;
  return new;
end $$;

notify pgrst, 'reload schema';
